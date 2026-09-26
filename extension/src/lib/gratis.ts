/**
 * Modo grátis — a extensão fala com `bruto-gratis.vercel.app` quando não há
 * app local com plano nem chave configurada. Contrato normativo em
 * `servidor/CONTRATO.md` (não mude aqui sem mudar lá).
 *
 * O QUE NUNCA MUDA: o servidor recebe só título/canal/transcrição e monta o
 * prompt ele mesmo — esta extensão NUNCA manda `studyPrompt` para ele. A
 * chave do Ollama nunca passa por aqui, porque ela nunca sai do servidor.
 *
 * Mesma doutrina do `app-local.ts`: a resposta é ENTRADA NÃO CONFIÁVEL — teto
 * de bytes, forma conferida, nada de log com o corpo cru.
 */

export const SERVIDOR_GRATIS = "https://bruto-gratis.vercel.app";

const CHAVE_STORAGE_INSTALACAO = "bruto.instalacao";

/** Cabeçalho exigido pelo servidor nas duas rotas — força preflight (ver CONTRATO.md). */
const CABECALHO_CLIENTE = { "X-Bruto-Cliente": "extensao" } as const;

/**
 * Cabeçalho que carrega o UUID da instalação em `/api/cota`. NUNCA na query
 * string: query string vai para o log de acesso da Vercel (URL completa),
 * e o UUID é o identificador que liga as consultas de cota de uma mesma
 * pessoa — achado do Grok, 26/09/2026. Em `/api/aula` o UUID já ia no corpo
 * (POST), que não tem esse problema; só `/api/cota` (GET) precisava mudar.
 */
const CABECALHO_INSTALACAO = "X-Bruto-Instalacao";

/** O contrato recusa `transcricao` acima disso — caracteres, não bytes. */
export const LIMITE_TRANSCRICAO_CARACTERES = 120_000;

/**
 * O contrato recusa o CORPO inteiro (200 KB). O corte por caracteres sozinho
 * não basta: texto em CJK (até 3 bytes por caractere em UTF-8) ou cheio de
 * emoji pode ter 120.000 caracteres e passar de 200 KB de corpo — achado do
 * Codex, 26/09/2026. O alvo aqui fica com folga sobre o teto do contrato.
 */
export const ALVO_BYTES_CORPO = 190_000;

/** Corpo de `/api/aula` cabe em folga; `/api/cota` é minúsculo. */
const TETO_BYTES_AULA = 512 * 1024;
const TETO_BYTES_COTA = 8 * 1024;

/** A aula pedida pode demorar — mesmo teto do app local para a mesma tarefa. */
const TIMEOUT_AULA_MS = 180_000;
/** A cota é só leitura de contador: se não responder rápido, não vale a espera. */
const TIMEOUT_COTA_MS = 3_000;

interface AreaStorage {
  get(chaves: string[]): Promise<Record<string, unknown>>;
  set(itens: Record<string, unknown>): Promise<void>;
}

interface ChromeMinimo {
  storage?: { local?: AreaStorage };
}

function storageLocal(): AreaStorage {
  const c = (globalThis as { chrome?: ChromeMinimo }).chrome;
  const area = c?.storage?.local;
  if (!area) {
    throw new Error(
      "chrome.storage.local indisponível. Este código só roda dentro da extensão " +
        "(service worker, popup ou página de opções).",
    );
  }
  return area;
}

/**
 * O UUID v4 da instalação — gerado uma vez e guardado em `chrome.storage.local`.
 * É o que o servidor usa para contar as 3 aulas por dia; não identifica a
 * pessoa, só o navegador onde a extensão foi instalada.
 */
export async function idDaInstalacao(): Promise<string> {
  const area = storageLocal();
  const dados = await area.get([CHAVE_STORAGE_INSTALACAO]);
  const atual = dados[CHAVE_STORAGE_INSTALACAO];
  if (typeof atual === "string" && atual.trim() !== "") return atual;

  const novo = crypto.randomUUID();
  await area.set({ [CHAVE_STORAGE_INSTALACAO]: novo });
  return novo;
}

export type MotivoLimite = "instalacao" | "rede" | "geral";

export type CodigoGratis = "LIMITE" | "INDISPONIVEL" | "FALHA" | "PEDIDO_INVALIDO";

