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

/** Prompt de classificação — chamada leve (haiku). */
export function categoryPrompt(meta: VideoMetadata, transcriptStart: string): string {
  return `Classifique o vídeo abaixo em UMA das categorias. Responda SOMENTE com o slug, nada mais.

Categorias: ${CATEGORY_SLUGS.join(" | ")}

Título: ${meta.title}
Canal: ${meta.channel ?? "desconhecido"}
Tags: ${meta.tags.slice(0, 15).join(", ") || "nenhuma"}
Início da transcrição: ${transcriptStart.slice(0, 1500)}`;
}

/** Resposta fora da lista → 'outros'. */
export function parseCategorySlug(raw: string): CategorySlug {
  const cleaned = raw.trim().toLowerCase().replace(/[^a-z-]/g, "");
  return (CATEGORY_SLUGS as readonly string[]).includes(cleaned)
    ? (cleaned as CategorySlug)
    : "outros";
}
