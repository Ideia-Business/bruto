/**
 * A ponte para o **app local** do Bruto — o caminho que faz a extensão consumir
 * a assinatura que a pessoa já paga, em vez de cobrar dela por token.
 *
 * POR QUE ELE EXISTE: o dono quer que quem tem plano Claude ou plano ChatGPT use
 * o plano. Uma extensão de navegador não executa binário, então ela não chama
 * `claude` nem `codex` — mas o app local executa. A extensão pergunta a ele.
 *
 * O CONTRATO (normativo, definido fora daqui — não mude sem combinar):
 *
 *   GET  /api/llm/saude
 *     → 200 { ok: true, provedores: [{ id, label, plano, disponivel, motivo? }] }
 *   POST /api/llm
 *     corpo: { task, prompt, input?, tier?, provedor? }
 *     → 200 { text, provider, model } · 400 corpo inválido · 503 sem provedor de plano
 *
 * DUAS COISAS QUE NÃO PODEM SE PERDER AQUI:
 *
 * 1. **A resposta é entrada não-confiável.** Ela chega por rede, vai para a
 *    mesma tela da aula e passa pelo mesmo renderizador. "É local" não é
 *    credencial: qualquer processo na máquina pode ouvir em 127.0.0.1, e o que
 *    o app devolve veio, ele próprio, de um modelo. Por isso nada é usado sem
 *    passar por `lerTexto`/`lerSaude`, que conferem forma e tamanho.
 * 2. **A chave da pessoa NUNCA entra no corpo.** O app não precisa dela — ele
 *    usa o plano. Mandar criaria uma superfície nova onde não havia nenhuma. O
 *    corpo montado em `pedirAoApp` é fechado e não tem campo para chave.
 */

/** Fixo de propósito: é o mesmo endereço declarado em `host_permissions`. */
export const APP_BASE = "http://127.0.0.1:3000";

/**
 * A detecção corre ANTES de qualquer tela e o caso comum é o app não estar de
 * pé — em `127.0.0.1` isso é uma recusa de conexão, que volta na hora. O teto
 * existe para o caso patológico (porta ocupada por algo que aceita e não
 * responde), onde esperar seria travar o popup.
 */
const TIMEOUT_SAUDE_MS = 1500;

/** Teto do texto vindo do app — uma aula grande dá ~40 KB; 2 MB é folga com fim. */
const MAX_TEXTO = 2_000_000;

/**
 * Tetos de BYTES por rota, aplicados antes de qualquer `JSON.parse`.
 *
 * `127.0.0.1:3000` não é prova de identidade: outro processo pode ter tomado a
 * porta antes do app e devolver centenas de MB. `r.json()` bufferiza tudo antes
 * de devolver, então os limites de `lerSaude`/`lerTexto` chegariam tarde — a
 * memória já teria ido. O corte é na leitura.
 */
const TETO_SAUDE_BYTES = 64 * 1024;
const TETO_GERACAO_BYTES = 4 * 1024 * 1024;

/**
 * Cabeçalho exigido pelo app nas DUAS rotas (contrato de 13/09/2026).
 *
 * Nenhuma das duas pode ser alcançada por uma página web qualquer. A saúde é um
 * GET, e GET simples qualquer página dispara — sem CORS, sem ler resposta — só
 * que essa rota **cria subprocessos** (`claude auth status`, `codex login
 * status`): um laço de `fetch` de um site num separador esquecido viraria
 * centenas de processos na máquina de quem instalou. `X-Bruto-Cliente` não está
 * na lista de cabeçalhos dispensados de verificação prévia, então a tentativa
 * vira preflight — e o preflight morre sem origem autorizada.
 *
 * No POST ele é, tecnicamente, redundante: o `Content-Type: application/json`
 * já força o preflight sozinho. Vai assim mesmo, e essa é a lição desta sessão
 * inteira — **uma regra aplicada em todo lugar menos num é exatamente como a
 * classe fica aberta**, e o lugar de fora seria o que gasta o dinheiro de quem
 * usa. Uma regra só, sem exceção que alguém precise redescobrir depois.
 */