export class GratisError extends Error {
  readonly codigo: CodigoGratis;
  /** Só presente quando `codigo === "LIMITE"`. */
  readonly motivo?: MotivoLimite;
  readonly restantes?: number;
  readonly limite?: number;
  constructor(
    codigo: CodigoGratis,
    mensagem: string,
    extra?: { motivo?: MotivoLimite; restantes?: number; limite?: number },
  ) {
    super(mensagem);
    this.name = "GratisError";
    this.codigo = codigo;
    if (extra?.motivo !== undefined) this.motivo = extra.motivo;
    if (extra?.restantes !== undefined) this.restantes = extra.restantes;
    if (extra?.limite !== undefined) this.limite = extra.limite;
  }
}

function ehObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Lê o corpo com teto de bytes, igual ao padrão de `app-local.ts` — o host ser
 * "nosso" (Vercel) não é prova de identidade nem de tamanho de resposta.
 */
async function lerJsonComTeto(r: Response, tetoBytes: number): Promise<unknown> {
  const declarado = Number(r.headers.get("content-length"));
  if (Number.isFinite(declarado) && declarado > tetoBytes) {
    throw new GratisError("FALHA", "O servidor grátis devolveu um corpo grande demais.");
  }

  const fluxo = r.body;
  let bruto: string;

  if (fluxo === null) {
    bruto = await r.text();
    if (bruto.length > tetoBytes) {
      throw new GratisError("FALHA", "O servidor grátis devolveu um corpo grande demais.");
    }
  } else {
    const leitor = fluxo.getReader();
    const pedacos: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await leitor.read();
      if (done) break;
      total += value.byteLength;
      if (total > tetoBytes) {
        await leitor.cancel().catch(() => {});
        throw new GratisError("FALHA", "O servidor grátis devolveu um corpo grande demais.");
      }
      pedacos.push(value);
    }
    const inteiro = new Uint8Array(total);
    let pos = 0;
    for (const p of pedacos) {
      inteiro.set(p, pos);
      pos += p.byteLength;
    }
    bruto = new TextDecoder().decode(inteiro);
  }

  try {
    return JSON.parse(bruto);
  } catch {
    throw new GratisError("FALHA", "O servidor grátis devolveu um corpo ilegível.");
  }
}

interface RespostaComRelogio {
  resposta: Response;
  /** Só encerra o relógio depois de o corpo ter sido lido (ou descartado de propósito). */
  encerrarRelogio: () => void;
}

function unirSinais(deQuemChamou: AbortSignal | undefined, relogio: AbortSignal): AbortSignal {
  if (deQuemChamou === undefined) return relogio;

  const any = (AbortSignal as { any?: (s: AbortSignal[]) => AbortSignal }).any;
  if (typeof any === "function") return any([deQuemChamou, relogio]);

  const juntos = new AbortController();
  for (const s of [deQuemChamou, relogio]) {
    if (s.aborted) {
      juntos.abort(s.reason);
      return juntos.signal;
    }
    s.addEventListener("abort", () => juntos.abort(s.reason), { once: true });
  }
  return juntos.signal;
}

