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
  /**
   * null quando a CHAMADA de classificação falhou (timeout, IA fora do ar,
   * etc.) — nesse caso o vídeo mantém a categoria que já tinha, NADA é
   * gravado, e o chamador deve contar isto como FALHA, não sucesso. Antes desta
   * correção, uma falha aqui gravava "outros" por cima da categoria existente;
   * rodar `npm run reclassificar` com a IA indisponível apagava a organização
   * do catálogo inteiro reportando sucesso.
   */
  categorySlug: CategorySlug | null;
  /** Nomes das tags aplicadas ao bruto — [] quando a IA não sugeriu nenhuma (ou a classificação falhou). */
  tags: string[];
  /** Título proposto pela IA, ou null quando o original já estava bom (ou a classificação falhou). */
  titleSuggestion: string | null;
}

/**
 * Etapa 5 — classificação de categoria, tags e título via IA.
 *
 * Sequencial de propósito, em duas chamadas: só depois de saber a categoria
 * (chamada 1) é que faz sentido perguntar "quais tags já existem NESTA
 * categoria" (chamada 2, que também avalia o título). As duas processam a
 * transcrição INTEIRA sem corte — por isso o timeout é o mesmo piso de
 * `03-summary.ts` (180s), não o de uma classificação rasa.
 *
 * A categoria é best-effort SÓ no sentido de "resposta fora do esperado vira
 * outros" (`parseCategorySlug`) — uma FALHA na chamada em si (exception) NUNCA
 * apaga a categoria que o vídeo já tinha; ver `CategoryStepResult.categorySlug`.
 * Tags e título continuam best-effort de verdade: falha ali só deixa o vídeo
 * sem tag/com o título de antes, nunca reverte algo que já existia.
 */
export async function runCategory(
  meta: CategoryStepInput,
  transcriptText: string,
  summaryMd: string,
): Promise<CategoryStepResult> {
  const conteudo = conteudoParaClassificacao(summaryMd, transcriptText);
  const metaCategoria: MetaParaCategoria = { title: meta.title, channel: meta.channel, tags: meta.tags };

  let slug: CategorySlug;
  try {
    const raw = await runLLMText({
      task: "category",
      prompt: categoryPrompt(metaCategoria),
      input: conteudo,
      tier: "fast",
      timeoutMs: 180_000,
    });
    slug = parseCategorySlug(raw);
  } catch {
    // Falha de verdade na chamada (não uma resposta estranha — essa vira
    // "outros" dentro de `parseCategorySlug`) — não toca em nada.
    return { categorySlug: null, tags: [], titleSuggestion: null };
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
        timeoutMs: 180_000,
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
