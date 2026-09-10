/**
 * Provedor: API da Anthropic (Messages API), com a chave do próprio usuário.
 *
 * Modelos por tier — IDs completos, sem sufixo de data:
 *   fast     claude-haiku-4-5
 *   balanced claude-sonnet-5
 *   deep     claude-opus-5
 * Sobrescrevíveis por BRUTO_MODEL_FAST / _BALANCED / _DEEP.
 *
 * Busca web não está ligada aqui: a Messages API tem a server tool `web_search`,
 * mas ela cobra por uso e o único step que a pediria (as referências da Aula) é
 * opt-in e degrada de forma explícita. Ver a nota em `index.ts`.
 */

import { PipelineError } from "@/pipeline/types";
import { extrairTexto, postJson } from "./http";
import type { LlmCapability, LlmProvider, LlmRequest, LlmResult } from "../types";

const PADRAO: Record<string, string> = {
  fast: "claude-haiku-4-5",
  balanced: "claude-sonnet-5",
  deep: "claude-opus-5",
};

function modeloPara(tier: string): string {
  const env = {
    fast: process.env.BRUTO_MODEL_FAST,
    balanced: process.env.BRUTO_MODEL_BALANCED,
    deep: process.env.BRUTO_MODEL_DEEP,
  }[tier];
  return env || PADRAO[tier];
}

export const anthropicProvider: LlmProvider = {
  id: "anthropic",
  label: "Anthropic",
  envVar: "ANTHROPIC_API_KEY",

  supports(_capability: LlmCapability): boolean {
    return false;
  },

  async availability() {
    if (!process.env.ANTHROPIC_API_KEY) {
      return {
        ok: false as const,
        reason: "defina ANTHROPIC_API_KEY no seu .env (a chave fica na sua máquina)",
      };
    }
    return { ok: true as const };
  },

  async run(req: LlmRequest, timeoutMs: number): Promise<LlmResult> {
    const chave = process.env.ANTHROPIC_API_KEY;
    if (!chave) throw new PipelineError("LLM_NOT_CONFIGURED", "ANTHROPIC_API_KEY não definida");

    const model = modeloPara(req.tier ?? "balanced");
    // O prompt e o texto longo vão na mesma mensagem: o prompt manda, o input é
    // o material. Mesma semântica do stdin que o CLI recebia.
    const conteudo = req.input ? `${req.prompt}\n\n---\n\n${req.input}` : req.prompt;

    const json = await postJson({
      url: "https://api.anthropic.com/v1/messages",
      headers: { "x-api-key": chave, "anthropic-version": "2023-06-01" },
      body: {
        model,
        max_tokens: 16000,
        messages: [{ role: "user", content: conteudo }],
      },
      timeoutMs,
      label: "a Anthropic",
    });

    const texto = extrairTexto(
      json,
      (raiz) => {
        const blocos = raiz.content;
        if (!Array.isArray(blocos)) return undefined;
        // Ignora blocos que não sejam de texto (thinking, tool_use).
        const t = blocos.find(
          (b): b is { type: string; text: string } =>
            typeof b === "object" && b !== null && (b as { type?: string }).type === "text",
        );
        return t?.text;
      },
      "a Anthropic",
    );

    return { text: texto, provider: "anthropic", model };
  },
};
