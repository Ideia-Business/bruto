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
  return `Classifique o vídeo abaixo em UMA das categorias, a partir do texto recebido via stdin (resumo executivo, seguido da transcrição completa). Responda com o slug e MAIS NADA: sem "Categoria:" antes, sem pontuação, sem explicação, sem aspas — só o slug puro, exatamente como aparece na lista.

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

/**
 * Exige correspondência EXATA com um dos slugs válidos — nunca concatena texto
 * ao redor para "salvar" a resposta. A versão anterior removia todo caractere
 * fora de `a-z-` da string INTEIRA antes de comparar: uma resposta com
 * preâmbulo ("Categoria: tecnologia", coisa que modelo faz mesmo instruído a
 * não fazer) virava "categoriatecnologia", não batia com nada, e caía em
 * "outros" — que, depois da correção de `05-category.ts` para falha de
 * CHAMADA, passou a ser tratado como classificação de verdade e sobrescrevia
 * a categoria correta que o vídeo já tinha. Resposta que não bate exatamente
 * é tratada como FALHA DE PARSING (null), nunca como "outros" por adivinhação
 * — mesmo contrato de uma falha de chamada (`05-category.ts` trata os dois
 * caminhos de forma idêntica: nada é gravado, o chamador conta como erro).
 */
export function parseCategorySlug(raw: string): CategorySlug | null {
  const cleaned = raw
    .trim()
    .replace(/^[`"']+|[`"'.]+$/g, "")
    .trim()
    .toLowerCase();
  return (CATEGORY_SLUGS as readonly string[]).includes(cleaned) ? (cleaned as CategorySlug) : null;
}
