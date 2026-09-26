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
