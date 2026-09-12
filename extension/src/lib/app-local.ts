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

async function buscar(caminho: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const relogio = new AbortController();
  const corte = setTimeout(() => relogio.abort(), timeoutMs);
  try {
    return await fetch(`${APP_BASE}${caminho}`, { ...init, signal: relogio.signal });
  } finally {
    clearTimeout(corte);
  }
}

/**
 * O app está de pé? `null` = não está, ou não fala este contrato.
 *
 * Nunca lança: a ausência do app é o estado NORMAL de quem só instalou a
 * extensão, e não pode virar erro na cara de ninguém.
 */
export async function verSaudeDoApp(timeoutMs: number = TIMEOUT_SAUDE_MS): Promise<SaudeDoApp | null> {
  try {
    const r = await buscar("/api/llm/saude", { method: "GET" }, timeoutMs);
    if (!r.ok) return null;
    return lerSaude(await r.json());
  } catch {
    return null;
  }
}

export type FalhaDoApp = "INDISPONIVEL" | "SEM_PLANO" | "PEDIDO_INVALIDO" | "RESPOSTA_INVALIDA";

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
  try {
    r = await buscar(
      "/api/llm",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: corpo,
        signal: p.signal,
      },
      p.timeoutMs ?? 180_000,
    );
  } catch (err) {
    // Cancelamento de quem chamou atravessa; o resto é "o app sumiu".
    if (p.signal?.aborted) throw err;
    throw new AppLocalError("INDISPONIVEL", "O app do Bruto não respondeu.");
  }

  if (r.status === 503) {
    throw new AppLocalError(
      "SEM_PLANO",
      "O app do Bruto está de pé, mas nenhum provedor de plano está disponível nele.",
    );
  }
  if (r.status === 400) {
    throw new AppLocalError("PEDIDO_INVALIDO", "O app do Bruto recusou o pedido.");
  }
  if (!r.ok) {
    // Só o número atravessa — o corpo do erro é descartado, mesma regra do `llm.ts`.
    throw new AppLocalError("INDISPONIVEL", `O app do Bruto falhou (${r.status}).`);
  }

  let json: unknown;
  try {
    json = await r.json();
  } catch {
    throw new AppLocalError("RESPOSTA_INVALIDA", "O app do Bruto devolveu um corpo ilegível.");
  }

  const texto = lerTexto(json);
  if (texto === null) {
    throw new AppLocalError("RESPOSTA_INVALIDA", "O app do Bruto devolveu uma resposta sem texto.");
  }
  return texto;
}
