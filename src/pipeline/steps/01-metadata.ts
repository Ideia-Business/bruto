import fs from "node:fs";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { categories, videos } from "@/db/schema";
import { fetchMetadata, downloadThumbnail } from "@/pipeline/lib/ytdlp";
import { artifactPaths, ensureVideoDir } from "@/pipeline/lib/paths";
import { recordArtifact } from "@/pipeline/lib/artifacts";
import type { VideoMetadata } from "@/pipeline/types";

/**
 * Etapa 1 — metadata: busca --dump-json, baixa thumbnail, faz upsert do vídeo
 * (categoria provisória "outros") e grava info.json. Retorna a metadata para
 * as etapas seguintes.
 */
export async function runMetadata(url: string): Promise<VideoMetadata> {
  const meta = await fetchMetadata(url);
  const paths = artifactPaths(meta.id);
  ensureVideoDir(meta.id);

  // info.json bruto — útil para depuração e re-processamento offline.
  fs.writeFileSync(paths.infoJson, JSON.stringify(meta, null, 2));

  await downloadThumbnail(meta.thumbnailUrl, paths.thumb);

  // Categoria provisória: "outros" (a etapa 5 reclassifica).
  const outros = db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.slug, "outros"))
    .get();

  const existing = db.select({ id: videos.id }).from(videos).where(eq(videos.id, meta.id)).get();
  const thumbnailPath = fs.existsSync(paths.thumb) ? paths.thumb : null;

  if (existing) {
    db.update(videos)
      .set({
        url: meta.url,
        platform: meta.platform,
        title: meta.title,
        channel: meta.channel,
        durationSec: meta.durationSec,
        uploadDate: meta.uploadDate,
        language: meta.language,
        thumbnailPath,
      })
      .where(eq(videos.id, meta.id))
      .run();
  } else {
    db.insert(videos)
      .values({
        id: meta.id,
        url: meta.url,
        platform: meta.platform,
        title: meta.title,
        channel: meta.channel,
        durationSec: meta.durationSec,
        uploadDate: meta.uploadDate,
        language: meta.language,
        thumbnailPath,
        categoryId: outros?.id ?? null,
        createdAt: new Date(),
      })
      .run();
  }

  recordArtifact(meta.id, "info_json", paths.infoJson);
  return meta;
}
