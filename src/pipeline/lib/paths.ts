import os from "node:os";
import path from "node:path";
import fs from "node:fs";

/**
 * Raiz de dados em runtime — fora do repo; a biblioteca funciona offline.
 * Sobrescrevível por `BRUTO_DATA_ROOT` (útil para testes e para quem quer a
 * biblioteca em outro volume).
 */
export const DATA_ROOT =
  process.env.BRUTO_DATA_ROOT ?? path.join(os.homedir(), ".bruto");

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
    transcriptOrganized: path.join(dir, "transcript-organizada.md"),
    transcriptLlm: path.join(dir, "transcript-para-ia.md"),
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
export type Platform = "youtube" | "instagram" | "tiktok";

export interface MediaRef {
  platform: Platform;
  /** ID canônico da plataforma. Vazio quando a URL não o expõe (ex.: short
   *  links do TikTok) — nesse caso o pipeline usa o id devolvido pelo yt-dlp. */
  id: string;
}

/**
 * Reconhece uma URL de YouTube, Instagram (reel/post) ou TikTok e extrai a
 * plataforma + o ID. Retorna null se a URL não for de uma plataforma suportada.
 */
export function parseMediaUrl(input: string): MediaRef | null {
  const trimmed = input.trim();
  // ID puro de 11 chars → assume YouTube (compatibilidade).
  if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) return { platform: "youtube", id: trimmed };

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\.|^m\./, "");

  // ── YouTube ────────────────────────────────────────────────────────────
  if (host === "youtu.be") {
    const id = url.pathname.slice(1).split("/")[0];
    return /^[A-Za-z0-9_-]{11}$/.test(id) ? { platform: "youtube", id } : null;
  }
  if (host === "youtube.com" || host === "music.youtube.com") {
    const v = url.searchParams.get("v");
    if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return { platform: "youtube", id: v };
    const m = url.pathname.match(/^\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{11})/);
    if (m) return { platform: "youtube", id: m[1] };
    return null;
  }

  // ── Instagram (reel / reels / post / tv) ───────────────────────────────
  if (host === "instagram.com" || host.endsWith(".instagram.com")) {
    const m = url.pathname.match(/^\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/);
    if (m) return { platform: "instagram", id: m[1] };
    return null;
  }

  // ── TikTok (/@user/video/<id>, /video/<id>, ou short links) ────────────
  if (host === "tiktok.com" || host.endsWith(".tiktok.com")) {
    const m = url.pathname.match(/\/video\/(\d+)/);
    if (m) return { platform: "tiktok", id: m[1] };
    // Short links (vm./vt.tiktok.com/<code>) — id resolvido depois pelo yt-dlp.
    if (host !== "tiktok.com") return { platform: "tiktok", id: "" };
    return null;
  }

  return null;
}

/** Compat: só o ID (usado onde a plataforma é irrelevante). */
export function parseYoutubeUrl(input: string): string | null {
  return parseMediaUrl(input)?.id || null;
}
