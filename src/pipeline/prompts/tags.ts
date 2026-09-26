import type { VideoMetadata } from "../types";

export type MetaParaTags = Pick<VideoMetadata, "title">;

export interface TagsAiResult {
  /** 0 a 5 nomes de tag, minúsculos, sem duplicata. */
  tags: string[];
  /** Título mais fiel proposto pela IA — null quando o original já está bom. */
  title: string | null;
}

/**
 * Placeholders do exemplo de formato no prompt — deliberadamente algo que
 * NUNCA faria sentido como tag/título de verdade (prefixo "exemplo-" óbvio),
 * para que `pareceEcoDoPromptExemplo` abaixo detecte com segurança um modelo
 * que copiou o exemplo em vez de responder de verdade.
 */
const EXEMPLO_TAGS_DO_PROMPT = ["exemplo-tag-a", "exemplo-tag-b"];
const EXEMPLO_TITLE_DO_PROMPT = "exemplo-titulo-novo";

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

Responda SOMENTE com um objeto JSON, sem cercas de código, sem preâmbulo, EXATAMENTE em um destes dois formatos (nunca misture os dois — "title" é OU uma string OU null, nunca as duas coisas juntas no mesmo texto). Os dois abaixo são só ILUSTRAÇÃO DO FORMATO — nunca copie os valores de exemplo, sempre substitua pelo conteúdo de verdade deste vídeo:

Quando você propõe um título novo:
{"tags": ["${EXEMPLO_TAGS_DO_PROMPT[0]}", "${EXEMPLO_TAGS_DO_PROMPT[1]}"], "title": "${EXEMPLO_TITLE_DO_PROMPT}"}

Quando o título original já está bom:
{"tags": ["${EXEMPLO_TAGS_DO_PROMPT[0]}", "${EXEMPLO_TAGS_DO_PROMPT[1]}"], "title": null}

Regras: "tags" é uma lista de 2 a 5 strings curtas (1 a 4 palavras), em português, minúsculas, sem numeração e sem repetir a categoria — NUNCA os valores de exemplo acima. "title" é uma string ou o literal JSON null — nunca escreva null entre aspas, e nunca escreva os dois formatos juntos.`;
}

/** Só chame depois de já confirmar que `raw` é um array (ver `parseTagsResponse`). */
function limitarTags(raw: unknown[]): string[] {
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
 * true quando as tags batem EXATAMENTE com o exemplo do prompt (mesmo
 * conteúdo, mesma ordem) — sinal de que o modelo ecoou a instrução em vez de
 * responder de verdade. O título não entra na comparação: ele já é `null` num
 * dos dois exemplos válidos, e "título ausente" sozinho não é suspeito — é a
 * combinação com as tags-placeholder que denuncia o eco.
 */
function pareceEcoDoPromptExemplo(tags: string[]): boolean {
  return tags.length === EXEMPLO_TAGS_DO_PROMPT.length && tags.every((t, i) => t === EXEMPLO_TAGS_DO_PROMPT[i]);
}

/**
 * Extrai o PRIMEIRO objeto JSON balanceado de dentro de texto ao redor (ex.:
 * "Aqui está:\n{...}\nespero que ajude"). Do primeiro `{` até a `}` que FECHA
 * ELE (contando profundidade, ciente de string entre aspas) — nunca até a
 * última `}` do texto inteiro.
 *
 * A versão anterior ia do primeiro `{` ao ÚLTIMO `}`: se a IA ecoar os dois
 * exemplos do próprio prompt (padrão conhecido de falha de modelo — repetir
 * instrução em vez de responder), esse recorte juntava os dois objetos num
 * blob inválido, e `JSON.parse` falhava mesmo havendo um JSON válido ali
 * dentro. Parar na chave que fecha a PRIMEIRA abertura resolve isso.
 *
 * Devolve null quando não há `{` nenhum, ou quando a abertura encontrada
 * nunca fecha (JSON cortado no meio) — os dois casos em que não há o que
 * tentar interpretar.
 */
function extrairJson(raw: string): string | null {
  const inicio = raw.indexOf("{");
  if (inicio === -1) return null;

  let profundidade = 0;
  let dentroDeString = false;
  let escapando = false;

  for (let i = inicio; i < raw.length; i++) {
    const c = raw[i];

    if (escapando) {
      escapando = false;
      continue;
    }
    if (dentroDeString) {
      if (c === "\\") escapando = true;
      else if (c === '"') dentroDeString = false;
      continue;
    }
    if (c === '"') {
      dentroDeString = true;
    } else if (c === "{") {
      profundidade++;
    } else if (c === "}") {
      profundidade--;
      if (profundidade === 0) return raw.slice(inicio, i + 1);
    }
  }
  return null;
}

/**
 * null = FALHA DE PARSING — JSON malformado, ausente, envolvido em texto que a
 * extração não recuperou, OU sintaticamente válido mas com o CONTRATO errado
 * (`tags` não é array, `title` não é string/null) ou ecoando literalmente o
 * exemplo do prompt. Distinto de `{ tags: [], title: null }`, que é uma
 * resposta VÁLIDA (a IA respondeu no formato certo, só não achou tag boa nem
 * título melhor). Antes desta correção qualquer JSON sintaticamente válido —
 * mesmo com tipo errado ou sendo o próprio exemplo ecoado — virava sucesso, e
 * `05-category.ts` (que substitui o conjunto de tags sempre que o parsing
 * "funciona") apagava as tags reais do vídeo com lixo ou com o placeholder.
 */
export function parseTagsResponse(raw: string): TagsAiResult | null {
  const jsonText = extrairJson(raw);
  if (jsonText === null) return null;

  try {
    const obj = JSON.parse(jsonText) as { tags?: unknown; title?: unknown };

    // Contrato: "tags" TEM que ser array (senão é falha de parsing, nunca
    // lista vazia — string solta como "python, ia" não pode virar "nenhuma
    // tag boa", pois isso apaga as tags que o vídeo já tinha).
    if (!Array.isArray(obj.tags)) return null;
    // Contrato, um nível mais fundo (achado 2, Codex, 7ª rodada): o ARRAY
    // pode ser de verdade mas os ELEMENTOS não — ex.: `[{"name":"python"}]`.
    // `limitarTags` descartaria cada item não-string e devolveria `[]`,
    // indistinguível de "a IA decidiu que não há tag boa" — mesma classe de
    // dano do achado anterior, um passo adiante.
    if (!obj.tags.every((t) => typeof t === "string")) return null;
    // Contrato: "title" só pode ser string ou o valor JSON null.
    if (obj.title !== null && obj.title !== undefined && typeof obj.title !== "string") return null;

    const tags = limitarTags(obj.tags);
    const tituloBruto = typeof obj.title === "string" ? obj.title.trim() : "";
    // A IA às vezes erra a formatação e devolve a STRING "null" em vez do
    // valor JSON null — sem esta checagem, "null" vira o título de verdade do
    // vídeo (via setBrutoTitle) e contamina o PDF/DOCX exportado.
    const title = tituloBruto && tituloBruto.toLowerCase() !== "null" ? tituloBruto.slice(0, 150) : null;

    // A IA ecoou o EXEMPLO do prompt em vez de responder de verdade — o JSON
    // é sintaticamente válido e passa em toda validação de tipo acima, mas o
    // conteúdo é o placeholder, não uma resposta real.
    if (pareceEcoDoPromptExemplo(tags)) return null;

    return { tags, title };
  } catch {
    return null;
  }
}
