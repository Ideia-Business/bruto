import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { videos } from "@/db/schema";
import { downloadBestVtt, downloadAudio } from "@/pipeline/lib/ytdlp";
import { parseVtt } from "@/pipeline/lib/vtt-parser";
import { transcribeAudio, isVtAvailable } from "@/pipeline/lib/vt-bridge";
import { artifactPaths } from "@/pipeline/lib/paths";
import { recordArtifact } from "@/pipeline/lib/artifacts";
import { PipelineError, type TranscriptResult, type VideoMetadata } from "@/pipeline/types";

export interface TranscriptOptions {
  forceWhisper?: boolean;
  /** Callback de progresso fino (0-100 dentro da etapa). */
  onTick?: (pct: number, detail: string) => void;
}

/**
 * Etapa 2 — transcript. Cascata legendas-first:
 *   A/B) yt-dlp legendas (idioma original) → parseVtt (dedupe rolling)
 *   D)   fallback whisper via vt.sh (áudio) quando não há legenda ou forceWhisper
 *
 * Grava transcript.txt + transcript.timestamps.txt, registra artifacts e
 * atualiza videos.transcriptSource. `isPortuguese` informa o runner se a
 * tradução (etapa opcional) é necessária.
 */
export async function runTranscript(
  url: string,
  meta: VideoMetadata,
  opts: TranscriptOptions = {},
): Promise<TranscriptResult & { isPortuguese: boolean }> {
  const paths = artifactPaths(meta.id);
  const onTick = opts.onTick ?? (() => {});

  let result: (TranscriptResult & { isPortuguese: boolean }) | null = null;

  // ── Tiers A/B: legendas (pulados se forceWhisper) ──────────────────────────
  if (!opts.forceWhisper) {
    // Workdir limpo e isolado por chamada — evita o glob pegar .vtt antigo.
    const subsDir = fs.mkdtempSync(path.join(os.tmpdir(), `rv-subs-${meta.id}-`));
    try {
      onTick(10, "Baixando legendas");
      const vtt = await downloadBestVtt(url, subsDir, meta);
      if (vtt) {
        const raw = fs.readFileSync(vtt.vttPath, "utf8");
        const parsed = parseVtt(raw);
        result = {
          source: vtt.source,
          text: parsed.text,
          timestampedText: parsed.timestampedText,
          isPortuguese: vtt.isPortuguese,
        };
        onTick(80, `Legendas processadas (${vtt.source}, ${vtt.lang})`);
      }
    } catch (err) {
      // 429 em faixa de legenda não é fatal: registra e cai para whisper.
      if (err instanceof PipelineError && err.code === "RATE_LIMIT") {
        onTick(40, "Legendas com rate-limit — tentando whisper");
      } else {
        throw err;
      }
    } finally {
      fs.rmSync(subsDir, { recursive: true, force: true });
    }
  }

  // ── Tier D: áudio → whisper (vt.sh) ────────────────────────────────────────
  if (!result) {
    if (!isVtAvailable()) {
      throw new PipelineError(
        "NO_TRANSCRIPT",
        "Vídeo sem legenda e whisper indisponível. Instale: uv tool install mlx-whisper",
      );
    }
    onTick(30, "Baixando áudio");
    const audioPath = await downloadAudio(url, paths.dir);
    try {
      onTick(50, "Transcrevendo com Whisper (pode levar alguns minutos)");
      const text = await transcribeAudio(audioPath, meta.language ?? undefined);
      result = {
        source: "whisper",
        text,
        // Whisper não emite timestamps por linha nesta ponte; usamos o texto puro.
        timestampedText: text,
        // Whisper transcreve no idioma falado; tratamos pt* como português.
        isPortuguese: (meta.language ?? "").split("-")[0] === "pt",
      };
      onTick(90, "Transcrição concluída");
    } finally {
      // Áudio é volumoso e descartável — o cache do vt.sh já guarda a transcrição.
      fs.rmSync(audioPath, { force: true });
    }
  }

  // ── Persistência dos artefatos de transcrição ──────────────────────────────
  fs.writeFileSync(paths.transcript, result.text);
  fs.writeFileSync(paths.transcriptTimestamps, result.timestampedText);
  recordArtifact(meta.id, "transcript", paths.transcript);
  recordArtifact(meta.id, "transcript_ts", paths.transcriptTimestamps);

  db.update(videos)
    .set({ transcriptSource: result.source })
    .where(eq(videos.id, meta.id))
    .run();

  return result;
}
