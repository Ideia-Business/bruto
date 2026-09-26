import fs from "node:fs";
import { nanoid } from "nanoid";
import { and, desc, eq, like, or, inArray } from "drizzle-orm";
import { db } from "./client";
import { artifacts, brutoTags, categories, filaoBrutos, filoes, jobs, tags, brutos } from "./schema";
import type { Artifact, Category, Filao, Job, Bruto, Tag } from "./schema";
import { slugifyTag } from "@/pipeline/lib/tags";

export interface TagLite {
  id: string;
  name: string;
  slug: string;
}

interface CardBase {
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

export interface BrutoCard extends CardBase {
  tags: TagLite[];
}

export interface CategoryRow {
  category: Category;
  brutos: BrutoCard[];
}

function toCard(v: Bruto): CardBase {
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

/**
 * Anexa as tags de cada card num único SELECT (nunca N+1) — usado por toda
 * função que devolve uma LISTA de brutos (catálogo, histórico, busca, filão).
 */
function attachTags(cards: CardBase[]): BrutoCard[] {
  if (cards.length === 0) return [];
  const ids = cards.map((c) => c.id);
  const rows = db
    .select({ videoId: brutoTags.videoId, id: tags.id, name: tags.name, slug: tags.slug })
    .from(brutoTags)
    .innerJoin(tags, eq(tags.id, brutoTags.tagId))
    .where(inArray(brutoTags.videoId, ids))
    .all();
  const byVideo = new Map<string, TagLite[]>();
  for (const r of rows) {
    const arr = byVideo.get(r.videoId) ?? [];
    arr.push({ id: r.id, name: r.name, slug: r.slug });
    byVideo.set(r.videoId, arr);
  }
  return cards.map((c) => ({ ...c, tags: byVideo.get(c.id) ?? [] }));
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
    if (vids.length > 0) rows.push({ category, brutos: attachTags(vids.map(toCard)) });
  }
  return rows;
}

/** Histórico completo — todos os vídeos, mais recentes primeiro. */
export function getHistory(limit = 40): BrutoCard[] {
  return attachTags(
    db.select().from(brutos).orderBy(desc(brutos.createdAt)).limit(limit).all().map(toCard),
  );
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
    return any ? attachTags([toCard(any)])[0] : null;
  }
  const v = db
    .select()
    .from(brutos)
    .where(inArray(brutos.id, doneVideoIds))
    .orderBy(desc(brutos.createdAt))
    .limit(1)
    .get();
  return v ? attachTags([toCard(v)])[0] : null;
}

/** Busca por título ou canal (case-insensitive via LIKE). */
export function searchBrutos(query: string): BrutoCard[] {
  const q = `%${query.trim()}%`;
  if (!query.trim()) return [];
  return attachTags(
    db
      .select()
      .from(brutos)
      .where(or(like(brutos.title, q), like(brutos.channel, q)))
      .orderBy(desc(brutos.createdAt))
      .limit(50)
      .all()
      .map(toCard),
  );
}

