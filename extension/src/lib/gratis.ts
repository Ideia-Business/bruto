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

/** O contrato recusa transcrição acima disso (400) — corta ANTES de mandar. */
const LIMITE_TRANSCRICAO = 120_000;

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

export interface AulaGratis {
  aula: string;
  restantes: number;
  limite: number;
  /** `true` quando a transcrição foi cortada em 120.000 caracteres antes de enviar. */
  cortada: boolean;
}

/**
 * Pede a aula ao servidor grátis. Corta a transcrição no teto do contrato — o
 * servidor recusaria (400) acima disso, e cortar aqui poupa a viagem e avisa
 * quem chamou, em vez de simplesmente falhar.
 */
export async function pedirAulaGratis(p: PedidoAulaGratis): Promise<AulaGratis> {
  const instalacao = await idDaInstalacao();
  const cortada = p.transcricao.length > LIMITE_TRANSCRICAO;
  const transcricao = cortada ? p.transcricao.slice(0, LIMITE_TRANSCRICAO) : p.transcricao;

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
      cortada,
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
      `/api/cota?instalacao=${encodeURIComponent(instalacao)}`,
      { method: "GET", headers: { ...CABECALHO_CLIENTE } },
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
