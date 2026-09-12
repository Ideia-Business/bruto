/**
 * Testes de `stripFences` — remove a cerca de código markdown que os modelos
 * costumam colocar ao redor da resposta inteira quando o prompt pede JSON ou
 * markdown. O ponto delicado é o "envolvendo TUDO": uma cerca que aparece só
 * no MEIO do texto (ex.: o próprio modelo citando um trecho de código como
 * exemplo) não deve ser removida — só a que emoldura a resposta inteira.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { stripFences } from "@/pipeline/lib/llm/parse";

describe("stripFences", () => {
  test("remove cerca simples sem tag de linguagem", () => {
    const entrada = "```\n{\"ok\": true}\n```";
    assert.equal(stripFences(entrada), '{"ok": true}');
  });

  test("remove cerca com tag de linguagem declarada (```json)", () => {
    const entrada = '```json\n{"ok": true}\n```';
    assert.equal(stripFences(entrada), '{"ok": true}');
  });

  test("remove cerca com tag de linguagem markdown", () => {
    const entrada = "```markdown\n# título\n\nconteúdo\n```";
    assert.equal(stripFences(entrada), "# título\n\nconteúdo");
  });

  test("devolve o texto (com trim) quando não há cerca nenhuma", () => {
    const entrada = "  texto solto, sem cerca de código  ";
    assert.equal(stripFences(entrada), "texto solto, sem cerca de código");
  });

  test("NÃO remove cerca que aparece no MEIO do texto, sem envolver tudo", () => {
    // Este é o caso que separa uma implementação ingênua (remove ``` em
    // qualquer lugar) da correta (só remove quando a cerca emoldura o texto
    // INTEIRO). Se a regex virar gulosa/global, este teste reprova.
    const entrada = 'Aqui vai um exemplo:\n```js\nconsole.log(1)\n```\nFim da explicação.';
    assert.equal(stripFences(entrada), entrada.trim());
  });

  test("não remove cerca de abertura sem fechamento correspondente", () => {
    const entrada = "```json\n{\"incompleto\": true}";
    assert.equal(stripFences(entrada), entrada.trim());
  });

  test("tolera espaço em branco antes/depois da cerca inteira", () => {
    const entrada = "\n\n```\nconteúdo\n```\n\n";
    assert.equal(stripFences(entrada), "conteúdo");
  });

  test("cerca vazia devolve string vazia", () => {
    assert.equal(stripFences("```\n\n```"), "");
  });

  test("string vazia não lança e devolve vazio", () => {
    assert.equal(stripFences(""), "");
  });
});
