/**
 * Wrapper do yt-dlp — metadata, legendas (VTT), áudio e thumbnail.
 * Todos os spawns são SEM shell (argumentos passados como array).
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { PipelineError, type ErrorCode, type VideoMetadata } from "@/pipeline/types";

/** Limite de caracteres do stderr embutido em mensagens de erro. */
const STDERR_TRUNCATE = 500;

/** Timeout padrão dos comandos yt-dlp (metadata/legendas). */
const DEFAULT_TIMEOUT_MS = 120_000;

/** Timeout do download de áudio (arquivos grandes). */
const AUDIO_TIMEOUT_MS = 600_000;

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

/**
 * Helper único de spawn do yt-dlp: captura stdout/stderr, mata o processo
 * em timeout e lança PipelineError tipado em exit != 0.
 */
function runYtdlp(args: string[], timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("yt-dlp", args, { shell: false });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (err) => {
      // Ex.: yt-dlp não encontrado no PATH.
      clearTimeout(timer);
      reject(new PipelineError("UNKNOWN", `falha ao executar yt-dlp: ${err.message}`));
    });

    child.on("close", (exitCode) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(
          new PipelineError("UNKNOWN", `yt-dlp excedeu o timeout de ${Math.round(timeoutMs / 1000)}s`),
        );
        return;
      }
      if (exitCode !== 0) {
        reject(new PipelineError(detectYtdlpError(stderr), stderr.trim().slice(0, STDERR_TRUNCATE)));
        return;
      }
      resolve({ stdout, stderr, exitCode });
    });
  });
}

/** Classifica o stderr do yt-dlp em um ErrorCode acionável na UI. */
export function detectYtdlpError(stderr: string): ErrorCode {
  if (/sign in to confirm/i.test(stderr)) return "BOT_CHECK";
  if (/HTTP Error 429|too many requests/i.test(stderr)) return "RATE_LIMIT";
  if (/unable to extract|unsupported url|extractor.*failed/i.test(stderr)) return "YTDLP_OUTDATED";
  return "UNKNOWN";
}

/** Shape mínimo do --dump-json que consumimos (campos podem faltar). */
interface RawDumpJson {
  id?: string;
  webpage_url?: string;
  title?: string;
  channel?: string;
  uploader?: string;
  duration?: number;
  upload_date?: string;
  language?: string;
  description?: string;
  chapters?: Array<{ start_time: number; end_time: number; title: string }>;
  tags?: string[];
  subtitles?: Record<string, unknown>;
  automatic_captions?: Record<string, unknown>;
  thumbnail?: string;
  extractor?: string;
  extractor_key?: string;
  webpage_url_domain?: string;
}

/** Deriva a plataforma a partir dos campos do yt-dlp. */
function detectPlatform(raw: RawDumpJson): VideoMetadata["platform"] {
  const hint = `${raw.extractor ?? ""} ${raw.extractor_key ?? ""} ${raw.webpage_url_domain ?? ""} ${raw.webpage_url ?? ""}`.toLowerCase();
  if (hint.includes("instagram")) return "instagram";
  if (hint.includes("tiktok")) return "tiktok";
  return "youtube";
}

/** Título amigável: reels/tiktoks às vezes vêm sem título "de verdade". */
function friendlyTitle(raw: RawDumpJson, platform: VideoMetadata["platform"]): string {
  const t = (raw.title ?? "").trim();
  const author = (raw.channel ?? raw.uploader ?? "").trim();
  if (t && !/^video by /i.test(t)) return t;
  // Fallback: usa a descrição curta ou o autor.
  const desc = (raw.description ?? "").trim().split("\n")[0];
  if (desc) return desc.slice(0, 100);
  if (author) {
    const label = platform === "instagram" ? "Reel" : platform === "tiktok" ? "TikTok" : "Vídeo";
    return `${label} de ${author}`;
  }
  return t || "Vídeo sem título";
}

/** Busca metadata do vídeo via --dump-json (sem baixar mídia). */
export async function fetchMetadata(url: string): Promise<VideoMetadata> {
  const { stdout } = await runYtdlp(["--skip-download", "--dump-json", "--no-warnings", url]);

  let raw: RawDumpJson;
  try {
    raw = JSON.parse(stdout) as RawDumpJson;
  } catch {
    throw new PipelineError("UNKNOWN", "yt-dlp retornou JSON inválido no --dump-json");
  }

  const platform = detectPlatform(raw);
  return {
    id: raw.id ?? "",
    url: raw.webpage_url ?? url,
    platform,
    title: friendlyTitle(raw, platform),
    channel: raw.channel ?? raw.uploader ?? null,
    durationSec: raw.duration ?? null,
    uploadDate: raw.upload_date ?? null,
    language: raw.language ?? null,
    description: raw.description ?? null,
    chapters: raw.chapters ?? [],
    tags: raw.tags ?? [],
    // 'live_chat' aparece como "legenda" mas é replay de chat — não serve.
    subtitleLangs: Object.keys(raw.subtitles ?? {}).filter((l) => l !== "live_chat"),
    autoCaptionLangs: Object.keys(raw.automatic_captions ?? {}),
    thumbnailUrl: raw.thumbnail ?? null,
  };
}

