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
    // Os dois formatos válidos precisam aparecer, cada um por si, com os
    // placeholders óbvios (nunca palavras que pareçam resposta de verdade).
    assert.match(prompt, /\{"tags":\s*\["exemplo-tag-a", "exemplo-tag-b"\], "title": "exemplo-titulo-novo"\}/);
    assert.match(prompt, /\{"tags":\s*\["exemplo-tag-a", "exemplo-tag-b"\], "title": null\}/);
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

  test("string vazia de título não vira título (evita título em branco)", () => {
    const r = parseTagsResponse('{"tags": [], "title": "   "}');
    assert.ok(r);
    assert.equal(r.title, null);
  });

  /**
   * REGRESSÃO (achado 1, os dois revisores — o mais grave da 6ª rodada):
   * `tags` com o TIPO errado (JSON sintaticamente válido, mas não é array)
   * caía silenciosamente em `[]` — uma lista vazia é uma resposta VÁLIDA (a IA
   * decidiu que não há tag boa), então `05-category.ts` (que substitui o
   * conjunto sempre que o parsing "funciona") apagava as tags reais do vídeo
   * com base numa resposta que na verdade violou o contrato. Agora isso é
   * FALHA DE PARSING (null), nunca lista vazia.
   */
  test('REGRESSÃO: "tags" com tipo errado (não-array) vira null, NUNCA lista vazia', () => {
    assert.equal(parseTagsResponse('{"tags": "python, ia", "title": null}'), null);
    assert.equal(parseTagsResponse('{"tags": 42, "title": null}'), null);
    assert.equal(parseTagsResponse('{"tags": null, "title": null}'), null);
    assert.equal(parseTagsResponse('{"title": null}'), null, "tags AUSENTE também é contrato quebrado");
  });

  test('REGRESSÃO: "title" com tipo errado (número, booleano, objeto) vira null, nunca título vazio', () => {
    assert.equal(parseTagsResponse('{"tags": ["ia"], "title": 42}'), null);
    assert.equal(parseTagsResponse('{"tags": ["ia"], "title": true}'), null);
    assert.equal(parseTagsResponse('{"tags": ["ia"], "title": {"x": 1}}'), null);
  });

  /**
   * REGRESSÃO (achado 2, Codex, 7ª rodada — um nível mais fundo que o achado
   * 1): o ARRAY de `tags` é de verdade, mas os ELEMENTOS não são string —
   * `limitarTags` descartaria cada item não-string e devolveria `[]`,
   * indistinguível de "a IA decidiu que não há tag boa" (mesma classe de dano
   * do achado 1, um passo adiante). Agora qualquer elemento que não seja
   * string já derruba a resposta inteira como falha de parsing.
   */
  test('REGRESSÃO: array de "tags" com ELEMENTOS de tipo errado vira null (não silenciosamente [])', () => {
    assert.equal(parseTagsResponse('{"tags": [{"name": "python"}], "title": null}'), null);
    assert.equal(parseTagsResponse('{"tags": [42, "ia"], "title": null}'), null, "um único elemento errado já invalida a lista inteira");
    assert.equal(parseTagsResponse('{"tags": [null], "title": null}'), null);
  });

  test('controle positivo: array de "tags" só com strings continua funcionando normalmente', () => {
    const r = parseTagsResponse('{"tags": ["python", "ia"], "title": null}');
    assert.ok(r);
    assert.deepEqual(r.tags, ["python", "ia"]);
  });

  test('array de "tags" VAZIO continua sendo uma resposta válida (a IA decidiu que não há tag boa)', () => {
    const r = parseTagsResponse('{"tags": [], "title": null}');
    assert.ok(r, "lista vazia é uma resposta legítima, não deveria virar falha de parsing");
    assert.deepEqual(r.tags, []);
  });

  test('"title" ausente (chave nem existe) é tratado como null, não como contrato quebrado', () => {
    const r = parseTagsResponse('{"tags": ["ia"]}');
    assert.ok(r);
    assert.equal(r.title, null);
  });

  /**
   * REGRESSÃO (achado 3, Grok — rodada anterior): a IA às vezes erra a
   * formatação e devolve a STRING "null" em vez do valor JSON null. Sem esta
   * checagem, "null" vira o TÍTULO DE VERDADE do vídeo (`setBrutoTitle`) e
   * contamina o PDF/DOCX exportado.
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

  /**
   * REGRESSÃO (achado 3, Grok — 5ª rodada): a versão anterior de
   * `extrairJson` ia do PRIMEIRO `{` ao ÚLTIMO `}` do texto inteiro. Dois
   * objetos JSON colados (nomes de tag genéricos aqui — o cenário específico
   * de ECOAR O EXEMPLO do prompt tem teste dedicado logo abaixo) juntavam num
   * blob inválido e `JSON.parse` falhava por inteiro. Agora o scanner para na
   * chave que fecha a PRIMEIRA abertura — extrai o primeiro objeto
   * balanceado, ignora o resto.
   */
  test("REGRESSÃO: dois objetos JSON colados não viram um blob inválido — extrai só o primeiro", () => {
    const doisObjetosColados = '{"tags": ["ia", "python"], "title": "Um título"}\n{"tags": ["outra", "coisa"], "title": null}';
    const r = parseTagsResponse(doisObjetosColados);
    assert.ok(r, "deveria ter extraído o PRIMEIRO objeto balanceado, não falhado no blob dos dois juntos");
    assert.deepEqual(r.tags, ["ia", "python"]);
    assert.equal(r.title, "Um título");
  });

  test("chave/colchete dentro de uma STRING não confunde a contagem de profundidade", () => {
    const r = parseTagsResponse('{"tags": ["ia"], "title": "Ep. 5: {Especial} [parte 2]"}');
    assert.ok(r, "aspas literais dentro de valores de string não deveriam quebrar o balanceamento de chaves");
    assert.equal(r.title, "Ep. 5: {Especial} [parte 2]");
  });

  /**
   * REGRESSÃO (achado 2, Grok — 6ª rodada, "ainda mais grave que o 1"): o
   * scanner de chaves balanceadas (fix da rodada anterior) resolveu "dois
   * objetos colados", mas abriu um buraco novo — se a IA ecoar o PRÓPRIO
   * EXEMPLO do prompt (os literais exatos do formato pedido) em vez de
   * responder de verdade, o objeto extraído é JSON perfeitamente válido, com
   * os TIPOS certos, e passava em qualquer validação de contrato. O vídeo
   * ficava com tags/título PLACEHOLDER, indistinguível de uma resposta real.
   * Agora: tags que batem EXATAMENTE com o exemplo do prompt (mesmo conteúdo,
   * mesma ordem) são tratadas como falha de parsing, não como resposta real —
   * e os placeholders do prompt viraram algo ("exemplo-tag-a"/"exemplo-tag-b")
   * que nunca faria sentido como tag de verdade, reduzindo ainda mais a
   * chance de uma resposta LEGÍTIMA colidir por coincidência.
   */
  test("REGRESSÃO: ecoar o exemplo do prompt (com título de exemplo) vira falha de parsing", () => {
    const r = parseTagsResponse('{"tags": ["exemplo-tag-a", "exemplo-tag-b"], "title": "exemplo-titulo-novo"}');
    assert.equal(r, null);
  });

  test("REGRESSÃO: ecoar o exemplo do prompt (com title: null) também vira falha de parsing", () => {
    const r = parseTagsResponse('{"tags": ["exemplo-tag-a", "exemplo-tag-b"], "title": null}');
    assert.equal(r, null);
  });

  test("REGRESSÃO: ecoar os DOIS exemplos colados (o cenário original do achado) vira falha de parsing", () => {
    const doisExemplosDoPrompt =
      '{"tags": ["exemplo-tag-a", "exemplo-tag-b"], "title": "exemplo-titulo-novo"}\n{"tags": ["exemplo-tag-a", "exemplo-tag-b"], "title": null}';
    assert.equal(parseTagsResponse(doisExemplosDoPrompt), null);
  });

  test("controle negativo: tags parecidas mas DIFERENTES do exemplo não são tratadas como eco", () => {
    const r = parseTagsResponse('{"tags": ["exemplo-tag-a"], "title": null}'); // só uma, não as duas
    assert.ok(r, "uma única tag parcialmente parecida com o placeholder não deveria disparar a detecção de eco");
    assert.deepEqual(r.tags, ["exemplo-tag-a"]);
  });

  test("controle negativo: tags reais de assunto passam normalmente (não são o placeholder)", () => {
    const r = parseTagsResponse('{"tags": ["inteligência artificial", "python"], "title": null}');
    assert.ok(r);
    assert.deepEqual(r.tags, ["inteligência artificial", "python"]);
  });
});
