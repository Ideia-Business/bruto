import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { categories, brutos } from "@/db/schema";
import { setBrutoTagsFromNames, setBrutoTitle, tagNamesInCategory } from "@/db/queries";
import { runLLMText } from "@/pipeline/lib/llm";
import {
  categoryPrompt,
  conteudoParaClassificacao,
  parseCategorySlug,
  type CategorySlug,
  type MetaParaCategoria,
} from "@/pipeline/prompts/category";
import { tagsPrompt, parseTagsResponse } from "@/pipeline/prompts/tags";
import type { VideoMetadata } from "@/pipeline/types";

/** O mínimo que este passo precisa — no reprocessamento retroativo (script de
 *  lote) `tags` (as do yt-dlp, sinal auxiliar) não está disponível e vai vazia. */
export type CategoryStepInput = Pick<VideoMetadata, "id" | "title" | "channel" | "tags">;

export interface CategoryStepResult {
  categorySlug: CategorySlug;
  /** Nomes das tags aplicadas ao bruto — [] quando a IA não sugeriu nenhuma. */
  tags: string[];
  /** Título proposto pela IA, ou null quando o original já estava bom. */
  titleSuggestion: string | null;
}

/**
 * Etapa 5 — classificação de categoria, tags e título via IA.
 *
 * Sequencial de propósito, em duas chamadas: só depois de saber a categoria
 * (chamada 1, leve) é que faz sentido perguntar "quais tags já existem NESTA
 * categoria" (chamada 2, que também avalia o título). Best-effort como sempre
 * foi a classificação: falha em qualquer chamada não derruba o job — o vídeo
 * fica com "outros"/sem tag/título original, e um reprocessamento cobre depois.
 */
export async function runCategory(
  meta: CategoryStepInput,
  transcriptText: string,
  summaryMd: string,
): Promise<CategoryStepResult> {
  const conteudo = conteudoParaClassificacao(summaryMd, transcriptText);
  const metaCategoria: MetaParaCategoria = { title: meta.title, channel: meta.channel, tags: meta.tags };

  let slug: CategorySlug = "outros";
  try {
    const raw = await runLLMText({
      task: "category",
      prompt: categoryPrompt(metaCategoria),
      input: conteudo,
      tier: "fast",
      timeoutMs: 60_000,
    });
    slug = parseCategorySlug(raw);
  } catch {
    slug = "outros";
  }

  const cat = db.select().from(categories).where(eq(categories.slug, slug)).get();
  if (cat) {
    db.update(brutos).set({ categoryId: cat.id }).where(eq(brutos.id, meta.id)).run();
  }

  let tagNames: string[] = [];
  let titleSuggestion: string | null = null;
  if (cat) {
    try {
      // Fresca a cada chamada — nunca cacheada entre vídeos do mesmo lote de
      // reprocessamento, senão o segundo vídeo nunca veria a tag que o
      // primeiro acabou de criar (e duplicaria o mesmo assunto).
      const existentes = tagNamesInCategory(cat.id);
      const raw = await runLLMText({
        task: "tags",
        prompt: tagsPrompt({ title: meta.title }, cat.name, existentes),
        input: conteudo,
        tier: "balanced",
        timeoutMs: 90_000,
      });
      const parsed = parseTagsResponse(raw);
      tagNames = parsed.tags;
      titleSuggestion = parsed.title;
    } catch {
      // Tags/título são best-effort — mesma postura da categoria acima.
    }
  }

  if (tagNames.length > 0) {
    setBrutoTagsFromNames(meta.id, tagNames);
  }
  if (titleSuggestion) {
    setBrutoTitle(meta.id, titleSuggestion);
  }

  return { categorySlug: slug, tags: tagNames, titleSuggestion };
}
