import os from "node:os";
import path from "node:path";
import fs from "node:fs";

/** Raiz de dados em runtime — fora do repo; a biblioteca funciona offline. */
export const DATA_ROOT = path.join(os.homedir(), ".resume-video");

/** Diretório da biblioteca: um subdiretório por youtube_id. */
export const LIBRARY_ROOT = path.join(DATA_ROOT, "library");

export function videoDir(youtubeId: string): string {
  return path.join(LIBRARY_ROOT, youtubeId);
}

export function ensureVideoDir(youtubeId: string): string {
  const dir = videoDir(youtubeId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Paths canônicos dos artefatos de um vídeo. */
export function artifactPaths(youtubeId: string) {
  const dir = videoDir(youtubeId);
  return {
    dir,
    infoJson: path.join(dir, "info.json"),
    thumb: path.join(dir, "thumb.jpg"),
    audio: path.join(dir, "audio.m4a"),
    transcript: path.join(dir, "transcript.txt"),
    transcriptTimestamps: path.join(dir, "transcript.timestamps.txt"),
    summary: path.join(dir, "summary.md"),
    mindmap: path.join(dir, "mindmap.md"),
    mindmapSvg: path.join(dir, "mindmap.svg"),
    mindmapPng: path.join(dir, "mindmap.png"),
    docx: path.join(dir, "resumo.docx"),
    pdf: path.join(dir, "resumo.pdf"),
  } as const;
}

/**
 * Extrai o youtube_id (11 chars) de qualquer formato de URL do YouTube.
 * Aceita: watch?v=, youtu.be/, shorts/, embed/, live/.
 */
export function parseYoutubeUrl(input: string): string | null {
  const trimmed = input.trim();
  // ID puro
  if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) return trimmed;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\.|^m\./, "");
  if (host === "youtu.be") {
    const id = url.pathname.slice(1).split("/")[0];
    return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  }
  if (host === "youtube.com" || host === "music.youtube.com") {
    const v = url.searchParams.get("v");
    if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;
    const m = url.pathname.match(/^\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{11})/);
    if (m) return m[1];
  }
  return null;
}
