/**
 * Configuração do provedor de IA da extensão.
 *
 * O modelo de confiança aqui é o mesmo do app: **a chave é da pessoa e nunca sai
 * da máquina dela**. A extensão fala direto com o fornecedor a partir do
 * navegador — não existe servidor nosso no caminho, então não existe lugar nosso
 * onde a chave possa ser gravada, logada ou vazada.
 *
 * O vocabulário de tier ("fast" / "balanced") é o mesmo do app Node: quem pede
 * declara o que a TAREFA exige, e cada provedor traduz isso para um modelo seu.
 * O provedor `claude-cli` do app não existe aqui — é um binário local, e uma
 * extensão de navegador não executa binário.
 */

export type ProvedorId = "anthropic" | "openai" | "openrouter" | "ollama-cloud" | "google";

export interface Config {
  provedor: ProvedorId;
  chave: string;
  /** Vazio/nulo = usa o padrão do provedor para o tier pedido. */
  modelo: string | null;
}

export interface DescricaoProvedor {
  id: ProvedorId;
  label: string;
  /**
   * Endpoint do provedor. Para todos menos o Google é a URL final; no Google é a
   * BASE dos modelos (`.../models`), porque o modelo entra no caminho da URL —
   * ver `llm.ts`. A chave nunca entra aqui: vai sempre em header.
   */
  url: string;
  /** Onde a pessoa gera a própria chave. Aparece na tela de opções. */
  ondePegar: string;
  padraoBalanced: string;
  padraoFast: string;
  /**
   * `true` quando o catálogo do fornecedor é grande e muda com frequência —
   * qualquer padrão que a gente fixe envelhece em semanas, então a tela de
   * opções exige que a pessoa escolha o modelo.
   */
  precisaModelo: boolean;
}

/**
 * Ordem idêntica à do app Node (`resolverProvedor`), para que as duas metades do
 * projeto listem os fornecedores do mesmo jeito e ninguém precise reconciliar
 * duas listas ao ler a documentação.
 */
export const PROVEDORES: ReadonlyArray<DescricaoProvedor> = [
  {
    id: "anthropic",
    label: "Anthropic",
    url: "https://api.anthropic.com/v1/messages",
    ondePegar: "console.anthropic.com/settings/keys",
    padraoBalanced: "claude-sonnet-5",
    padraoFast: "claude-haiku-4-5",
    precisaModelo: false,
  },
  {
    id: "openai",
    label: "OpenAI",
    url: "https://api.openai.com/v1/chat/completions",
    ondePegar: "platform.openai.com/api-keys",
    padraoBalanced: "gpt-4o",
    padraoFast: "gpt-4o-mini",
    precisaModelo: false,
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    url: "https://openrouter.ai/api/v1/chat/completions",
    ondePegar: "openrouter.ai/keys — catálogo em openrouter.ai/models",
    padraoBalanced: "openai/gpt-4o",
    padraoFast: "openai/gpt-4o-mini",
    precisaModelo: true,
  },
  {
    id: "ollama-cloud",
    label: "Ollama Cloud",
    url: "https://ollama.com/v1/chat/completions",
    ondePegar: "ollama.com/settings/keys — catálogo em ollama.com/library",
    padraoBalanced: "gpt-oss:120b",
    padraoFast: "gpt-oss:20b",
    precisaModelo: true,
  },
  {
    id: "google",
    label: "Google",
    // Base: `llm.ts` acrescenta `/<modelo>:generateContent`.
    url: "https://generativelanguage.googleapis.com/v1beta/models",
    ondePegar: "aistudio.google.com/apikey",
    padraoBalanced: "gemini-2.0-flash",
    padraoFast: "gemini-2.0-flash",
    precisaModelo: false,
  },
];

export function descreverProvedor(id: ProvedorId): DescricaoProvedor {
  const d = PROVEDORES.find((p) => p.id === id);
  // Config antiga com um id que não existe mais: melhor falhar aqui, com nome,
  // do que montar uma requisição para `undefined`.
  if (!d) throw new Error(`Provedor desconhecido: "${id}". Reconfigure nas opções.`);
  return d;
}

const CHAVE_STORAGE = "bruto.config";

/**
 * Tipagem mínima do que usamos de `chrome.storage`.
 *
 * Declarada aqui em vez de depender de `@types/chrome`: são três métodos, e a
 * extensão não carrega dependência que não precisa.
 */
interface AreaStorage {
  get(chaves: string[]): Promise<Record<string, unknown>>;
  set(itens: Record<string, unknown>): Promise<void>;
  remove(chaves: string[]): Promise<void>;
}

interface ChromeMinimo {
  storage?: { local?: AreaStorage };
}

/**
 * SEMPRE `chrome.storage.local`, NUNCA `chrome.storage.sync`.
 *
 * `sync` replica o conteúdo, pela conta Google, para todos os dispositivos onde
 * aquele perfil estiver logado — inclusive máquinas emprestadas e compartilhadas.
 * Uma chave de API é credencial de cobrança: ela fica no aparelho onde a pessoa
 * a digitou, e em nenhum outro. `local` também não tem o limite de 8 KB por item
 * do `sync`, mas o motivo aqui é segurança, não tamanho.
 */
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

/** Aceita só o que tem o formato esperado — storage é entrada, não verdade. */
function validar(bruto: unknown): Config | null {
  if (typeof bruto !== "object" || bruto === null) return null;
  const o = bruto as Record<string, unknown>;

  const provedor = o.provedor;
  if (typeof provedor !== "string") return null;
  if (!PROVEDORES.some((p) => p.id === provedor)) return null;

  const chave = o.chave;
  if (typeof chave !== "string" || chave.trim() === "") return null;

  const modelo = typeof o.modelo === "string" && o.modelo.trim() !== "" ? o.modelo.trim() : null;

  return { provedor: provedor as ProvedorId, chave: chave.trim(), modelo };
}

/** `null` quando ainda não há configuração utilizável — não é erro. */
export async function lerConfig(): Promise<Config | null> {
  const dados = await storageLocal().get([CHAVE_STORAGE]);
  return validar(dados[CHAVE_STORAGE]);
}

export async function salvarConfig(c: Config): Promise<void> {
  const limpa: Config = {
    provedor: c.provedor,
    chave: c.chave.trim(),
    // Espaço em volta do nome do modelo é o erro de colar mais comum, e produz
    // um 404 que não parece com o que é.
    modelo: c.modelo && c.modelo.trim() !== "" ? c.modelo.trim() : null,
  };
  if (limpa.chave === "") throw new Error("A chave não pode ficar em branco.");
  descreverProvedor(limpa.provedor);
  await storageLocal().set({ [CHAVE_STORAGE]: limpa });
}

/** Remove a chave do aparelho. Usado pelo botão "esquecer minha chave". */
export async function limparConfig(): Promise<void> {
  await storageLocal().remove([CHAVE_STORAGE]);
}