const CABECALHO_CLIENTE = { "X-Bruto-Cliente": "extensao" } as const;

export interface ProvedorDoApp {
  id: string;
  label: string;
  /** `true` quando o consumo sai da assinatura, não de cobrança por token. */
  plano: boolean;
  disponivel: boolean;
  motivo?: string;
}

export interface SaudeDoApp {
  provedores: ProvedorDoApp[];
  /** Há pelo menos um provedor de plano pronto para uso? */
  temPlano: boolean;
}

function ehObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Valida a saúde devolvida pelo app. Entrada malformada não derruba a extensão
 * nem é "corrigida" com adivinhação: o provedor que não bate com o contrato é
 * **descartado**, e uma lista vazia significa, honestamente, que não há plano.
 */
export function lerSaude(cru: unknown): SaudeDoApp | null {
  if (!ehObjeto(cru) || cru.ok !== true || !Array.isArray(cru.provedores)) return null;

  const provedores: ProvedorDoApp[] = [];
  for (const p of cru.provedores) {
    if (!ehObjeto(p)) continue;
    if (typeof p.id !== "string" || typeof p.label !== "string") continue;
    if (typeof p.plano !== "boolean" || typeof p.disponivel !== "boolean") continue;
    provedores.push({
      id: p.id.slice(0, 60),
      label: p.label.slice(0, 60),
      plano: p.plano,
      disponivel: p.disponivel,
      ...(typeof p.motivo === "string" ? { motivo: p.motivo.slice(0, 300) } : {}),
    });
  }

  return { provedores, temPlano: provedores.some((p) => p.plano && p.disponivel) };
}

/**
 * Valida a resposta de geração. Devolve `null` (e não uma string vazia) quando a
 * forma não bate — quem chama distingue "o app respondeu errado" de "o app
 * respondeu um texto vazio", que são problemas diferentes.
 */
export function lerTexto(cru: unknown): string | null {
  if (!ehObjeto(cru)) return null;
  const t = cru.text;
  if (typeof t !== "string") return null;
  const texto = t.length > MAX_TEXTO ? t.slice(0, MAX_TEXTO) : t;
  return texto.trim() === "" ? null : texto;
}

/**
 * Junta o sinal de quem chamou com o do relógio interno. São DOIS motivos
 * legítimos de parar, e os dois precisam valer.
 *
 * A versão anterior escrevia `{ ...init, signal: relogio.signal }` e, com isso,
 * o `signal` que vinha no `init` era **sobrescrito**. O botão "Cancelar" do popup
 * deixava de cortar coisa alguma: a requisição ficava pendurada até 180 s,
 * podendo consumir um turno do modelo que a pessoa paga, e a tela não voltava.
 * O teste de cancelamento passava — em 180 006 ms, medindo o relógio interno e
 * chamando isso de cancelamento.
 */
function unirSinais(deQuemChamou: AbortSignal | undefined, relogio: AbortSignal): AbortSignal {
  if (deQuemChamou === undefined) return relogio;

  const any = (AbortSignal as { any?: (s: AbortSignal[]) => AbortSignal }).any;
  if (typeof any === "function") return any([deQuemChamou, relogio]);

  // Alvos sem `AbortSignal.any`: encadeia na mão, preservando o motivo — é ele
  // que faz o `AbortError` de quem cancelou chegar distinguível lá na frente.
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

interface RespostaComRelogio {
  resposta: Response;
  /**
   * O `fetch` resolve assim que os CABEÇALHOS chegam — não quando o corpo
   * termina de ser lido. Um `finally` aqui dentro que desarmasse o relógio no
   * retorno deste `fetch` deixaria a leitura do corpo (`lerJsonComTeto`, que
   * roda DEPOIS, no chamador) sem proteção nenhuma: um processo que responde
   * 200 e trava no meio do stream nunca seria cortado, apesar do prazo
   * anunciado. Por isso quem decide quando o relógio pode parar é o
   * chamador — depois de terminar de ler o corpo (ou de decidir que não vai
   * lê-lo). Achado P2 da revisão cross-vendor de 24/09/2026.
   */
  encerrarRelogio: () => void;
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
    const resposta = await fetch(`${APP_BASE}${caminho}`, {
      ...init,
      signal: unirSinais(init.signal ?? undefined, relogio.signal),
    });
    return { resposta, encerrarRelogio };
  } catch (err) {
    // Nunca chegou a resposta — não há corpo para ler, então o relógio
    // encerra aqui mesmo; não sobra ninguém para encerrá-lo depois.
    encerrarRelogio();
    throw err;
  }
}

