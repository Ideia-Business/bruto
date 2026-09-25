import fs from "node:fs";
import { nanoid } from "nanoid";
import { and, desc, eq, like, or, inArray } from "drizzle-orm";
import { db } from "./client";
import { artifacts, categories, filaoBrutos, filoes, jobs, brutos } from "./schema";
import type { Artifact, Category, Filao, Job, Bruto } from "./schema";

export interface BrutoCard {
  id: string;
  platform: string;
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
  brutos: BrutoCard[];
}

function toCard(v: Bruto): BrutoCard {
  return {
    id: v.id,
    platform: v.platform,
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
      .from(brutos)
      .where(eq(brutos.categoryId, category.id))
      .orderBy(desc(brutos.createdAt))
      .all();
    if (vids.length > 0) rows.push({ category, brutos: vids.map(toCard) });
  }
  return rows;
}

/** Histórico completo — todos os vídeos, mais recentes primeiro. */
export function getHistory(limit = 40): BrutoCard[] {
  return db.select().from(brutos).orderBy(desc(brutos.createdAt)).limit(limit).all().map(toCard);
}

/** Vídeo em destaque no hero: o mais recente concluído. */
export function getHeroBruto(): BrutoCard | null {
  const doneVideoIds = db
    .select({ id: jobs.videoId })
    .from(jobs)
    .where(eq(jobs.status, "done"))
    .all()
    .map((r) => r.id)
    .filter((id): id is string => id !== null);
  if (doneVideoIds.length === 0) {
    const any = db.select().from(brutos).orderBy(desc(brutos.createdAt)).limit(1).get();
    return any ? toCard(any) : null;
  }
  const v = db
    .select()
    .from(brutos)
    .where(inArray(brutos.id, doneVideoIds))
    .orderBy(desc(brutos.createdAt))
    .limit(1)
    .get();
  return v ? toCard(v) : null;
}

/** Busca por título ou canal (case-insensitive via LIKE). */
export function searchBrutos(query: string): BrutoCard[] {
  const q = `%${query.trim()}%`;
  if (!query.trim()) return [];
  return db
    .select()
    .from(brutos)
    .where(or(like(brutos.title, q), like(brutos.channel, q)))
    .orderBy(desc(brutos.createdAt))
    .limit(50)
    .all()
    .map(toCard);
}

export interface BrutoDetail {
  bruto: Bruto;
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
    transcriptOrganizedMd: string | null;
    transcriptLlmMd: string | null;
  };
}

function readIfExists(filePath: string | undefined): string | null {
  if (!filePath || !fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, "utf8");
}

