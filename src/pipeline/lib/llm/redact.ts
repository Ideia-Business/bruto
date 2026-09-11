/**
 * Redação de segredo em texto que vai para fora do processo.
 *
 * Por que existe: o classificador de erro anterior concatenava stderr, stdout e
 * a razão da falha na mensagem da exceção — e essa mensagem é gravada em
 * `jobs.error_message`, no banco. Enquanto a autenticação era a sessão local do
 * Claude, isso era inofensivo. Com chave própria do usuário, **grava a chave
 * dele no banco**. Redigir é o primeiro movimento, não o último.
 *
 * A varredura é em duas frentes porque nenhuma sozinha basta:
 *  1. pelo VALOR das variáveis de ambiente conhecidas — pega a chave exata,
 *     mesmo em formato que nenhum padrão preveria;
 *  2. por formato conhecido — pega chave que veio de outro lugar (colada num
 *     prompt, devolvida por uma API, escrita à mão num config).
 */

/**
 * Variáveis cujo VALOR nunca pode aparecer em texto que sai daqui.
 *
 * MANTENHA EM DIA: esta lista já ficou para trás uma vez. Quando OpenRouter e
 * Ollama Cloud foram acrescentados como provedores, ninguém voltou aqui — e por
 * um tempo a chave dessas duas não era redigida. **Provedor novo entra aqui no
 * mesmo commit**, e o teste em `redact` cobre a lista inteira justamente para
 * que o esquecimento apareça.
 */
const ENV_SENSIVEIS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "OLLAMA_API_KEY",
  "GOOGLE_API_KEY",
  "GEMINI_API_KEY",
  "BRUTO_LLM_API_KEY",
];

/** Formatos públicos e estáveis de credencial dos fornecedores suportados. */
const PADROES: readonly RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{16,}/g, // Anthropic
  /sk-or-v1-[A-Za-z0-9]{16,}/g, // OpenRouter
  /sk-proj-[A-Za-z0-9_-]{16,}/g, // OpenAI (projeto)
  /sk-[A-Za-z0-9_-]{20,}/g, // OpenAI legado, e qualquer `sk-` longo
  /AIza[A-Za-z0-9_-]{20,}/g, // Google
  /\bBearer\s+[A-Za-z0-9._-]{16,}/gi, // header inteiro
];

const MARCA = "<REDACTED>";

/** Escapa metacaracteres para usar um valor arbitrário como padrão literal. */
function escaparRegex(v: string): string {
  return v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Devolve o texto sem segredo. Seguro para mensagem de erro, log e banco.
 * Nunca lança: falhar ao redigir não pode derrubar o pipeline — mas também
 * não pode deixar passar, então o caminho de erro devolve texto neutro.
 */
export function redact(texto: string): string {
  try {
    let out = texto;

    for (const nome of ENV_SENSIVEIS) {
      const valor = process.env[nome];
      // Valor curto demais não é chave — e viraria substituição em massa.
      if (valor && valor.length >= 12) {
        out = out.replace(new RegExp(escaparRegex(valor), "g"), MARCA);
      }
    }

    for (const p of PADROES) out = out.replace(p, MARCA);

    return out;
  } catch {
    return "(texto omitido: falha ao redigir)";
  }
}
