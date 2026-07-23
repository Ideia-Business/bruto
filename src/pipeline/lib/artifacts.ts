import fs from "node:fs";
import { nanoid } from "nanoid";
import { db } from "@/db/client";
import { artifacts } from "@/db/schema";
import { and, eq } from "drizzle-orm";

export type ArtifactKind =
  | "transcript"
  | "transcript_ts"
  | "transcript_translated"
  | "summary_md"
  | "mindmap_md"
  | "mindmap_svg"
  | "mindmap_png"
  | "study_md"
  | "docx"
  | "pdf"
  | "info_json";

/**
 * Registra (ou substitui) um artefato de um vídeo no catálogo.
 * Reprocessar um vídeo substitui o registro do mesmo kind — nunca duplica.
 */
export function recordArtifact(videoId: string, kind: ArtifactKind, filePath: string): void {
  const sizeBytes = fs.existsSync(filePath) ? fs.statSync(filePath).size : null;
  db.delete(artifacts)
    .where(and(eq(artifacts.videoId, videoId), eq(artifacts.kind, kind)))
    .run();
  db.insert(artifacts)
    .values({ id: nanoid(), videoId, kind, filePath, sizeBytes, createdAt: new Date() })
    .run();
}
