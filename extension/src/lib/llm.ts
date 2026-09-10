/**
 * `runLLM` — a única porta da extensão para um modelo de linguagem.
 *
 * Mesma semântica da camada equivalente do app Node (`src/pipeline/lib/llm/`),
 * reescrita enxuta para o navegador. Três decisões vieram de lá inteiras:
 *
 *  1. **Tier, não modelo.** Quem chama diz o que a tarefa exige ("fast" ou
 *     "balanced"); o provedor traduz para um modelo seu. Trocar de fornecedor
 *     não obriga a mexer em quem chama.
 *  2. **Erro classificado por STATUS HTTP, nunca por regex no corpo.** O corpo
 *     da resposta de erro é DESCARTADO no transporte — só o número atravessa.
 *     No app Node isso não era estética: a mensagem da exceção acabava gravada
 *     em `jobs.error_message`, no banco, e alguns proxies ecoam o request
 *     inteiro no corpo do erro — inclusive o header de autenticação. Seria a
 *     chave da pessoa gravada em texto. Aqui não há banco, mas há `console`,
 *     página de opções e relato de bug com print: a mesma regra vale.
 *  3. **Redigir é o primeiro movimento, não o último.** Todo texto que possa
 *     ser exibido ou logado passa por `redigir()` antes de virar mensagem.
 */

import { descreverProvedor, lerConfig, type Config, type ProvedorId } from "./config";

export type Tier = "fast" | "balanced";

export interface PedidoLlm {
  prompt: string;
  /** Texto longo que acompanha o prompt (transcrição, seleção da página). */
  input?: string;
  /** Default: "balanced". */
  tier?: Tier;
  /** Default: 180000 (3 min) — resumo de transcrição longa demora. */
  timeoutMs?: number;
  /** Cancelamento vindo de quem chamou (fechou o popup, clicou em parar). */
  signal?: AbortSignal;
}

export type CodigoLlm = "SEM_CONFIG" | "CREDENCIAL" | "COTA" | "FORA_DO_AR" | "FALHA";

export class LlmError extends Error {
  readonly codigo: CodigoLlm;
  constructor(codigo: CodigoLlm, mensagem: string) {
    super(mensagem);
    this.name = "LlmError";
    this.codigo = codigo;
  }
}

const TIMEOUT_PADRAO_MS = 180_000;
/** O teste de credencial é uma chamada mínima: se demorar, algo está errado. */
const TIMEOUT_TESTE_MS = 20_000;

/* ------------------------------------------------------------------ redação */

const MARCA = "<REDACTED>";

/** Formatos públicos e estáveis de credencial dos fornecedores suportados. */
const PADROES_DE_CHAVE: readonly RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{16,}/g, // Anthropic
  /sk-or-[A-Za-z0-9_-]{16,}/g, // OpenRouter
  /sk-proj-[A-Za-z0-9_-]{16,}/g, // OpenAI (projeto)
  /sk-[A-Za-z0-9]{20,}/g, // OpenAI (legado)
  /AIza[A-Za-z0-9_-]{20,}/g, // Google
  /\bBearer\s+[A-Za-z0-9._-]{16,}/gi, // header inteiro
];

