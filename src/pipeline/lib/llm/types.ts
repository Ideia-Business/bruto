/**
 * Contrato da camada de modelo de linguagem.
 *
 * A regra que sustenta o desenho: **o pipeline pede TIER, nunca modelo.**
 * "sonnet" é vocabulário de um fornecedor; "equilibrado" é vocabulário da
 * tarefa. Cada provedor traduz tier → modelo seu, e trocar de fornecedor
 * deixa de ser mexer em seis arquivos de step.
 */

/** O que a tarefa exige do modelo, em vez de qual modelo ela quer. */
export type LlmTier =
  /** Classificação, extração curta — barato e rápido. */
  | "fast"
  /** O padrão: resumo, mapa, aula, tradução. */
  | "balanced"
  /** Reservado a raciocínio caro; nenhum step usa hoje. */
  | "deep";

/** Capacidade além de gerar texto. Nem todo provedor tem todas. */
export type LlmCapability = "webSearch";

export type ProviderId =
  | "claude-cli"
  | "codex-cli"
  | "anthropic"
  | "openai"
  | "openrouter"
  | "ollama-cloud"
  | "google";

export interface LlmRequest {
  /** Só para diagnóstico e log — nunca muda o comportamento. */
  task:
    | "summary"
    | "mindmap"
    | "category"
    | "translate"
    | "study"
    | "references"
    | "transcript_organized"
    | "transcript_llm";
  prompt: string;
  /** Texto longo que acompanha o prompt (transcrição, contexto). */
  input?: string;
  /** Default: "balanced". */
  tier?: LlmTier;
  /** Se o provedor não tiver, `runLLM` lança LLM_CAPABILITY — nunca degrada calado. */
  requires?: LlmCapability[];
  timeoutMs?: number;
}

export interface LlmResult {
  text: string;
  provider: ProviderId;
  model: string;
}

export interface LlmProvider {
  readonly id: ProviderId;
  /** Nome legível, para mensagem de erro e para o doctor. */
  readonly label: string;
  /** Nome da variável de ambiente que guarda a chave (nunca o valor). */
  readonly envVar: string | null;
  supports(capability: LlmCapability): boolean;
  /** Está utilizável nesta máquina? Motivo em texto quando não. */
  availability(): Promise<{ ok: true } | { ok: false; reason: string }>;
  run(req: LlmRequest, timeoutMs: number): Promise<LlmResult>;
}
