import fs from "node:fs";
import { and, desc, eq, like, or, inArray } from "drizzle-orm";
import { db } from "./client";
import { artifacts, categories, jobs, videos } from "./schema";
import type { Artifact, Category, Job, Video } from "./schema";

export interface VideoCard {
  id: string;
  title: string;
  channel: string | null;
  durationSec: number | null;
  thumbnailPath: string | null;
  categoryId: number | null;
  transcriptSource: string | null;
  createdAt: Date;
}

export interface CategoryRow {
  category: Category;
  videos: VideoCard[];
}

function toCard(v: Video): VideoCard {
  return {
    id: v.id,
    title: v.title,
    channel: v.channel,
    durationSec: v.durationSec,
    thumbnailPath: v.thumbnailPath,
    categoryId: v.categoryId,
    transcriptSource: v.transcriptSource,
    createdAt: v.createdAt,
  };
}

/** Todas as categorias que têm ≥1 vídeo, cada uma com seus vídeos (mais recentes primeiro). */
export function getCatalog(): CategoryRow[] {
  const cats = db.select().from(categories).orderBy(categories.sortOrder).all();
  const rows: CategoryRow[] = [];
  for (const category of cats) {
    const vids = db
      .select()
      .from(videos)
      .where(eq(videos.categoryId, category.id))
      .orderBy(desc(videos.createdAt))
      .all();
    if (vids.length > 0) rows.push({ category, videos: vids.map(toCard) });
  }
  return rows;
}

/** Histórico completo — todos os vídeos, mais recentes primeiro. */
export function getHistory(limit = 40): VideoCard[] {
  return db.select().from(videos).orderBy(desc(videos.createdAt)).limit(limit).all().map(toCard);
}

/** Vídeo em destaque no hero: o mais recente concluído. */
export function getHeroVideo(): VideoCard | null {
  const doneVideoIds = db
    .select({ id: jobs.videoId })
    .from(jobs)
    .where(eq(jobs.status, "done"))
    .all()
    .map((r) => r.id)
    .filter((id): id is string => id !== null);
  if (doneVideoIds.length === 0) {
    const any = db.select().from(videos).orderBy(desc(videos.createdAt)).limit(1).get();
    return any ? toCard(any) : null;
  }
  const v = db
    .select()
    .from(videos)
    .where(inArray(videos.id, doneVideoIds))
    .orderBy(desc(videos.createdAt))
    .limit(1)
    .get();
  return v ? toCard(v) : null;
}

/** Busca por título ou canal (case-insensitive via LIKE). */
export function searchVideos(query: string): VideoCard[] {
  const q = `%${query.trim()}%`;
  if (!query.trim()) return [];
  return db
    .select()
    .from(videos)
    .where(or(like(videos.title, q), like(videos.channel, q)))
    .orderBy(desc(videos.createdAt))
    .limit(50)
    .all()
    .map(toCard);
}

export interface VideoDetail {
  video: Video;
  category: Category | null;
  artifacts: Artifact[];
  /** Job mais recente do vídeo (para status/progresso na página de detalhe). */
  latestJob: Job | null;
  /** Conteúdo textual lido do disco (para as abas). */
  content: {
    summaryMd: string | null;
    mindmapMd: string | null;
    transcript: string | null;
    transcriptTs: string | null;
    transcriptTranslated: string | null;
    studyMd: string | null;
  };
}

function readIfExists(filePath: string | undefined): string | null {
  if (!filePath || !fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, "utf8");
}

/** Detalhe completo de um vídeo + conteúdo das abas. null se não existe. */
export function getVideoDetail(id: string): VideoDetail | null {
  const video = db.select().from(videos).where(eq(videos.id, id)).get();
  if (!video) return null;

  const category = video.categoryId
    ? (db.select().from(categories).where(eq(categories.id, video.categoryId)).get() ?? null)
    : null;

  const arts = db.select().from(artifacts).where(eq(artifacts.videoId, id)).all();
  const byKind = (kind: string) => arts.find((a) => a.kind === kind)?.filePath;

  const latestJob =
    db
      .select()
      .from(jobs)
      .where(eq(jobs.videoId, id))
      .orderBy(desc(jobs.createdAt))
      .limit(1)
      .get() ?? null;

  return {
    video,
    category,
    artifacts: arts,
    latestJob,
    content: {
      summaryMd: readIfExists(byKind("summary_md")),
      mindmapMd: readIfExists(byKind("mindmap_md")),
      transcript: readIfExists(byKind("transcript")),
      transcriptTs: readIfExists(byKind("transcript_ts")),
      transcriptTranslated: readIfExists(byKind("transcript_translated")),
      studyMd: readIfExists(byKind("study_md")),
    },
  };
}

/** Jobs ativos (queued/running) — para a row "Em processamento" e a página /processing. */
export function getActiveJobs(): Job[] {
  return db
    .select()
    .from(jobs)
    .where(inArray(jobs.status, ["queued", "running"]))
    .orderBy(desc(jobs.createdAt))
    .all();
}

/** Todos os jobs (histórico da fila), mais recentes primeiro. */
export function getAllJobs(limit = 50): Job[] {
  return db.select().from(jobs).orderBy(desc(jobs.createdAt)).limit(limit).all();
}

export function getArtifactById(id: string): Artifact | null {
  return db.select().from(artifacts).where(eq(artifacts.id, id)).get() ?? null;
}

export function getVideoById(id: string): Video | null {
  return db.select().from(videos).where(eq(videos.id, id)).get() ?? null;
}

/** Vídeo já processado com sucesso? (dedupe do POST de nova URL). */
export function isVideoDone(id: string): boolean {
  const done = db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.videoId, id), eq(jobs.status, "done")))
    .limit(1)
    .get();
  return !!done;
}

export function listCategories(): Category[] {
  return db.select().from(categories).orderBy(categories.sortOrder).all();
}

/** Atualiza a categoria de um vídeo (edição manual na UI). */
export function setVideoCategory(videoId: string, categoryId: number): void {
  db.update(videos).set({ categoryId }).where(eq(videos.id, videoId)).run();
}