export interface BrutoDetail {
  bruto: Bruto;
  category: Category | null;
  tags: TagLite[];
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
    tags: getTagsForBruto(id),
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
  const ordered = links.flatMap((l) => {
    const v = byId.get(l.videoId);
    return v ? [toCard(v)] : [];
  });
  return attachTags(ordered);
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

// ─────────────────────────────────────────────────────────────────────────────
// Tags — marcador plano de assunto, uma tabela global reaproveitada por slug
// (nunca hierarquia: ver docs/decisions/0001-tags-nao-hierarquia.md).
// ─────────────────────────────────────────────────────────────────────────────

export interface TagRow {
  tag: Tag;
  count: number;
}

/** Todas as tags, cada uma com quantos brutos tem (para o filtro do Catálogo e o seletor manual). */
export function listTags(): TagRow[] {
  const all = db.select().from(tags).orderBy(tags.name).all();
  return all.map((tag) => {
    const rows = db.select({ videoId: brutoTags.videoId }).from(brutoTags).where(eq(brutoTags.tagId, tag.id)).all();
    return { tag, count: rows.length };
  });
}

/**
 * Tags já usadas por vídeos desta categoria — o sinal de reaproveitamento que
 * alimenta o prompt de tags. SEMPRE uma consulta fresca (nunca cacheada entre
 * vídeos de um mesmo lote): é o que garante que o segundo vídeo do lote veja a
 * tag que o primeiro acabou de criar, em vez de duplicar o mesmo assunto.
 */
export function tagNamesInCategory(categoryId: number): string[] {
  const rows = db
    .select({ name: tags.name })
    .from(brutoTags)
    .innerJoin(brutos, eq(brutos.id, brutoTags.videoId))
    .innerJoin(tags, eq(tags.id, brutoTags.tagId))
    .where(eq(brutos.categoryId, categoryId))
    .all();
  return Array.from(new Set(rows.map((r) => r.name))).sort((a, b) => a.localeCompare(b, "pt-BR"));
}

/**
 * Reaproveita por slug (mesmo princípio de `uniqueSlug` acima, mas invertido:
 * ali colisão de slug ganha sufixo porque o nome é livre e dois filões podem
 * coincidir; aqui colisão de slug É o reaproveitamento pedido pelo dono — duas
 * grafias do mesmo assunto ("IA"/"ia") devem virar a MESMA tag).
 */
function findOrCreateTagByName(name: string): Tag {
  const trimmed = name.trim();
  const slug = slugifyTag(trimmed) || nanoid(8);
  const existing = db.select().from(tags).where(eq(tags.slug, slug)).get();
  if (existing) return existing;
  const row: Tag = { id: nanoid(), name: trimmed, slug, createdAt: new Date() };
  db.insert(tags).values(row).run();
  return row;
}

/** Cria (ou reaproveita) uma tag pelo nome — usada pelo seletor manual da UI. */
export function createTag(name: string): Tag {
  return findOrCreateTagByName(name);
}

export function getTagsForBruto(videoId: string): TagLite[] {
  return db
    .select({ id: tags.id, name: tags.name, slug: tags.slug })
    .from(brutoTags)
    .innerJoin(tags, eq(tags.id, brutoTags.tagId))
    .where(eq(brutoTags.videoId, videoId))
    .orderBy(tags.name)
    .all();
}

export function getTagIdsForBruto(videoId: string): string[] {
  return db
    .select({ tagId: brutoTags.tagId })
    .from(brutoTags)
    .where(eq(brutoTags.videoId, videoId))
    .all()
    .map((r) => r.tagId);
}

/**
 * Define o conjunto INTEIRO de tags do vídeo por id, de uma vez (mesmo desenho
 * idempotente de `setFiloesForBruto`) — usado pelo seletor manual da UI.
 */
export function setTagIdsForBruto(videoId: string, tagIds: string[]): void {
  const atual = new Set(getTagIdsForBruto(videoId));
  const alvo = new Set(tagIds);
  const now = new Date();

  for (const id of alvo) {
    if (!atual.has(id)) {
      db.insert(brutoTags).values({ videoId, tagId: id, addedAt: now }).run();
    }
  }
  for (const id of atual) {
    if (!alvo.has(id)) {
      db.delete(brutoTags).where(and(eq(brutoTags.videoId, videoId), eq(brutoTags.tagId, id))).run();
    }
  }
}

/**
 * Classificação automática do passo 05 — SUBSTITUI o conjunto de tags do vídeo
 * pelos nomes que a IA escolheu (reprocessar não acumula, reclassifica).
 */
export function setBrutoTagsFromNames(videoId: string, names: string[]): TagLite[] {
  const resolved = names.map((n) => findOrCreateTagByName(n));
  setTagIdsForBruto(
    videoId,
    resolved.map((t) => t.id),
  );
  return resolved.map((t) => ({ id: t.id, name: t.name, slug: t.slug }));
}
