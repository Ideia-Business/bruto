import { integer, sqliteTable, text, index, primaryKey } from "drizzle-orm/sqlite-core";

export const categories = sqliteTable("categories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const brutos = sqliteTable(
  "brutos",
  {
    // youtube_id (11 chars) — PK natural: reprocessar substitui, nunca duplica
    id: text("id").primaryKey(),
    url: text("url").notNull(),
    // 'youtube' | 'instagram' | 'tiktok'
    platform: text("platform").notNull().default("youtube"),
    title: text("title").notNull(),
    channel: text("channel"),
    durationSec: integer("duration_sec"),
    uploadDate: text("upload_date"), // YYYYMMDD (formato do yt-dlp)
    language: text("language"),
    thumbnailPath: text("thumbnail_path"),
    categoryId: integer("category_id").references(() => categories.id),
    // 'manual_subs' | 'auto_subs' | 'yta' | 'whisper'
    transcriptSource: text("transcript_source"),
    /**
     * true entre a criação do vídeo (categoria provisória "outros", passo 01)
     * e a primeira classificação BEM-SUCEDIDA do passo 05 — ou entre falhas
     * repetidas dele. Sem isto, um vídeo cuja classificação falhou na
     * primeira tentativa (timeout, IA fora do ar, resposta fora do formato)
     * fica com categoria "outros" indistinguível de "a IA decidiu que é
     * outros de propósito", e o job termina `done` sem sinal nenhum de que
     * falta reclassificar. `05-category.ts` zera isto ao classificar com
     * sucesso; correção manual da categoria (`setBrutoCategory`) também zera.
     */
    classificacaoPendente: integer("classificacao_pendente", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    lastOpenedAt: integer("last_opened_at", { mode: "timestamp" }),
  },
  (t) => [index("brutos_category_idx").on(t.categoryId)],
);

export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(), // nanoid
    videoId: text("video_id").references(() => brutos.id),
    // A url existe antes do bruto — a etapa metadata é quem cria o registro
    // em `brutos`. A coluna continua chamando-se `video_id` no banco: o débito
    // pago aqui era o da TABELA; renomear coluna é migração à parte.
    url: text("url").notNull(),
    status: text("status").notNull(), // 'queued' | 'running' | 'done' | 'error'
    // 'metadata' | 'transcript' | 'summary' | 'mindmap' | 'category' | 'export'
    currentStep: text("current_step"),
    progressPct: integer("progress_pct").notNull().default(0),
    // 'BOT_CHECK' | 'RATE_LIMIT' | 'LOGIN_REQUIRED' | 'YTDLP_OUTDATED' | 'NO_TRANSCRIPT' | 'LLM_QUOTA' | 'UNKNOWN'
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    forceWhisper: integer("force_whisper", { mode: "boolean" }).default(false),
    // Tradução completa PT-BR da transcrição (opt-in quando o vídeo não é PT)
    translate: integer("translate", { mode: "boolean" }).default(false),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    startedAt: integer("started_at", { mode: "timestamp" }),
    finishedAt: integer("finished_at", { mode: "timestamp" }),
  },
  (t) => [index("jobs_status_idx").on(t.status)],
);

export const artifacts = sqliteTable(
  "artifacts",
  {
    id: text("id").primaryKey(), // nanoid
    videoId: text("video_id")
      .notNull()
      .references(() => brutos.id),
    // 'transcript' | 'transcript_ts' | 'summary_md' | 'mindmap_md' | 'mindmap_svg'
    // | 'mindmap_png' | 'docx' | 'pdf' | 'info_json'
    kind: text("kind").notNull(),
    filePath: text("file_path").notNull(),
    sizeBytes: integer("size_bytes"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [index("artifacts_video_kind_idx").on(t.videoId, t.kind)],
);

/**
 * Filão — agrupamento FEITO PELA PESSOA, por assunto. Distinto de `categories`,
 * que é a classificação automática do passo 05 (uma por bruto, escolhida pela
 * máquina). Aqui quem decide é quem usa, e um bruto pode estar em vários filões
 * ao mesmo tempo — daí a tabela de junção.
 */
export const filoes = sqliteTable("filoes", {
  id: text("id").primaryKey(), // nanoid
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const filaoBrutos = sqliteTable(
  "filao_brutos",
  {
    filaoId: text("filao_id")
      .notNull()
      .references(() => filoes.id, { onDelete: "cascade" }),
    videoId: text("video_id")
      .notNull()
      .references(() => brutos.id, { onDelete: "cascade" }),
    addedAt: integer("added_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    // Um bruto entra uma vez só em cada filão — a PK composta é a garantia,
    // então a UI pode reenviar sem medo de duplicar.
    primaryKey({ columns: [t.filaoId, t.videoId] }),
    index("filao_brutos_video_idx").on(t.videoId),
  ],
);

/**
 * Tag — marcador plano de assunto, escolhido pela IA no passo 05 (reaproveitado
 * por slug quando já existe) e ajustável à mão. Distinto de `filoes` (agrupa
 * por decisão da pessoa, tela própria) e de `categories` (uma por bruto, os 9
 * valores fixos): tag é MÚLTIPLA por vídeo e não tem hierarquia nem tela
 * própria — só filtra o Catálogo. Ver docs/decisions/0001-tags-nao-hierarquia.md.
 */
export const tags = sqliteTable("tags", {
  id: text("id").primaryKey(), // nanoid
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const brutoTags = sqliteTable(
  "bruto_tags",
  {
    videoId: text("video_id")
      .notNull()
      .references(() => brutos.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    addedAt: integer("added_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.videoId, t.tagId] }),
    index("bruto_tags_tag_idx").on(t.tagId),
  ],
);

export type Category = typeof categories.$inferSelect;
export type Bruto = typeof brutos.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type Artifact = typeof artifacts.$inferSelect;
export type Filao = typeof filoes.$inferSelect;
export type Tag = typeof tags.$inferSelect;
