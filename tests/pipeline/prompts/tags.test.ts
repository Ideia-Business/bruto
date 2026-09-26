import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseTagsResponse, tagsPrompt } from "@/pipeline/prompts/tags";

describe("tagsPrompt", () => {
  test("inclui as tags já existentes, para orientar o reaproveitamento", () => {
    const prompt = tagsPrompt({ title: "Título" }, "Tecnologia", ["inteligência artificial", "python"]);
    assert.ok(prompt.includes("inteligência artificial"));
    assert.ok(prompt.includes("python"));
    assert.ok(prompt.includes("Tecnologia"));
  });

  test("lista vazia vira uma frase explícita, não uma seção em branco", () => {
    const prompt = tagsPrompt({ title: "Título" }, "Ciência", []);
    assert.ok(prompt.includes("nenhuma tag usada nesta categoria ainda"));
  });

  /**
   * REGRESSÃO (achado do Grok na revisão cross-vendor): o exemplo de formato
   * trazia `"title": "título melhor" | null` com o `|` LITERAL dentro do JSON
   * de exemplo. Um modelo que copia o formato ao pé da letra devolve um JSON
   * inválido (`parseTagsResponse` cai no catch, o vídeo fica sem tag nenhuma).
   * O prompt agora mostra DOIS exemplos válidos separados — nunca o `|` dentro
   * de um bloco que parece JSON.
   */
  test("REGRESSÃO: não mostra `| null` dentro do exemplo de JSON (union type inválido como JSON)", () => {
    const prompt = tagsPrompt({ title: "Título" }, "Tecnologia", []);
    assert.doesNotMatch(
      prompt,
      /"title":\s*"[^"]*"\s*\|\s*null/,
      "o exemplo não pode misturar string e null com | dentro do mesmo JSON",
    );
    // Os dois formatos válidos precisam aparecer, cada um por si.
    assert.match(prompt, /\{"tags":\s*\["tag um", "tag dois"\], "title": "título melhor"\}/);
    assert.match(prompt, /\{"tags":\s*\["tag um", "tag dois"\], "title": null\}/);
  });
});

describe("parseTagsResponse", () => {
  test("caminho feliz: JSON limpo com tags e título", () => {
    const r = parseTagsResponse('{"tags": ["ia", "python"], "title": "Título melhor"}');
    assert.ok(r, "resposta bem formada não deveria falhar o parsing");
    assert.deepEqual(r.tags, ["ia", "python"]);
    assert.equal(r.title, "Título melhor");
  });

  test("title null vira null (a IA decidiu não propor)", () => {
    const r = parseTagsResponse('{"tags": ["ia"], "title": null}');
    assert.ok(r);
    assert.equal(r.title, null);
  });

  test("dedup: tags repetidas (mesmo após lowercase/trim) colapsam numa só", () => {
    const r = parseTagsResponse('{"tags": ["IA", " ia ", "Python"], "title": null}');
    assert.ok(r);
    assert.deepEqual(r.tags, ["ia", "python"]);
  });

  test("corta em 5 tags mesmo se a IA mandar mais", () => {
    const muitas = Array.from({ length: 9 }, (_, i) => `tag${i}`);
    const r = parseTagsResponse(JSON.stringify({ tags: muitas, title: null }));
    assert.ok(r);
    assert.equal(r.tags.length, 5);
  });

  test("campos ausentes/tipo errado são tratados como vazios, sem lançar (JSON válido, contrato errado)", () => {
    const r = parseTagsResponse('{"tags": "não é lista", "title": 42}');
    assert.deepEqual(r, { tags: [], title: null });
  });

  test("string vazia de título não vira título (evita título em branco)", () => {
    const r = parseTagsResponse('{"tags": [], "title": "   "}');
    assert.ok(r);
    assert.equal(r.title, null);
  });

  /**
   * REGRESSÃO (achado 3, Grok — o mais grave desta rodada): a IA às vezes
   * erra a formatação e devolve a STRING "null" em vez do valor JSON null. Sem
   * esta checagem, "null" vira o TÍTULO DE VERDADE do vídeo (`setBrutoTitle`)
   * e contamina o PDF/DOCX exportado.
   */
  test('REGRESSÃO: title como a STRING "null" (não o valor JSON) vira null, nunca o título', () => {
    const r = parseTagsResponse('{"tags": ["ia"], "title": "null"}');
    assert.ok(r);
    assert.equal(r.title, null);
  });

  test('REGRESSÃO: "NULL"/"Null" (variações de caixa) também viram null', () => {
    assert.equal(parseTagsResponse('{"tags": [], "title": "NULL"}')?.title, null);
    assert.equal(parseTagsResponse('{"tags": [], "title": "Null"}')?.title, null);
  });

  /**
   * REGRESSÃO (achado 2, Grok): `JSON.parse` lançava quando a IA envolvia o
   * JSON em texto (ex.: "Aqui está:\n{...}"), e o catch devolvia
   * `{tags: [], title: null}` — EXATAMENTE igual a uma resposta legítima "sem
   * tags boas". `reclassificar-cli` imprimia isso como sucesso quando na
   * verdade foi falha de parsing. Agora: (a) texto ao redor de um JSON válido
   * é EXTRAÍDO e interpretado normalmente; (b) texto que não tem JSON nenhum
   * vira `null` — um valor DISTINTO de `{tags: [], title: null}` — para o
   * chamador poder diferenciar os dois casos.
   */
  test("REGRESSÃO: JSON envolvido em texto é extraído e interpretado normalmente", () => {
    const r = parseTagsResponse('Aqui está sua resposta:\n{"tags": ["ia", "python"], "title": null}\nEspero que ajude!');
    assert.ok(r, "deveria ter extraído o JSON de dentro do texto");
    assert.deepEqual(r.tags, ["ia", "python"]);
  });

  test("REGRESSÃO: resposta sem NENHUM JSON vira null (falha de parsing), nunca { tags: [], title: null }", () => {
    const r = parseTagsResponse("Desculpe, não consigo ajudar com isso.");
    assert.equal(r, null);
  });

  test("REGRESSÃO: JSON de verdade malformado (chaves presentes, sintaxe quebrada) também vira null", () => {
    const r = parseTagsResponse('{"tags": ["ia",], "title": }');
    assert.equal(r, null);
  });
});
