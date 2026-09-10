/**
 * Provedor: API do Google (Gemini), com a chave do próprio usuário.
 * Aceita GOOGLE_API_KEY ou GEMINI_API_KEY — as duas circulam na documentação
 * deles, e obrigar a pessoa a adivinhar qual é seria atrito à toa.
 * Modelos sobrescrevíveis por BRUTO_MODEL_FAST / _BALANCED / _DEEP.
 */

import { PipelineError } from "@/pipeline/types";
import { extrairTexto, postJson } from "./http";
import type { LlmCapability, LlmProvider, LlmRequest, LlmResult } from "../types";

const PADRAO: Record<string, string> = {
  fast: "gemini-2.0-flash",
  balanced: "gemini-2.0-flash",
  deep: "gemini-2.5-pro",
};

function modeloPara(tier: string): string {
  const env = {
    fast: process.env.BRUTO_MODEL_FAST,
    balanced: process.env.BRUTO_MODEL_BALANCED,
    deep: process.env.BRUTO_MODEL_DEEP,
  }[tier];
  return env || PADRAO[tier];
}

function chaveDoAmbiente(): string | undefined {
  return process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
}

export const googleProvider: LlmProvider = {
  id: "google",
  label: "Google",
  envVar: "GOOGLE_API_KEY",

  supports(_capability: LlmCapability): boolean {
    return false;
  },

  async availability() {
    if (!chaveDoAmbiente()) {
      return {
        ok: false as const,
        reason: "defina GOOGLE_API_KEY (ou GEMINI_API_KEY) no seu .env",
      };
    }
    return { ok: true as const };
  },

  async run(req: LlmRequest, timeoutMs: number): Promise<LlmResult> {
    const chave = chaveDoAmbiente();
    if (!chave) throw new PipelineError("LLM_NOT_CONFIGURED", "GOOGLE_API_KEY não definida");

    const model = modeloPara(req.tier ?? "balanced");
    const conteudo = req.input ? `${req.prompt}\n\n---\n\n${req.input}` : req.prompt;

    const json = await postJson({
      // A chave vai no header, nunca na URL: URL entra em log de proxy.
      url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      headers: { "x-goog-api-key": chave },
      body: { contents: [{ parts: [{ text: conteudo }] }] },
      timeoutMs,
      label: "o Google",
    });

    const texto = extrairTexto(
      json,
      (raiz) => {
        const candidatos = raiz.candidates;
        if (!Array.isArray(candidatos) || candidatos.length === 0) return undefined;
        const c = candidatos[0] as { content?: { parts?: Array<{ text?: unknown }> } };
        return c.content?.parts?.[0]?.text;
      },
      "o Google",
    );

    return { text: texto, provider: "google", model };
  },
};