/**
 * O app está de pé? `null` = não está, ou não fala este contrato.
 *
 * Nunca lança: a ausência do app é o estado NORMAL de quem só instalou a
 * extensão, e não pode virar erro na cara de ninguém.
 */
/**
 * Lê o corpo com TETO DE BYTES e só então parseia.
 *
 * `r.json()` bufferiza o corpo inteiro antes de devolver: contra um processo
 * hostil que tomou a porta e responde 300 MB, os limites de `lerSaude`/`lerTexto`
 * chegam depois de a memória já ter ido. Aqui o corte é na leitura.
 *
 * Os dois controles existem porque nenhum basta: o `Content-Length` é barato mas
 * é **declarado pelo outro lado** (pode mentir, ou faltar num corpo em pedaços),
 * e o teto no fluxo é o que vale de fato.
 */
async function lerJsonComTeto(r: Response, tetoBytes: number): Promise<unknown> {
  const declarado = Number(r.headers.get("content-length"));
  if (Number.isFinite(declarado) && declarado > tetoBytes) {
    throw new AppLocalError("RESPOSTA_INVALIDA", "O app do Bruto devolveu um corpo grande demais.");
  }

  const fluxo = r.body;
  let bruto: string;

  if (fluxo === null) {
    // Ambiente sem corpo em fluxo: o `Content-Length` já foi conferido acima, e
    // o texto ainda passa pelo corte de tamanho antes de virar objeto.
    bruto = await r.text();
    if (bruto.length > tetoBytes) {
      throw new AppLocalError("RESPOSTA_INVALIDA", "O app do Bruto devolveu um corpo grande demais.");
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
        throw new AppLocalError(
          "RESPOSTA_INVALIDA",
          "O app do Bruto devolveu um corpo grande demais.",
        );
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
    throw new AppLocalError("RESPOSTA_INVALIDA", "O app do Bruto devolveu um corpo ilegível.");
  }
}

export async function verSaudeDoApp(timeoutMs: number = TIMEOUT_SAUDE_MS): Promise<SaudeDoApp | null> {
  try {
    const { resposta: r, encerrarRelogio } = await buscar(
      "/api/llm/saude",
      { method: "GET", headers: { ...CABECALHO_CLIENTE } },
      timeoutMs,
    );
    try {
      if (!r.ok) return null;
      return lerSaude(await lerJsonComTeto(r, TETO_SAUDE_BYTES));
    } finally {
      // Só agora o corpo já foi lido (ou a leitura foi descartada de propósito
      // pelo `!r.ok`) — o relógio pode parar.
      encerrarRelogio();
    }
  } catch {
    return null;
  }
}

export type FalhaDoApp =
  | "INDISPONIVEL"
  | "SEM_PLANO"
  | "PEDIDO_INVALIDO"
  | "GRANDE_DEMAIS"
  | "TIPO_RECUSADO"
  | "RESPOSTA_INVALIDA";

export class AppLocalError extends Error {
  readonly causa: FalhaDoApp;
  constructor(causa: FalhaDoApp, mensagem: string) {
    super(mensagem);
    this.name = "AppLocalError";
    this.causa = causa;
  }
}

export interface PedidoAoApp {
  task: "summary" | "mindmap" | "category" | "translate" | "study" | "references";
  prompt: string;
  input?: string;
  tier?: "fast" | "balanced";
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** Pede o texto ao app. O corpo é fechado — repare que não há campo de chave. */
export async function pedirAoApp(p: PedidoAoApp): Promise<string> {
  const corpo = JSON.stringify({
    task: p.task,
    prompt: p.prompt,
    ...(p.input === undefined ? {} : { input: p.input }),
    tier: p.tier ?? "balanced",
  });

  let r: Response;
  let encerrarRelogio: () => void;
  try {
    ({ resposta: r, encerrarRelogio } = await buscar(
      "/api/llm",
      {
        method: "POST",
        // OBRIGATÓRIO, e não por formalidade: é este cabeçalho que **protege a
        // assinatura da pessoa**. `application/json` não está na lista de tipos
        // que o navegador dispensa de preflight, então uma página web qualquer
        // que tente esta mesma chamada esbarra num preflight sem origem
        // autorizada e nunca chega ao app. Com `text/plain` a requisição seria
        // "simples": iria sem preflight, o app EXECUTARIA, e a página só não
        // leria a resposta — o plano queimaria do mesmo jeito, em laço, a partir
        // de um site num separador esquecido. O app recusa com 415 quem não
        // manda isto; trocar por `undefined` derruba a integração inteira.
        //
        // E `X-Bruto-Cliente` vem junto, embora AQUI o `content-type` já bastasse
        // para forçar a verificação prévia. É de propósito: a mesma tranca nas
        // duas portas, sem exceção que alguém precise redescobrir daqui a um ano
        // — e a porta isenta seria justamente a que gasta o dinheiro da pessoa.
        headers: { "content-type": "application/json", ...CABECALHO_CLIENTE },
        body: corpo,
        signal: p.signal,
      },
      p.timeoutMs ?? 180_000,
    ));
  } catch (err) {
    // Cancelamento de quem chamou atravessa; o resto é "o app sumiu". Não há
    // corpo para ler em nenhum dos dois casos — `buscar` já encerrou o relógio.
    if (p.signal?.aborted) throw err;
    throw new AppLocalError("INDISPONIVEL", "O app do Bruto não respondeu.");
  }

  try {
    if (r.status === 503) {
      throw new AppLocalError(
        "SEM_PLANO",
        "O app do Bruto está de pé, mas nenhum provedor de plano está disponível nele.",
      );
    }
    if (r.status === 400) {
      // A rota só atende provedor de PLANO — pedir um provedor de chave por ela dá
      // 400. Este código nunca manda `provedor`, então um 400 aqui é defeito nosso.
      throw new AppLocalError("PEDIDO_INVALIDO", "O app do Bruto recusou o pedido.");
    }
    if (r.status === 413) {
      // `input` carrega a transcrição inteira; vídeo muito longo estoura 1 MB.
      // Quem está na frente da tela precisa entender o que fazer, não ver "413".
      throw new AppLocalError(
        "GRANDE_DEMAIS",
        "Esse vídeo é longo demais para o app dar conta de uma vez. Tente um vídeo menor, ou use uma chave de API nas opções.",
      );
    }
    if (r.status === 415) {
      // Só acontece se ALGUÉM TIROU o `content-type` daqui. Diz isso, em vez de
      // mandar a pessoa caçar problema na máquina dela.
      throw new AppLocalError(
        "TIPO_RECUSADO",
        "O app recusou o formato do pedido (415). Isso é defeito da extensão, não da sua máquina — relate o problema.",
      );
    }
    if (!r.ok) {
      // Só o número atravessa — o corpo do erro é descartado, mesma regra do `llm.ts`.
      throw new AppLocalError("INDISPONIVEL", `O app do Bruto falhou (${r.status}).`);
    }

    const json = await lerJsonComTeto(r, TETO_GERACAO_BYTES);
    const texto = lerTexto(json);
    if (texto === null) {
      throw new AppLocalError("RESPOSTA_INVALIDA", "O app do Bruto devolveu uma resposta sem texto.");
    }
    return texto;
  } finally {
    // Cobre os dois caminhos: corpo lido até o fim (`lerJsonComTeto`) e corpo
    // descartado de propósito pelos status acima — nos dois, a proteção do
    // relógio só pode parar aqui, nunca no retorno do `fetch`.
    encerrarRelogio();
  }
}