/**
 * Acha a faixa que casa com o prefixo de idioma.
 * 'pt' casa 'pt', 'pt-BR', 'pt-orig'; match exato tem prioridade.
 */
function pickLang(available: string[], prefix: string): string | null {
  if (available.includes(prefix)) return prefix;
  return available.find((l) => l.startsWith(`${prefix}-`)) ?? null;
}

export interface VttSelection {
  vttPath: string;
  source: "manual_subs" | "auto_subs";
  /** Código de idioma da faixa baixada (ex.: 'en', 'pt-BR'). */
  lang: string;
  /** true se a faixa está em português (não precisa de tradução). */
  isPortuguese: boolean;
}

/**
 * Baixa a melhor faixa de legenda em VTT.
 *
 * PREFERÊNCIA (validada em campo, jul/2026): faixas no IDIOMA ORIGINAL do vídeo
 * baixam de forma confiável; as traduções automáticas do YouTube (tlang=) retornam
 * HTTP 429 consistente. Por isso NUNCA pedimos tradução automática aqui — a
 * tradução para PT-BR, quando necessária, é feita depois via `claude` (step translate).
 *
 * Ordem: manual-pt > manual-idioma_original > manual-en > primeira manual
 *        > auto-idioma_original > auto-pt(só se pt for o idioma original) > auto-en.
 * Sem faixa aproveitável → null (cai para o fallback whisper).
 */
export async function downloadBestVtt(
  url: string,
  workdir: string,
  meta: VideoMetadata,
): Promise<VttSelection | null> {
  const orig = meta.language ?? "en"; // idioma original declarado pelo YouTube
  const origPrefix = orig.split("-")[0];

  // Candidatos por preferência. Para AUTO só aceitamos a faixa do idioma
  // original (as demais são traduções → 429). Se o original já for pt, ótimo.
  const candidates: Array<{ source: "manual_subs" | "auto_subs"; lang: string | null }> = [
    { source: "manual_subs", lang: pickLang(meta.subtitleLangs, "pt") },
    { source: "manual_subs", lang: pickLang(meta.subtitleLangs, origPrefix) },
    { source: "manual_subs", lang: pickLang(meta.subtitleLangs, "en") },
    { source: "manual_subs", lang: meta.subtitleLangs[0] ?? null },
    { source: "auto_subs", lang: pickLang(meta.autoCaptionLangs, origPrefix) },
    { source: "auto_subs", lang: pickLang(meta.autoCaptionLangs, "en") },
  ];
  const chosen = candidates.find((c) => c.lang !== null);
  if (!chosen || chosen.lang === null) return null;

  const subsFlag = chosen.source === "manual_subs" ? "--write-subs" : "--write-auto-subs";
  await runYtdlp([
    "--skip-download",
    subsFlag,
    "--sub-langs",
    chosen.lang,
    "--sub-format",
    "vtt",
    "-o",
    "%(id)s.%(ext)s",
    "-P",
    workdir,
    url,
  ]);

  // Localiza o .vtt gerado (nome final inclui o código de idioma: <id>.<lang>.vtt).
  const vttFile = fs.readdirSync(workdir).find((f) => f.endsWith(".vtt"));
  if (!vttFile) {
    console.warn(`downloadBestVtt: yt-dlp saiu com sucesso mas nenhum .vtt em ${workdir}`);
    return null;
  }

  return {
    vttPath: path.join(workdir, vttFile),
    source: chosen.source,
    lang: chosen.lang,
    isPortuguese: chosen.lang.split("-")[0] === "pt",
  };
}

/**
 * Baixa o melhor áudio e extrai para audio.m4a no workdir.
 * `bestaudio/best`: prefere faixa só-áudio (YouTube), mas cai para o melhor
 * formato combinado (TikTok/Instagram não têm áudio isolado) — o ffmpeg (`-x`)
 * extrai a trilha de áudio de qualquer um.
 */
export async function downloadAudio(url: string, workdir: string): Promise<string> {
  await runYtdlp(
    ["-f", "bestaudio/best", "-x", "--audio-format", "m4a", "-o", "audio.%(ext)s", "-P", workdir, url],
    AUDIO_TIMEOUT_MS,
  );
  return path.join(workdir, "audio.m4a");
}

/**
 * Baixa a thumbnail a partir da URL do metadata (funciona para YouTube,
 * Instagram e TikTok). Falha NÃO é fatal: loga warning e resolve.
 */
export async function downloadThumbnail(
  thumbnailUrl: string | null,
  destPath: string,
): Promise<void> {
  if (!thumbnailUrl) return;
  try {
    const res = await fetch(thumbnailUrl);
    if (!res.ok) {
      console.warn(`downloadThumbnail: HTTP ${res.status}`);
      return;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(destPath, buf);
  } catch (err) {
    console.warn(`downloadThumbnail: falha não-fatal:`, err);
  }
}
