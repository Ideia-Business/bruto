import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { categories, videos } from "@/db/schema";
import { runLLMText } from "@/pipeline/lib/llm";
import { categoryPrompt, parseCategorySlug, type CategorySlug } from "@/pipeline/prompts/category";
import type { VideoMetadata } from "@/pipeline/types";

/**
 * Etapa 5 — classificação de categoria via `claude -p` (haiku, chamada leve).
 * Atualiza videos.categoryId. Resposta fora da lista → "outros".
 */
export async function runCategory(
  meta: VideoMetadata,
  transcriptText: string,
): Promise<CategorySlug> {
  let slug: CategorySlug = "outros";
  try {
    const raw = await runLLMText({
      task: "category",
      prompt: categoryPrompt(meta, transcriptText),
      tier: "fast",
      timeoutMs: 60_000,
    });
    slug = parseCategorySlug(raw);
  } catch {
    // Classificação é best-effort: falha não derruba o job, fica "outros".
    slug = "outros";
  }

  const cat = db.select({ id: categories.id }).from(categories).where(eq(categories.slug, slug)).get();
  if (cat) {
    db.update(videos).set({ categoryId: cat.id }).where(eq(videos.id, meta.id)).run();
  }
  return slug;
}
