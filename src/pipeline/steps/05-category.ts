import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { categories, videos } from "@/db/schema";
import { runClaude } from "@/pipeline/lib/claude-cli";
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
    const raw = await runClaude({
      prompt: categoryPrompt(meta, transcriptText),
      model: "haiku",
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
