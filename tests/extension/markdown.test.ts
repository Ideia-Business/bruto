/**
 * Testes de `renderMarkdown` — a fronteira entre o que um modelo de IA escreve e
 * o `innerHTML` do popup.
 *
 * Por que existem: a Aula passou a usar `studyPrompt`, cuja seção "Teste seu
 * entendimento" esconde cada resposta num `<details>`. Para isso o renderizador
 * deixou de escapar TODO o HTML e passou a reconhecer duas tags. Uma exceção numa
 * função que alimenta `innerHTML` é exatamente o tipo de coisa que se afrouxa
 * sozinha depois — então cada tag permitida tem aqui um teste nomeado, e cada
 * forma de burlar a exceção também.
 *
 * A extensão guarda a chave de IA de quem usa em `chrome.storage`; XSS aqui é
 * roubo de credencial, não defeito estético.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown } from "../../extension/src/lib/markdown";

/**
 * A invariante que de fato importa, e a única que não se afrouxa sem alguém
 * notar: **toda tag no HTML de saída é uma das que este renderizador escreve.**
 *
 * Asserção por substring não serve aqui. `onerror="alert(1)"` aparece no texto
 * de saída quando o modelo escreve isso — mas inerte, dentro de um `&lt;img`
 * escapado, porque o `<` nunca virou tag. O que separa um XSS de um texto feio é
 * a tag ter sido FORMADA, e é isso que se mede.
 */
const TAGS_NOSSAS = /^<\/?(?:p|h1|h2|h3|ul|ol|li|strong|em|code|details|summary)>$/;

function tagsEstranhas(html: string): string[] {
  return (html.match(/<[^>]*>/g) ?? []).filter((t) => !TAGS_NOSSAS.test(t));
}

describe("renderMarkdown — o que NÃO pode passar", () => {
  test("script no texto do modelo vira texto, não elemento", () => {
    const html = renderMarkdown("Olha isto: <script>alert(1)</script>");
    assert.deepEqual(tagsEstranhas(html), [], "nenhuma tag fora da nossa lista");
    assert.ok(html.includes("&lt;script&gt;"), "ela tem de sair escapada");
  });

  test("atributo de evento embutido não forma tag nenhuma", () => {
    const html = renderMarkdown('<img src=x onerror="alert(1)">');
    assert.deepEqual(tagsEstranhas(html), [], "o `<` do img nunca vira tag");
    assert.ok(html.includes("&lt;img"), "sobra como texto escapado, e inerte");
  });

  test("`<details>` COM atributo é recusado — a exceção é só a tag nua", () => {
    const html = renderMarkdown('<details onclick="alert(1)">');
    assert.ok(!html.includes("<details"), "details com atributo não é reconhecido");
    assert.ok(html.includes("&lt;details"), "vira texto escapado");
  });

  test("`</details>` órfão não fecha nada — vira texto", () => {
    const html = renderMarkdown("</details>");
    assert.ok(!html.includes("</details>"), "não emite fechamento sem abertura");
    assert.ok(html.includes("&lt;/details&gt;"));
  });

  test("o texto DENTRO do summary continua escapado", () => {
    const html = renderMarkdown("<details><summary>a <script>x</script> b</summary>");
    assert.ok(html.includes("<summary>"), "a tag summary é emitida por nós");
    assert.deepEqual(tagsEstranhas(html), [], "o conteúdo dela não vira tag");
  });

  test("a aula inteira de um modelo hostil não produz tag estranha", () => {
    const hostil = [
      "# Aula: <img src=x onerror=roubar()>",
      "<details open onclick='x'><summary><b>bold</b></summary>",
      "<iframe src=//mal.example></iframe>",
      "</details></details>",
    ].join("\n");
    assert.deepEqual(tagsEstranhas(renderMarkdown(hostil)), []);
  });
});

describe("renderMarkdown — a seção de fixação da Aula", () => {
  /** Exatamente o formato que `studyPrompt` manda o modelo produzir. */
  const fixacao = [
    "## Teste seu entendimento",
    "",
    "**1. O que é entropia?**",
    "<details><summary>Ver resposta</summary>",
    "",
    "É a medida da desordem de um sistema.",
    "",
    "</details>",
  ].join("\n");

  test("a resposta fica dentro de um details de verdade", () => {
    const html = renderMarkdown(fixacao);
    assert.ok(html.includes("<details>"), "abre o bloco");
    assert.ok(html.includes("<summary>Ver resposta</summary>"), "com o sumário");
    assert.ok(html.includes("</details>"), "e fecha");
    assert.ok(
      html.indexOf("É a medida") > html.indexOf("<details>"),
      "a resposta tem de ficar DENTRO do bloco — fora dele, o teste deixa de ser teste",
    );
    assert.ok(html.indexOf("É a medida") < html.indexOf("</details>"));
  });

  test("`<summary>` em linha própria também é aceito", () => {
    // O prompt pede as duas na mesma linha, mas modelo nenhum é fiel o bastante
    // para se apostar nisso — e a resposta exposta seria uma falha silenciosa.
    const html = renderMarkdown("<details>\n<summary>Ver resposta</summary>\n\nporque sim\n\n</details>");
    assert.ok(html.includes("<summary>Ver resposta</summary>"));
    assert.ok(html.includes("</details>"));
  });

  test("resposta cortada no meio não engole o resto da aula", () => {
    // Teto de tokens ou queda de rede: o `<details>` fica sem fechamento e o
    // navegador esconderia tudo o que viesse depois.
    const html = renderMarkdown("<details><summary>Ver resposta</summary>\n\nmeia resp");
    const abre = (html.match(/<details>/g) ?? []).length;
    const fecha = (html.match(/<\/details>/g) ?? []).length;
    assert.equal(abre, fecha, "todo details aberto é fechado no fim");
  });
});

describe("renderMarkdown — o markdown que já funcionava", () => {
  test("títulos, listas, negrito e código seguem valendo", () => {
    const html = renderMarkdown("# Aula\n\n- um\n- dois\n\n**forte** e `codigo`");
    assert.ok(html.includes("<h1>Aula</h1>"));
    assert.ok(html.includes("<ul><li>um</li><li>dois</li></ul>"));
    assert.ok(html.includes("<strong>forte</strong>"));
    assert.ok(html.includes("<code>codigo</code>"));
  });

  test("lista numerada da fixação vira ol", () => {
    const html = renderMarkdown("1. primeira\n2. segunda");
    assert.ok(html.includes("<ol><li>primeira</li><li>segunda</li></ol>"));
  });
});
