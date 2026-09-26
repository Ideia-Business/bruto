import type { VideoMetadata } from "../types";

export const CATEGORY_SLUGS = [
  "tecnologia",
  "negocios",
  "educacao",
  "ciencia",
  "saude",
  "financas",
  "desenvolvimento-pessoal",
  "entretenimento",
  "outros",
] as const;

export type CategorySlug = (typeof CATEGORY_SLUGS)[number];

/** O mínimo que este prompt precisa saber sobre o bruto (mesma ideia de `MetaDoPrompt` em `summary.ts`). */
export type MetaParaCategoria = Pick<VideoMetadata, "title" | "channel" | "tags">;

/**
 * Prompt de classificação — chamada leve (haiku). O texto recebido via stdin é
 * o resumo executivo seguido da TRANSCRIÇÃO COMPLETA (sem corte): a classificação
 * de vídeos longos não pode decidir só pelos primeiros minutos.
 */
export function categoryPrompt(meta: MetaParaCategoria): string {
  return `Classifique o vídeo abaixo em UMA das categorias, a partir do texto recebido via stdin (resumo executivo, seguido da transcrição completa). Responda SOMENTE com o slug, nada mais.

Categorias: ${CATEGORY_SLUGS.join(" | ")}

Título: ${meta.title}
Canal: ${meta.channel ?? "desconhecido"}
Tags do vídeo original: ${meta.tags.slice(0, 15).join(", ") || "nenhuma"}`;
}

/**
 * Resumo + transcrição completa — o texto que entra via stdin nas duas
 * chamadas do passo 05 (categoria e tags). SEM CORTE: a versão anterior deste
 * prompt truncava em 1500 caracteres, e um vídeo longo é classificado errado
 * quando só os primeiros minutos entram na decisão.
 */
export function conteudoParaClassificacao(summaryMd: string, transcriptText: string): string {
  return `## Resumo\n${summaryMd}\n\n## Transcrição completa\n${transcriptText}`;
}

/** Resposta fora da lista → 'outros'. */
export function parseCategorySlug(raw: string): CategorySlug {
  const cleaned = raw.trim().toLowerCase().replace(/[^a-z-]/g, "");
  return (CATEGORY_SLUGS as readonly string[]).includes(cleaned)
    ? (cleaned as CategorySlug)
    : "outros";
}
