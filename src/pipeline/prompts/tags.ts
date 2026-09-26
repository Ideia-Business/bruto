import type { VideoMetadata } from "../types";

export type MetaParaTags = Pick<VideoMetadata, "title">;

export interface TagsAiResult {
  /** 0 a 5 nomes de tag, minúsculos, sem duplicata. */
  tags: string[];
  /** Título mais fiel proposto pela IA — null quando o original já está bom. */
  title: string | null;
}

/**
 * Prompt de tags + título — chamada balanceada (sonnet), DEPOIS da categoria já
 * decidida (é por isso que a etapa do pipeline faz duas chamadas em sequência:
 * só se sabe QUAIS tags já existem "nesta categoria" depois de saber a categoria).
 * O texto recebido via stdin é o resumo executivo seguido da transcrição completa.
 */
export function tagsPrompt(
  meta: MetaParaTags,
  categoryName: string,
  existingTags: readonly string[],
): string {
  const lista =
    existingTags.length > 0
      ? existingTags.map((t) => `- ${t}`).join("\n")
      : "(nenhuma tag usada nesta categoria ainda — pode ser a primeira)";

  return `Você organiza uma biblioteca de vídeos por TAGS: marcadores de assunto, várias por vídeo, SEM hierarquia (não são subcategorias).

O vídeo "${meta.title}" já foi classificado na categoria "${categoryName}". O texto recebido via stdin traz o resumo executivo seguido da transcrição completa.

Tags JÁ EXISTENTES nesta categoria — REAPROVEITE sempre que o assunto casar, nunca crie uma tag nova parecida ou sinônima de uma que já existe:
${lista}

Tarefas:
1. Escolha de 2 a 5 tags de assunto para este vídeo, priorizando as da lista acima. Só invente uma tag nova quando nenhuma existente servir de verdade.
2. Avalie o título original: "${meta.title}". Se ele for genérico, truncado, clickbait vazio ou pouco fiel ao conteúdo, proponha um título mais claro e fiel (até 100 caracteres, em português). Se o original já for bom, responda null — não invente um título só para ter o que colocar.

Responda SOMENTE com um objeto JSON, sem cercas de código, sem preâmbulo, EXATAMENTE em um destes dois formatos (nunca misture os dois — "title" é OU uma string OU null, nunca as duas coisas juntas no mesmo texto):

Quando você propõe um título novo:
{"tags": ["tag um", "tag dois"], "title": "título melhor"}

Quando o título original já está bom:
{"tags": ["tag um", "tag dois"], "title": null}

Regras: "tags" é uma lista de 2 a 5 strings curtas (1 a 4 palavras), em português, minúsculas, sem numeração e sem repetir a categoria. "title" é uma string ou o literal JSON null — nunca escreva null entre aspas, e nunca escreva os dois formatos juntos.`;
}

function limitarTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const vistos = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const t = item.trim().toLowerCase();
    if (!t || t.length > 40 || vistos.has(t)) continue;
    vistos.add(t);
    out.push(t);
    if (out.length >= 5) break;
  }
  return out;
}

/**
 * Extrai o objeto JSON de dentro de texto ao redor (ex.: "Aqui está:\n{...}\n
 * espero que ajude") — do primeiro `{` ao último `}`. Devolve null quando não
 * há chave nenhuma (claramente não é JSON), para `parseTagsResponse` poder
 * distinguir "não veio JSON algum" sem nem chamar `JSON.parse`.
 */
function extrairJson(raw: string): string | null {
  const inicio = raw.indexOf("{");
  const fim = raw.lastIndexOf("}");
  if (inicio === -1 || fim === -1 || fim < inicio) return null;
  return raw.slice(inicio, fim + 1);
}

/**
 * null = FALHA DE PARSING — JSON malformado, ausente, ou envolvido em texto
 * que a extração não recuperou. Distinto de `{ tags: [], title: null }`, que é
 * uma resposta VÁLIDA (a IA respondeu no formato certo, só não achou tag boa
 * nem título melhor). Antes desta correção os dois casos eram idênticos, e
 * `reclassificar-cli` imprimia falha de parsing como "✔ ... [(nenhuma)]" —
 * sucesso, quando na verdade a resposta nem foi lida.
 */
export function parseTagsResponse(raw: string): TagsAiResult | null {
  const jsonText = extrairJson(raw);
  if (jsonText === null) return null;

  try {
    const obj = JSON.parse(jsonText) as { tags?: unknown; title?: unknown };
    const tags = limitarTags(obj.tags);
    const tituloBruto = typeof obj.title === "string" ? obj.title.trim() : "";
    // A IA às vezes erra a formatação e devolve a STRING "null" em vez do
    // valor JSON null — sem esta checagem, "null" vira o título de verdade do
    // vídeo (via setBrutoTitle) e contamina o PDF/DOCX exportado.
    const title = tituloBruto && tituloBruto.toLowerCase() !== "null" ? tituloBruto.slice(0, 150) : null;
    return { tags, title };
  } catch {
    return null;
  }
}