async function buscar(
  caminho: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<RespostaComRelogio> {
  const relogio = new AbortController();
  const corte = setTimeout(() => relogio.abort(), timeoutMs);
  const encerrarRelogio = () => clearTimeout(corte);
  try {
    const resposta = await fetch(`${SERVIDOR_GRATIS}${caminho}`, {
      ...init,
      signal: unirSinais(init.signal ?? undefined, relogio.signal),
    });
    return { resposta, encerrarRelogio };
  } catch (err) {
    encerrarRelogio();
    throw err;
  }
}

interface CampoLimite {
  restantes?: number;
  limite?: number;
}

function lerCampoLimite(cru: unknown): CampoLimite {
  if (!ehObjeto(cru)) return {};
  const out: CampoLimite = {};
  if (typeof cru.restantes === "number") out.restantes = cru.restantes;
  if (typeof cru.limite === "number") out.limite = cru.limite;
  return out;
}

function motivoValido(v: unknown): MotivoLimite | undefined {
  return v === "instalacao" || v === "rede" || v === "geral" ? v : undefined;
}

export interface PedidoAulaGratis {
  titulo: string;
  canal: string | null;
  transcricao: string;
  signal?: AbortSignal;
}

/**
 * Qual corte a transcrição sofreu antes de ser enviada — os dois têm causa e
 * mensagem diferentes para quem está vendo a tela: `"caracteres"` é o limite
 * de 120.000 caracteres do campo; `"bytes"` é o teto de 200 KB do CORPO
 * inteiro (o caso de texto em CJK ou cheio de emoji, que estoura bytes bem
 * antes de estourar caracteres). `null` quando nada precisou ser cortado.
 * Quando as duas frentes se aplicam, o corte por bytes é o que vale (é ele
 * quem decide o tamanho final) — ver `cortarTranscricao`.
 */
export type TipoCorteTranscricao = "caracteres" | "bytes" | null;

export interface AulaGratis {
  aula: string;
  restantes: number;
  limite: number;
  corte: TipoCorteTranscricao;
}

const codificador = new TextEncoder();

/** Bytes do CORPO inteiro já serializado — é isso que o teto de 200 KB mede, não caracteres. */
export function bytesDoCorpo(
  instalacao: string,
  titulo: string,
  canal: string | null,
  transcricao: string,
): number {
  return codificador.encode(JSON.stringify({ instalacao, titulo, canal, transcricao })).length;
}

/**
 * Corta `texto` em `ate` code units, mas nunca no meio de um par surrogate —
 * emoji e outros caracteres fora do plano básico usam DOIS code units em
 * UTF-16, e cortar entre os dois produz meia-letra (um code unit órfão) na
 * entrada do servidor.
 */
function cortarNaFronteira(texto: string, ate: number): string {
  if (ate >= texto.length) return texto;
  if (ate <= 0) return "";
  const ultimoCodigo = texto.charCodeAt(ate - 1);
  // 0xD800–0xDBFF é a metade ALTA de um par surrogate — se o corte cai bem
  // depois dela, a metade baixa (0xDC00–0xDFFF) ficaria de fora sozinha.
  if (ultimoCodigo >= 0xd800 && ultimoCodigo <= 0xdbff) return texto.slice(0, ate - 1);
  return texto.slice(0, ate);
}

/**
 * Corta a transcrição para caber no que o servidor aceita — em DUAS frentes,
 * porque nenhuma sozinha basta:
 *
 *  1. o limite de CARACTERES do campo (o contrato recusa `transcricao` acima
 *     de 120.000 caracteres, com 400);
 *  2. os BYTES do corpo inteiro já serializado (o contrato recusa o corpo
 *     acima de 200 KB, com 413 — e caractere não é byte fora do ASCII).
 *
 * O corte por bytes roda SEMPRE, mesmo quando o texto já cabe no limite de
 * caracteres: um texto em CJK ou cheio de emoji pode passar de 190 KB bem
 * antes de chegar a 120.000 caracteres. Busca binária pelo maior prefixo que
 * cabe — o universo é pequeno (≤120.000 code units), então repetir
 * `JSON.stringify` umas 17 vezes não pesa perto do que a chamada de rede real
 * vai custar.
 */
export function cortarTranscricao(
  instalacao: string,
  titulo: string,
  canal: string | null,
  transcricaoOriginal: string,
): { transcricao: string; corte: TipoCorteTranscricao } {
  const porCaracteres =
    transcricaoOriginal.length > LIMITE_TRANSCRICAO_CARACTERES
      ? cortarNaFronteira(transcricaoOriginal, LIMITE_TRANSCRICAO_CARACTERES)
      : transcricaoOriginal;
  const cortadaPorCaracteres = porCaracteres.length < transcricaoOriginal.length;

  if (bytesDoCorpo(instalacao, titulo, canal, porCaracteres) <= ALVO_BYTES_CORPO) {
    return { transcricao: porCaracteres, corte: cortadaPorCaracteres ? "caracteres" : null };
  }

  // `baixo` é sempre viável (código vazio cabe de sobra); `alto` começa no
  // tamanho que acabou de FALHAR o teste acima. Chegar aqui já significa
  // corte por BYTES — é ele quem decide o tamanho final, mesmo quando o
  // corte por caracteres também se aplicou antes.
  let baixo = 0;
  let alto = porCaracteres.length;
  while (baixo < alto) {
    const meio = Math.ceil((baixo + alto) / 2);
    const candidato = cortarNaFronteira(porCaracteres, meio);
    if (bytesDoCorpo(instalacao, titulo, canal, candidato) <= ALVO_BYTES_CORPO) baixo = meio;
    else alto = meio - 1;
  }

  return { transcricao: cortarNaFronteira(porCaracteres, baixo), corte: "bytes" };
}

/**
 * Pede a aula ao servidor grátis. Corta a transcrição no teto do contrato — o
 * servidor recusaria (400/413) acima disso, e cortar aqui poupa a viagem e
 * avisa quem chamou, em vez de simplesmente falhar.
 */
export async function pedirAulaGratis(p: PedidoAulaGratis): Promise<AulaGratis> {
  const instalacao = await idDaInstalacao();
  const { transcricao, corte } = cortarTranscricao(instalacao, p.titulo, p.canal, p.transcricao);

  const corpo = JSON.stringify({
    instalacao,
    titulo: p.titulo,
    canal: p.canal,
    transcricao,
  });

  let r: Response;
  let encerrarRelogio: () => void;
  try {
    ({ resposta: r, encerrarRelogio } = await buscar(
      "/api/aula",
      {
        method: "POST",
        headers: { "content-type": "application/json", ...CABECALHO_CLIENTE },
        body: corpo,
        signal: p.signal,
      },
      TIMEOUT_AULA_MS,
    ));
  } catch (err) {
    if (p.signal?.aborted) throw err;
    throw new GratisError("INDISPONIVEL", "O servidor grátis do Bruto não respondeu.");
  }

  try {
    if (r.status === 429) {
      const json = await lerJsonComTeto(r, TETO_BYTES_AULA).catch(() => null);
      const campos = lerCampoLimite(json);
      const motivo = ehObjeto(json) ? motivoValido(json.motivo) : undefined;
      throw new GratisError("LIMITE", "O limite de aulas grátis de hoje acabou.", {
        ...(motivo !== undefined ? { motivo } : {}),
        restantes: campos.restantes ?? 0,
        limite: campos.limite ?? 3,
      });
    }
    if (r.status === 400 || r.status === 413 || r.status === 415) {
      throw new GratisError("PEDIDO_INVALIDO", "O servidor grátis recusou o pedido.");
    }
    if (r.status === 503) {
      throw new GratisError(
        "INDISPONIVEL",
        "O modo grátis está fora do ar no momento. Tente de novo mais tarde.",
      );
    }
    if (r.status === 502) {
      throw new GratisError(
        "FALHA",
        "O modelo do modo grátis falhou ao gerar a aula. Sua cota de hoje não foi consumida — tente de novo.",
      );
    }
    if (!r.ok) {
      throw new GratisError("FALHA", `O servidor grátis do Bruto falhou (${r.status}).`);
    }

    const json = await lerJsonComTeto(r, TETO_BYTES_AULA);
    if (!ehObjeto(json) || typeof json.aula !== "string" || json.aula.trim() === "") {
      throw new GratisError("FALHA", "O servidor grátis devolveu uma resposta sem texto.");
    }
    const campos = lerCampoLimite(json);
    return {
      aula: json.aula,
      restantes: campos.restantes ?? 0,
      limite: campos.limite ?? 3,
      corte,
    };
  } finally {
    encerrarRelogio();
  }
}

export interface CotaGratis {
  restantes: number;
  limite: number;
}

/**
 * Consulta quantas aulas grátis restam hoje. `null` em QUALQUER falha (rede,
 * timeout, forma inesperada) — é só um dado informativo para a tela, nunca
 * motivo para travar um fluxo.
 */
export async function verCotaGratis(): Promise<CotaGratis | null> {
  try {
    const instalacao = await idDaInstalacao();
    const { resposta: r, encerrarRelogio } = await buscar(
      "/api/cota",
      { method: "GET", headers: { ...CABECALHO_CLIENTE, [CABECALHO_INSTALACAO]: instalacao } },
      TIMEOUT_COTA_MS,
    );
    try {
      if (!r.ok) return null;
      const json = await lerJsonComTeto(r, TETO_BYTES_COTA);
      const campos = lerCampoLimite(json);
      if (campos.restantes === undefined || campos.limite === undefined) return null;
      return { restantes: campos.restantes, limite: campos.limite };
    } finally {
      encerrarRelogio();
    }
  } catch {
    return null;
  }
}