function escaparRegex(v: string): string {
  return v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Devolve o texto sem segredo. Seguro para exibir, logar e colar num relato de
 * bug. Duas frentes, porque nenhuma sozinha basta: o VALOR da chave em uso (pega
 * a chave exata, em qualquer formato) e os formatos conhecidos (pegam chave que
 * veio de outro lugar — colada num prompt, devolvida por uma API).
 *
 * Nunca lança: falhar ao redigir não pode derrubar a extensão — mas também não
 * pode deixar passar, então o caminho de erro devolve texto neutro.
 */
export function redigir(texto: string, chave?: string): string {
  try {
    let out = texto;
    // Chave curta demais não é credencial — e viraria substituição em massa.
    if (chave && chave.length >= 12) {
      out = out.replace(new RegExp(escaparRegex(chave), "g"), MARCA);
    }
    for (const p of PADROES_DE_CHAVE) out = out.replace(p, MARCA);
    return out;
  } catch {
    return "(texto omitido: falha ao redigir)";
  }
}

/* -------------------------------------------------------------------- saída */

/**
 * Remove cercas de código Markdown (```...```) que envolvem TODO o texto.
 * Vale para qualquer provedor: todos tendem a embrulhar a resposta quando o
 * prompt pede markdown ou JSON.
 */
export function stripFences(texto: string): string {
  const t = texto.trim();
  const m = t.match(/^```[^\n`]*\n([\s\S]*?)\n?```$/);
  return m ? m[1].trim() : t;
}

/* ---------------------------------------------------------------- transporte */

/** Erro de transporte com o status preservado — é ele que classifica tudo. */
class ErroHttp extends Error {
  readonly status: number;
  constructor(status: number, detalhe: string) {
    super(detalhe);
    this.name = "ErroHttp";
    this.status = status;
  }
}

/**
 * Junta o cancelamento de quem chamou com o timeout próprio num único sinal.
 * `AbortSignal.any` existe no Chrome 116+, mas fazer à mão custa seis linhas e
 * não amarra a extensão a uma versão mínima maior do que o resto exige.
 */
function sinalCombinado(
  timeoutMs: number,
  externo?: AbortSignal,
): { signal: AbortSignal; encerrar: () => void } {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new DOMException("timeout", "TimeoutError")), timeoutMs);
  const repassar = (): void => ctrl.abort(externo?.reason);
  if (externo) {
    if (externo.aborted) repassar();
    else externo.addEventListener("abort", repassar, { once: true });
  }
  return {
    signal: ctrl.signal,
    encerrar: () => {
      clearTimeout(timer);
      externo?.removeEventListener("abort", repassar);
    },
  };
}

interface PostJson {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  timeoutMs: number;
  signal?: AbortSignal;
  /** Nome do fornecedor, só para a mensagem. */
  label: string;
  /** Só para redigir a mensagem de falha de rede. */
  chave: string;
}

async function postJson(o: PostJson): Promise<unknown> {
  const { signal, encerrar } = sinalCombinado(o.timeoutMs, o.signal);

  let res: Response;
  try {
    res = await fetch(o.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...o.headers },
      body: JSON.stringify(o.body),
      signal,
    });
  } catch (err) {
    // Cancelamento pedido por quem chamou não é falha do provedor: sobe cru
    // para que quem cancelou não veja "o provedor está fora do ar".
    if (o.signal?.aborted) throw o.signal.reason ?? new DOMException("cancelado", "AbortError");
    if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
      throw new ErroHttp(408, `tempo esgotado após ${o.timeoutMs}ms`);
    }
    // Falha de rede traz host e proxy, nunca a chave — mas redigimos assim
    // mesmo, porque o custo é zero e a garantia passa a ser absoluta.
    const detalhe = redigir(err instanceof Error ? err.message : String(err), o.chave);
    throw new ErroHttp(0, `não foi possível falar com ${o.label}: ${detalhe}`);
  } finally {
    encerrar();
  }

  if (!res.ok) {
    // O corpo do erro é descartado aqui, de propósito (ver cabeçalho do arquivo).
    throw new ErroHttp(res.status, `${o.label} respondeu ${res.status}`);
  }

  try {
    return (await res.json()) as unknown;
  } catch {
    throw new ErroHttp(res.status, `${o.label} devolveu uma resposta ilegível`);
  }
}

/* ---------------------------------------------------------------- provedores */

interface Requisicao {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  /** Lê o texto da resposta sem confiar no formato. */
  extrair: (raiz: Record<string, unknown>) => unknown;
}

function modeloDe(c: Config, tier: Tier): string {
  const d = descreverProvedor(c.provedor);
  if (c.modelo && c.modelo.trim() !== "") return c.modelo.trim();
  return tier === "fast" ? d.padraoFast : d.padraoBalanced;
}

/** Prompt manda, input é o material — mesma semântica do stdin do app Node. */
function juntar(prompt: string, input?: string): string {
  return input ? `${prompt}\n\n---\n\n${input}` : prompt;
}

/**
 * OpenAI, OpenRouter e Ollama Cloud falam o MESMO dialeto `/chat/completions`:
 * mesma requisição, mesma resposta, mesmo `Authorization: Bearer`. O que muda é
 * só a URL e um par de headers de atribuição. Três funções quase idênticas
 * seriam três lugares para o mesmo bug — aqui é uma.
 */
function requisicaoOpenAiCompativel(
  c: Config,
  url: string,
  modelo: string,
  conteudo: string,
  headersExtras: Record<string, string>,
  maxTokens: number,
): Requisicao {
  return {
    url,
    headers: { Authorization: `Bearer ${c.chave}`, ...headersExtras },
    body: {
      model: modelo,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: conteudo }],
    },
    extrair: (raiz) => {
      const escolhas = raiz.choices;
      if (!Array.isArray(escolhas) || escolhas.length === 0) return undefined;
      const primeira = escolhas[0] as { message?: { content?: unknown } };
      return primeira.message?.content;
    },
  };
}

/** O OpenRouter usa estes dois para atribuir tráfego — não há segredo neles. */
const HEADERS_OPENROUTER: Record<string, string> = {
  "HTTP-Referer": "https://github.com/Ideia-Business/bruto",
  "X-Title": "Bruto",
};

/**
 * Monta a requisição do provedor configurado. É o único ponto do arquivo que
 * sabe de diferença entre fornecedores — todo o resto (timeout, cancelamento,
 * classificação de erro, redação, cercas) é comum aos cinco.
 */
function montar(c: Config, tier: Tier, conteudo: string, maxTokens: number): Requisicao {
  const d = descreverProvedor(c.provedor);
  const modelo = modeloDe(c, tier);

  switch (c.provedor) {
    case "anthropic":
      return {
        url: d.url,
        // A Anthropic não usa Bearer: a chave vai em `x-api-key`, e a versão da
        // API é obrigatória no header — sem ela a requisição é recusada.
        headers: { "x-api-key": c.chave, "anthropic-version": "2023-06-01" },
        body: {
          model: modelo,
          max_tokens: maxTokens,
          messages: [{ role: "user", content: conteudo }],
        },
        extrair: (raiz) => {
          const blocos = raiz.content;
          if (!Array.isArray(blocos)) return undefined;
          // Ignora blocos que não sejam de texto (thinking, tool_use).
          const t = blocos.find(
            (b): b is { type: string; text: string } =>
              typeof b === "object" && b !== null && (b as { type?: string }).type === "text",
          );
          return t?.text;
        },
      };

    case "google":
      return {
        // A chave vai no HEADER, nunca na query da URL: URL entra em log de
        // proxy, em histórico e em relatório de erro do próprio navegador.
        url: `${d.url}/${encodeURIComponent(modelo)}:generateContent`,
        headers: { "x-goog-api-key": c.chave },
        body: {
          contents: [{ parts: [{ text: conteudo }] }],
          generationConfig: { maxOutputTokens: maxTokens },
        },
        extrair: (raiz) => {
          const candidatos = raiz.candidates;
          if (!Array.isArray(candidatos) || candidatos.length === 0) return undefined;
          const c0 = candidatos[0] as { content?: { parts?: Array<{ text?: unknown }> } };
          return c0.content?.parts?.[0]?.text;
        },
      };

    case "openrouter":
      return requisicaoOpenAiCompativel(
        c,
        d.url,
        modelo,
        conteudo,
        HEADERS_OPENROUTER,
        maxTokens,
      );

    case "openai":
    case "ollama-cloud":
      return requisicaoOpenAiCompativel(c, d.url, modelo, conteudo, {}, maxTokens);
  }
}

/* ------------------------------------------------------------ classificação */

/** Nome do provedor com artigo, para a frase sair legível. */
function comArtigo(id: ProvedorId): string {
  const label = descreverProvedor(id).label;
  return id === "google" ? `o ${label}` : `a ${label}`;
}

/**
 * Erro → código, **pelo status HTTP e só por ele**. Nada de procurar palavra no
 * corpo: o corpo nem chega até aqui.
 */
function classificar(err: unknown, c: Config, tier: Tier): LlmError {
  if (err instanceof LlmError) return err;

  const quem = comArtigo(c.provedor);
  const onde = descreverProvedor(c.provedor).ondePegar;

  if (err instanceof ErroHttp) {
    const s = err.status;
    if (s === 401 || s === 403) {
      return new LlmError(
        "CREDENCIAL",
        `${quem} recusou a chave. Confira ou gere outra em ${onde} e cole nas opções da extensão.`,
      );
    }
    if (s === 429) {
      return new LlmError(
        "COTA",
        `${quem} respondeu limite de uso (429). Espere alguns minutos ou confira o saldo e os limites da sua conta.`,
      );
    }
    if (s >= 500 || s === 0 || s === 408) {
      return new LlmError(
        "FORA_DO_AR",
        `${quem} não respondeu (${s}). Tente de novo em instantes; se persistir, veja a página de status do fornecedor.`,
      );
    }
    if (s === 404) {
      return new LlmError(
        "FALHA",
        `${quem} não conhece o modelo "${modeloDe(c, tier)}" (404). Ajuste o modelo nas opções da extensão.`,
      );
    }
    return new LlmError("FALHA", `${quem} recusou a requisição (${s}).`);
  }

  const msg = err instanceof Error ? redigir(err.message, c.chave) : "falha desconhecida";
  return new LlmError("FALHA", `${quem}: ${msg}`);
}

/* ------------------------------------------------------------------ execução */

async function executar(
  c: Config,
  p: PedidoLlm,
  timeoutMs: number,
  maxTokens: number,
): Promise<string> {
  const tier: Tier = p.tier ?? "balanced";
  const req = montar(c, tier, juntar(p.prompt, p.input), maxTokens);

  const json = await postJson({
    url: req.url,
    headers: req.headers,
    body: req.body,
    timeoutMs,
    signal: p.signal,
    label: comArtigo(c.provedor),
    chave: c.chave,
  });

  if (typeof json !== "object" || json === null) {
    throw new LlmError("FALHA", `${comArtigo(c.provedor)} devolveu um corpo inesperado.`);
  }
  const valor = req.extrair(json as Record<string, unknown>);
  if (typeof valor !== "string" || valor.trim() === "") {
    throw new LlmError("FALHA", `${comArtigo(c.provedor)} devolveu uma resposta sem texto.`);
  }
  return valor;
}

/**
 * Executa uma chamada e devolve o texto, já sem cercas de markdown.
 * Uma tentativa e um retry — igual ao app Node. Credencial recusada não melhora
 * na segunda vez, então esse caso sai na primeira.
 */
export async function runLLM(p: PedidoLlm): Promise<string> {
  const c = await lerConfig();
  if (!c) {
    throw new LlmError(
      "SEM_CONFIG",
      "Nenhum provedor de IA configurado. Abra as opções da extensão, escolha um provedor e cole sua chave — ela fica só neste aparelho.",
    );
  }

  const timeoutMs = p.timeoutMs ?? TIMEOUT_PADRAO_MS;
  let ultimo: unknown;

  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    try {
      return stripFences(await executar(c, p, timeoutMs, 16_000));
    } catch (err) {
      ultimo = err;
      if (p.signal?.aborted) throw err; // cancelamento não se repete
      if (err instanceof ErroHttp && (err.status === 401 || err.status === 403)) break;
      if (err instanceof ErroHttp && err.status === 404) break;
      if (err instanceof LlmError) break;
    }
  }

  throw classificar(ultimo, c, p.tier ?? "balanced");
}

/**
 * Valida a credencial com a menor chamada possível — para o botão "testar" das
 * opções, que precisa responder antes de a pessoa salvar e descobrir depois.
 *
 * Recebe a `Config` por parâmetro (e não do storage) exatamente para testar o
 * que está DIGITADO na tela, ainda não salvo.
 */
export async function testarCredencial(c: Config): Promise<{ ok: true } | { ok: false; erro: string }> {
  try {
    // "fast" e resposta curta: o que se está medindo é a credencial, não o modelo.
    await executar(c, { prompt: "Responda apenas: ok", tier: "fast" }, TIMEOUT_TESTE_MS, 16);
    return { ok: true };
  } catch (err) {
    // `executar` só lança `LlmError` direto quando o corpo veio vazio ou fora do
    // formato — e isso, para este teste, é APROVAÇÃO: a requisição foi aceita,
    // logo a chave vale. Erro de status (recusa, cota, 404 de modelo, fora do
    // ar) passa por `classificar` e reprova, com o texto que a pessoa vai ler.
    if (err instanceof LlmError) return { ok: true };
    const e = classificar(err, c, "fast");
    return { ok: false, erro: redigir(e.message, c.chave) };
  }
}
