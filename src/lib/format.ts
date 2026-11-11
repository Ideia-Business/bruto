/** Helpers de formatação e rótulos PT-BR compartilhados pela UI. */

import { PLATAFORMAS } from "@/lib/plataformas";

export function formatDuration(sec: number | null | undefined): string {
  if (!sec || sec <= 0) return "";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** upload_date do yt-dlp (YYYYMMDD) → "23 jul 2026". */
export function formatUploadDate(yyyymmdd: string | null | undefined): string {
  if (!yyyymmdd || yyyymmdd.length !== 8) return "";
  const meses = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const y = yyyymmdd.slice(0, 4);
  const m = Number(yyyymmdd.slice(4, 6));
  const d = yyyymmdd.slice(6, 8);
  return `${d} ${meses[m - 1] ?? "?"} ${y}`;
}

/** Rótulo da plataforma de origem (badge). Deriva de `PLATAFORMAS` — a fonte única. */
export const PLATFORM_LABEL: Record<string, string> = Object.fromEntries(
  PLATAFORMAS.map((p) => [p.id, p.label]),
);

/** Rótulo amigável da fonte da transcrição (badge de qualidade). */
export const TRANSCRIPT_SOURCE_LABEL: Record<string, string> = {
  manual_subs: "Legenda oficial",
  auto_subs: "Legenda automática",
  yta: "Legenda (API)",
  whisper: "Transcrição por IA",
};

/** Rótulo PT-BR de cada etapa do pipeline (progresso). */
export const STEP_LABEL: Record<string, string> = {
  metadata: "Buscando metadados",
  transcript: "Transcrevendo",
  translate: "Traduzindo para PT-BR",
  summary: "Gerando resumo",
  mindmap: "Montando mapa mental",
  category: "Classificando",
  export: "Exportando arquivos",
};

/**
 * O texto de erro que a tela mostra. Para `NO_TRANSCRIPT` a mensagem do job
 * vence a dica genérica: o mesmo código cobre "não há transcritor" e "o
 * transcritor rodou e falhou", e só a mensagem distingue um do outro (Grok,
 * 25/09). Ela já sai redigida da transcrição (`redact`).
 */
export function textoDoErro(codigo: string | null | undefined, mensagem: string | null | undefined): string {
  const c = codigo ?? "UNKNOWN";
  if (c === "NO_TRANSCRIPT" && mensagem) return mensagem;
  return ERROR_HINT[c] ?? mensagem ?? ERROR_HINT.UNKNOWN;
}

/**
 * Rótulo PT-BR + orientação de cada código de erro.
 *
 * Os textos são NEUTROS quanto ao modo: o componente que os mostra não
 * sabe se roda no app instalado ou no clone, então nenhum hint pode mandar
 * a pessoa a um arquivo/comando que só existe num dos modos (`.env`,
 * `.env.example`, `npm run …`, o instalador do repositório). Quando a saída
 * difere por modo, o texto nomeia os DOIS caminhos ("no app instalado …;
 * no código-fonte …").
 */
export const ERROR_HINT: Record<string, string> = {
  BOT_CHECK:
    "O YouTube pediu verificação anti-robô. Aguarde alguns minutos e tente novamente.",
  RATE_LIMIT: "Muitas requisições à plataforma. Tente novamente em alguns minutos.",
  LOGIN_REQUIRED:
    "A plataforma recusou o acesso sem login — comum no Instagram depois de vários vídeos seguidos. O Bruto já tentou de novo sozinho; espere alguns minutos e reprocesse.",
  YTDLP_OUTDATED:
    "O extrator de vídeo está desatualizado. No app instalado ele se atualiza sozinho — reprocesse em alguns minutos; no código-fonte, rode: uv tool upgrade yt-dlp",
  NO_TRANSCRIPT:
    "Vídeo sem legenda e sem transcritor instalado. No app instalado, ative a transcrição local (Whisper) nas Configurações; no código-fonte, rode o instalador do Bruto de novo sem --sem-whisper.",
  LLM_QUOTA: "O provedor de IA respondeu limite de uso. Tente novamente mais tarde.",
  LLM_AUTH:
    "O provedor de IA recusou a credencial. Confira a chave de API — no app instalado ela fica em ~/.bruto/.env; no código-fonte, no .env.",
  LLM_UPSTREAM: "O provedor de IA está fora do ar. Tente reprocessar em alguns minutos.",
  LLM_CAPABILITY:
    "O provedor configurado não tem um recurso que esta etapa pediu. O resto foi gerado normalmente.",
  LLM_NOT_CONFIGURED:
    "Nenhum provedor de IA configurado. Entre no Claude Code (claude) ou no Codex (codex login) neste computador e reprocesse — usa o plano que você já paga. Para usar chave de API: no app instalado, crie o arquivo ~/.bruto/.env com a chave; no código-fonte, edite o .env.",
  UNKNOWN: "Ocorreu um erro inesperado. Tente reprocessar.",
};
