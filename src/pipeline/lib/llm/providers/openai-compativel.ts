/**
 * Fábrica de provedores que falam o dialeto `/chat/completions` da OpenAI.
 *
 * OpenAI, OpenRouter e Ollama Cloud usam o mesmo formato de requisição e de
 * resposta — o que muda é a URL, a variável da chave e o catálogo de modelos.
 * Três arquivos quase idênticos seriam três lugares para o mesmo bug; aqui é
 * um. Acrescentar um provedor compatível passa a ser uma chamada desta função.
 */

import { PipelineError } from "@/pipeline/types";
import { extrairTexto, postJson } from "./http";
import type { LlmCapability, LlmProvider, LlmRequest, LlmResult, ProviderId } from "../types";

export interface DefinicaoCompativel {
  id: ProviderId;
  label: string;
  /** Nome da variável de ambiente — nunca o valor. */
  envVar: string;
  /** Variáveis alternativas aceitas (o fornecedor documenta mais de um nome). */
  envAlternativas?: string[];
  /** URL completa do endpoint de chat completions. */
  url: string;
  /** Modelo por tier. Sempre sobrescrevível por BRUTO_MODEL_*. */
  padrao: Record<string, string>;
  /** Cabeçalhos extras exigidos pelo fornecedor. */
  headersExtras?: Record<string, string>;
  /** Frase que ajuda quem não configurou ainda. */
  comoConfigurar: string;
}

function lerChave(def: DefinicaoCompativel): string | undefined {
  for (const nome of [def.envVar, ...(def.envAlternativas ?? [])]) {
    const v = process.env[nome];
    if (v) return v;
  }
  return undefined;
}

function modeloPara(def: DefinicaoCompativel, tier: string): string {
  const env = {
    fast: process.env.BRUTO_MODEL_FAST,
    balanced: process.env.BRUTO_MODEL_BALANCED,
    deep: process.env.BRUTO_MODEL_DEEP,
  }[tier];
  return env || def.padrao[tier];
}

export function criarProvedorCompativel(def: DefinicaoCompativel): LlmProvider {
  return {
    id: def.id,
    label: def.label,
    envVar: def.envVar,

    supports(_capability: LlmCapability): boolean {
      return false;
    },

    async availability() {
      if (!lerChave(def)) {
        return { ok: false as const, reason: def.comoConfigurar };
      }
      return { ok: true as const };
    },

    async run(req: LlmRequest, timeoutMs: number): Promise<LlmResult> {
      const chave = lerChave(def);
      if (!chave) {
        throw new PipelineError("LLM_NOT_CONFIGURED", `${def.envVar} não definida`);
      }

      const model = modeloPara(def, req.tier ?? "balanced");
      const conteudo = req.input ? `${req.prompt}\n\n---\n\n${req.input}` : req.prompt;

      const json = await postJson({
        url: def.url,
        headers: { Authorization: `Bearer ${chave}`, ...(def.headersExtras ?? {}) },
        body: { model, messages: [{ role: "user", content: conteudo }] },
        timeoutMs,
        label: def.label,
      });

      const texto = extrairTexto(
        json,
        (raiz) => {
          const escolhas = raiz.choices;
          if (!Array.isArray(escolhas) || escolhas.length === 0) return undefined;
          const primeira = escolhas[0] as { message?: { content?: unknown } };
          return primeira.message?.content;
        },
        def.label,
      );

      return { text: texto, provider: def.id, model };
    },
  };
}

export const openaiProvider = criarProvedorCompativel({
  id: "openai",
  label: "OpenAI",
  envVar: "OPENAI_API_KEY",
  url: "https://api.openai.com/v1/chat/completions",
  padrao: { fast: "gpt-4o-mini", balanced: "gpt-4o", deep: "gpt-4o" },
  comoConfigurar: "defina OPENAI_API_KEY no seu .env (a chave fica na sua máquina)",
});

export const openrouterProvider = criarProvedorCompativel({
  id: "openrouter",
  label: "OpenRouter",
  envVar: "OPENROUTER_API_KEY",
  url: "https://openrouter.ai/api/v1/chat/completions",
  // O catálogo do OpenRouter é enorme e muda toda semana. Estes são slugs
  // estáveis para começar; troque por qualquer outro com BRUTO_MODEL_*.
  padrao: {
    fast: "openai/gpt-4o-mini",
    balanced: "openai/gpt-4o",
    deep: "openai/gpt-4o",
  },
  // O OpenRouter usa estes dois para atribuir tráfego — sem segredo nenhum.
  headersExtras: {
    "HTTP-Referer": "https://github.com/Ideia-Business/bruto",
    "X-Title": "Bruto",
  },
  comoConfigurar:
    "defina OPENROUTER_API_KEY no seu .env — e escolha o modelo em BRUTO_MODEL_BALANCED (catálogo em openrouter.ai/models)",
});

export const ollamaCloudProvider = criarProvedorCompativel({
  id: "ollama-cloud",
  label: "Ollama Cloud",
  envVar: "OLLAMA_API_KEY",
  url: "https://ollama.com/v1/chat/completions",
  padrao: {
    fast: "gpt-oss:20b",
    balanced: "gpt-oss:120b",
    deep: "gpt-oss:120b",
  },
  comoConfigurar:
    "defina OLLAMA_API_KEY no seu .env — e confira o modelo em BRUTO_MODEL_BALANCED (catálogo em ollama.com/library)",
});