/** Detalhe completo de um vídeo + conteúdo das abas. null se não existe. */
export function getBrutoDetail(id: string): BrutoDetail | null {
  const bruto = db.select().from(brutos).where(eq(brutos.id, id)).get();
  if (!bruto) return null;

  const category = bruto.categoryId
    ? (db.select().from(categories).where(eq(categories.id, bruto.categoryId)).get() ?? null)
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
    bruto,
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
      transcriptOrganizedMd: readIfExists(byKind("transcript_organized_md")),
      transcriptLlmMd: readIfExists(byKind("transcript_llm_md")),
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

export function getBrutoById(id: string): Bruto | null {
  return db.select().from(brutos).where(eq(brutos.id, id)).get() ?? null;
}

/** Vídeo já processado com sucesso? (dedupe do POST de nova URL). */
export function isBrutoDone(id: string): boolean {
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
export function setBrutoCategory(videoId: string, categoryId: number): void {
  db.update(brutos).set({ categoryId }).where(eq(brutos.id, videoId)).run();
}

/** Renomeia o título cadastrado de um vídeo (edição manual na UI). */
export function setBrutoTitle(videoId: string, title: string): void {
  db.update(brutos).set({ title }).where(eq(brutos.id, videoId)).run();
}

// ─────────────────────────────────────────────────────────────────────────────
// Filões — agrupamento por assunto, feito por quem usa.
// ─────────────────────────────────────────────────────────────────────────────

export interface FilaoRow {
  filao: Filao;
  count: number;
}

/**
 * Slug a partir do nome: sem acento, minúsculo, hífens. Como o nome é livre,
 * dois filões podem gerar o mesmo slug ("Direito Adm." e "direito adm") — o
 * sufixo numérico resolve sem devolver erro para quem está só nomeando coisa.
 */
function slugify(name: string): string {
  const base = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return base || "filao";
}

function uniqueSlug(name: string): string {
  const base = slugify(name);
  let candidate = base;
  let n = 2;
  while (db.select({ id: filoes.id }).from(filoes).where(eq(filoes.slug, candidate)).get()) {
    candidate = `${base}-${n++}`;
  }
  return candidate;
}

/** Todos os filões, na ordem definida, cada um com quantos brutos tem. */
export function listFiloes(): FilaoRow[] {
  const all = db.select().from(filoes).orderBy(filoes.sortOrder, filoes.name).all();
  return all.map((filao) => {
    const rows = db
      .select({ videoId: filaoBrutos.videoId })
      .from(filaoBrutos)
      .where(eq(filaoBrutos.filaoId, filao.id))
      .all();
    return { filao, count: rows.length };
  });
}

export function getFilaoBySlug(slug: string): Filao | null {
  return db.select().from(filoes).where(eq(filoes.slug, slug)).get() ?? null;
}

/** Brutos de um filão, na ordem em que foram adicionados (mais recentes primeiro). */
export function getFilaoBrutos(filaoId: string): BrutoCard[] {
  const links = db
    .select()
    .from(filaoBrutos)
    .where(eq(filaoBrutos.filaoId, filaoId))
    .orderBy(desc(filaoBrutos.addedAt))
    .all();
  if (links.length === 0) return [];
  const ids = links.map((l) => l.videoId);
  const vids = db.select().from(brutos).where(inArray(brutos.id, ids)).all();
  // Preserva a ordem dos links (o inArray não garante ordem).
  const byId = new Map(vids.map((v) => [v.id, v]));
  return links.flatMap((l) => {
    const v = byId.get(l.videoId);
    return v ? [toCard(v)] : [];
  });
}

export function createFilao(name: string): Filao {
  const now = new Date();
  const last = db
    .select({ sortOrder: filoes.sortOrder })
    .from(filoes)
    .orderBy(desc(filoes.sortOrder))
    .limit(1)
    .get();
  const row = {
    id: nanoid(),
    name: name.trim(),
    slug: uniqueSlug(name),
    sortOrder: (last?.sortOrder ?? 0) + 1,
    createdAt: now,
  };
  db.insert(filoes).values(row).run();
  return row;
}

export function renameFilao(id: string, name: string): void {
  db.update(filoes).set({ name: name.trim() }).where(eq(filoes.id, id)).run();
}

/** Remove o filão. Os brutos NÃO são apagados — só deixam de estar agrupados. */
export function deleteFilao(id: string): void {
  db.delete(filaoBrutos).where(eq(filaoBrutos.filaoId, id)).run();
  db.delete(filoes).where(eq(filoes.id, id)).run();
}

/** Os filões em que um bruto está — usado pelo seletor na página do bruto. */
export function getFiloesForBruto(videoId: string): string[] {
  return db
    .select({ filaoId: filaoBrutos.filaoId })
    .from(filaoBrutos)
    .where(eq(filaoBrutos.videoId, videoId))
    .all()
    .map((r) => r.filaoId);
}

/**
 * Define em quais filões o bruto está, de uma vez (o seletor manda o conjunto
 * inteiro). Idempotente: reenviar o mesmo conjunto não muda nada.
 */
export function setFiloesForBruto(videoId: string, filaoIds: string[]): void {
  const atual = new Set(getFiloesForBruto(videoId));
  const alvo = new Set(filaoIds);
  const now = new Date();

  for (const id of alvo) {
    if (!atual.has(id)) {
      db.insert(filaoBrutos).values({ filaoId: id, videoId, addedAt: now }).run();
    }
  }
  for (const id of atual) {
    if (!alvo.has(id)) {
      db.delete(filaoBrutos)
        .where(and(eq(filaoBrutos.filaoId, id), eq(filaoBrutos.videoId, videoId)))
        .run();
    }
  }
}
