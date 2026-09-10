/**
 * `runLLM` — a única porta do pipeline para um modelo de linguagem.
 *
 * O que mudou em relação ao `runClaude` que existia antes:
 *
 *  1. **Tier, não modelo.** O step diz o que a tarefa precisa; o provedor
 *     escolhe o modelo. Trocar de fornecedor deixou de ser mexer em seis steps.
 *  2. **Erro por STATUS, não por regex no corpo.** O classificador anterior
 *     jogava stderr+stdout na mensagem da exceção — e ela é gravada em
 *     `jobs.error_message`. Com chave do usuário, isso gravaria a chave no
 *     banco. Agora o corpo do erro é descartado no transporte e só o status
 *     atravessa.
 *  3. **Capacidade negociada, nunca degradada em silêncio.** Se o step exige
 *     busca web e o provedor não tem, `runLLM` lança LLM_CAPABILITY — cabe ao
 *     step decidir se aquilo é fatal ou se ele segue sem, dizendo que seguiu.
 */

import { PipelineError } from "@/pipeline/types";
import { claudeCliProvider } from "./providers/claude-cli";
import { anthropicProvider } from "./providers/anthropic";
import {
  openaiProvider,
  openrouterProvider,
  ollamaCloudProvider,
} from "./providers/openai-compativel";
import { googleProvider } from "./providers/google";
import { LlmHttpError } from "./providers/http";
import { redact } from "./redact";
import { stripFences } from "./parse";
import type { LlmProvider, LlmRequest, LlmResult, ProviderId } from "./types";

export { stripFences };
export type { LlmRequest, LlmResult, LlmTier, LlmCapability, ProviderId } from "./types";

const REGISTRO: Record<ProviderId, LlmProvider> = {
  "claude-cli": claudeCliProvider,
  anthropic: anthropicProvider,
  openai: openaiProvider,
  openrouter: openrouterProvider,
  "ollama-cloud": ollamaCloudProvider,
  google: googleProvider,
};

const TIMEOUT_PADRAO_MS = 180_000;

let escolhido: LlmProvider | null = null;

/** Lista os provedores, para o doctor mostrar o estado de cada um. */
export function listarProvedores(): LlmProvider[] {
  return Object.values(REGISTRO);
}

/**
 * Resolve o provedor uma vez por processo.
 *
 * Ordem: variável explícita > chave de API presente > Claude CLI instalado.
 * Quem configurou uma chave quer usá-la; quem não configurou nada e tem o
 * Claude Code cai no caminho de zero configuração, que é como o projeto sempre
 * funcionou.
 */
export async function resolverProvedor(): Promise<LlmProvider> {
  if (escolhido) return escolhido;

  const pedido = process.env.BRUTO_LLM_PROVIDER as ProviderId | undefined;
  if (pedido) {
    const p = REGISTRO[pedido];
    if (!p) {
      throw new PipelineError(
        "LLM_NOT_CONFIGURED",
        `BRUTO_LLM_PROVIDER="${pedido}" não existe. Use: ${Object.keys(REGISTRO).join(", ")}.`,
      );
    }
    const disp = await p.availability();
    if (!disp.ok) {
      throw new PipelineError(
        "LLM_NOT_CONFIGURED",
        `Provedor "${pedido}" está indisponível: ${disp.reason}`,
      );
    }
    escolhido = p;
    return p;
  }

  const ordem: ProviderId[] = [
    "anthropic",
    "openai",
    "openrouter",
    "ollama-cloud",
    "google",
    "claude-cli",
  ];
  const motivos: string[] = [];
  for (const id of ordem) {
    const p = REGISTRO[id];
    // Para os de API, só tentamos quem já tem chave — senão o autodetect
    // "escolheria" um provedor que o usuário nem configurou.
    const disp = await p.availability();
    if (disp.ok) {
      escolhido = p;
      return p;
    }
    motivos.push(`  · ${p.label}: ${disp.reason}`);
  }

  throw new PipelineError(
    "LLM_NOT_CONFIGURED",
    `Nenhum provedor de IA configurado. Escolha um:\n${motivos.join("\n")}\n` +
      `Copie .env.example para .env e preencha uma chave, ou instale o Claude Code.`,
  );
}

/** Só para teste: força o próximo resolve a recomeçar. */
export function resetarProvedor(): void {
  escolhido = null;
}

function classificar(err: unknown, provedor: LlmProvider): PipelineError {
  if (err instanceof PipelineError) return err;

  if (err instanceof LlmHttpError) {
    const s = err.status;
    if (s === 401 || s === 403) {
      return new PipelineError(
        "LLM_AUTH",
        `${provedor.label} recusou a credencial. Confira ${provedor.envVar ?? "a autenticação local"}.`,
      );
    }
    if (s === 429) {
      return new PipelineError("LLM_QUOTA", `${provedor.label} respondeu limite de uso (429).`);
    }
    if (s >= 500 || s === 0 || s === 408) {
      return new PipelineError("LLM_UPSTREAM", `${provedor.label} está indisponível (${s}).`);
    }
    return new PipelineError("UNKNOWN", `${provedor.label} recusou a requisição (${s}).`);
  }

  const msg = err instanceof Error ? redact(err.message) : "falha desconhecida";
  // Rede de segurança para o provedor de CLI, que não fala em status HTTP.
  if (/limit|quota|rate|overloaded/i.test(msg)) {
    return new PipelineError("LLM_QUOTA", `${provedor.label}: ${msg}`);
  }
  return new PipelineError("UNKNOWN", `${provedor.label}: ${msg}`);
}

/**
 * Executa uma chamada e devolve o texto, já sem cercas de markdown.
 * Uma tentativa inicial e um retry — o mesmo que o wrapper anterior fazia.
 */
export async function runLLM(req: LlmRequest): Promise<LlmResult> {
  const provedor = await resolverProvedor();
  const timeoutMs = req.timeoutMs ?? TIMEOUT_PADRAO_MS;

  for (const capacidade of req.requires ?? []) {
    if (!provedor.supports(capacidade)) {
      throw new PipelineError(
        "LLM_CAPABILITY",
        `${provedor.label} não faz ${capacidade === "webSearch" ? "busca web" : capacidade}.`,
      );
    }
  }

  let ultimo: unknown;
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    try {
      const r = await provedor.run(req, timeoutMs);
      return { ...r, text: stripFences(r.text) };
    } catch (err) {
      ultimo = err;
      // Credencial errada e capacidade ausente não melhoram na segunda vez.
      if (err instanceof LlmHttpError && (err.status === 401 || err.status === 403)) break;
      if (err instanceof PipelineError && err.code === "LLM_CAPABILITY") break;
    }
  }

  throw classificar(ultimo, provedor);
}

/** Açúcar para quem só quer o texto — a maioria dos steps. */
export async function runLLMText(req: LlmRequest): Promise<string> {
  return (await runLLM(req)).text;
}
