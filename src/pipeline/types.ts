/** Contratos compartilhados do pipeline — fonte única de verdade dos tipos. */

export type JobStatus = "queued" | "running" | "done" | "error";

export type JobStep =
  | "metadata"
  | "transcript"
  | "translate"
  | "summary"
  | "mindmap"
  | "category"
  | "export";

export type ErrorCode =
  | "BOT_CHECK"
  | "RATE_LIMIT"
  | "YTDLP_OUTDATED"
  | "NO_TRANSCRIPT"
  | "LLM_QUOTA"
  | "LLM_AUTH"
  | "LLM_UPSTREAM"
  | "LLM_CAPABILITY"
  | "LLM_NOT_CONFIGURED"
  | "UNKNOWN";

export type TranscriptSource = "manual_subs" | "auto_subs" | "yta" | "whisper";

/** Erro tipado do pipeline — errorCode vira CTA específico na UI. */
export class PipelineError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "PipelineError";
    this.code = code;
  }
}

/** Subset do --dump-json do yt-dlp que o app consome. */
export interface VideoMetadata {
  id: string;
  url: string;
  platform: "youtube" | "instagram" | "tiktok";
  title: string;
  channel: string | null;
  durationSec: number | null;
  uploadDate: string | null; // YYYYMMDD
  language: string | null;
  description: string | null;
  chapters: Array<{ start_time: number; end_time: number; title: string }>;
  tags: string[];
  /** Faixas de legenda MANUAIS disponíveis (códigos de idioma). */
  subtitleLangs: string[];
  /** Faixas de legenda AUTOMÁTICAS disponíveis (códigos de idioma). */
  autoCaptionLangs: string[];
  thumbnailUrl: string | null;
}

export interface TranscriptResult {
  source: TranscriptSource;
  /** Texto limpo em parágrafos (input do LLM). */
  text: string;
  /** Texto com [hh:mm:ss] por bloco (artefato transcript.timestamps.txt). */
  timestampedText: string;
}

/** Snapshot de progresso emitido a cada transição (SSE na Fase 2). */
export interface JobProgress {
  jobId: string;
  videoId: string | null;
  status: JobStatus;
  step: JobStep | null;
  progressPct: number;
  errorCode: ErrorCode | null;
  errorMessage: string | null;
}
