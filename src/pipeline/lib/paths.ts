import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { reconhecerLink, type PlataformaId } from "@/lib/plataformas";

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
export type Platform = PlataformaId;

export interface MediaRef {
  platform: Platform;
  /** ID canônico da plataforma. Vazio quando a URL não o expõe (ex.: short
   *  links do TikTok) — nesse caso o pipeline usa o id devolvido pelo yt-dlp. */
  id: string;
}

/**
 * Reconhece uma URL de YouTube, Instagram (reel/post) ou TikTok e extrai a
 * plataforma + o ID. Retorna null se a URL não for de uma plataforma suportada.
 *
 * Adaptador fino sobre `reconhecerLink` (fonte única em `@/lib/plataformas`,
 * compartilhada com o app e a extensão) — mantém a assinatura `MediaRef` que
 * o resto do pipeline já consome.
 */
export function parseMediaUrl(input: string): MediaRef | null {
  const ref = reconhecerLink(input);
  return ref ? { platform: ref.plataforma, id: ref.id } : null;
}

/** Compat: só o ID (usado onde a plataforma é irrelevante). */
export function parseYoutubeUrl(input: string): string | null {
  return parseMediaUrl(input)?.id || null;
}
