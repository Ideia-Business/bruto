/**
 * `resolveTagNames` — a garantia que o dono pediu: reaproveitar uma tag já
 * existente sempre que o assunto casar, nunca duplicar. A chave de
 * reaproveitamento é o SLUG (sem acento, minúsculo), não a grafia exata —
 * "IA" e "ia" precisam colapsar na mesma tag.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { resolveTagNames, slugifyTag } from "@/pipeline/lib/tags";

describe("slugifyTag", () => {
  test("remove acento, baixa a caixa, troca espaço por hífen", () => {
    assert.equal(slugifyTag("Inteligência Artificial"), "inteligencia-artificial");
  });

  test("grafias diferentes do mesmo assunto colapsam no mesmo slug", () => {
    assert.equal(slugifyTag("IA"), slugifyTag(" ia "));
  });

  /**
   * REGRESSÃO (achado 4, Codex + Grok): a versão anterior removia `+` e `#`
   * junto com todo o resto fora de `a-z0-9`, então "C++" e "C#" — dois
   * assuntos diferentes — colapsavam ambos em "c". Símbolos que distinguem
   * nomes de linguagem/tecnologia agora sobrevivem no slug.
   */
  test("REGRESSÃO: 'C++' e 'C#' não colidem mais no mesmo slug", () => {
    const cpp = slugifyTag("C++");
    const csharp = slugifyTag("C#");
    assert.notEqual(cpp, csharp, `C++ e C# deveriam gerar slugs diferentes; os dois viraram "${cpp}"`);
    assert.equal(cpp, "c++");
    assert.equal(csharp, "c#");
  });

  test("ponto sobrevive no slug (.NET, Node.js)", () => {
    assert.equal(slugifyTag(".NET"), ".net");
    assert.equal(slugifyTag("Node.js"), "node.js");
  });

  /**
   * REGRESSÃO (achado 4, Grok): nome sem NENHUM caractere significativo (ex.:
   * "???") caía num fallback `nanoid(8)` — aleatório a cada chamada — então o
   * MESMO nome degenerado nunca reaproveitava, sempre criava tag nova. Agora o
   * fallback é um hash ESTÁVEL do nome original: chamar duas vezes com o
   * mesmo nome degenerado dá o MESMO slug.
   */
  test("REGRESSÃO: nome sem caractere significativo nenhum vira um slug ESTÁVEL (nunca aleatório)", () => {
    const a = slugifyTag("???");
    const b = slugifyTag("???");
    assert.equal(a, b, "o mesmo nome degenerado deveria sempre gerar o mesmo slug, para poder reaproveitar");
    assert.ok(a.length > 0, "nunca pode devolver vazio (Drizzle exige NOT NULL/UNIQUE em tags.slug)");
  });

  test("nomes degenerados DIFERENTES não colidem no mesmo slug estável", () => {
    assert.notEqual(slugifyTag("???"), slugifyTag("!!!"));
  });
});

describe("resolveTagNames", () => {
  test("nome cujo slug já existe é marcado como reaproveitado", () => {
    const out = resolveTagNames(["Python"], ["python", "javascript"]);
    assert.deepEqual(out, [{ name: "Python", slug: "python", reused: true }]);
  });

  test("nome cujo slug NÃO existe é marcado para criar", () => {
    const out = resolveTagNames(["Rust"], ["python"]);
    assert.deepEqual(out, [{ name: "Rust", slug: "rust", reused: false }]);
  });

  test("duas grafias do mesmo assunto na mesma resposta deduplicam (só a primeira sobrevive)", () => {
    const out = resolveTagNames(["IA", "ia", " Ia "], []);
    assert.equal(out.length, 1);
    assert.equal(out[0].slug, "ia");
  });

  test("nomes vazios/só espaço são descartados", () => {
    const out = resolveTagNames(["", "   ", "válida"], []);
    assert.deepEqual(
      out.map((r) => r.name),
      ["válida"],
    );
  });

  test("lista vazia de nomes devolve lista vazia", () => {
    assert.deepEqual(resolveTagNames([], ["python"]), []);
  });
});
