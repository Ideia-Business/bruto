/**
 * Testes de `avaliarLoteDeLinks` (`src/lib/lote-de-links.ts`) — o parser puro
 * por trás do textarea multi-link do diálogo. Cobre lote misto (linha
 * válida + inválida + vazia), para provar que uma linha ruim não engole
 * as boas.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { avaliarLoteDeLinks } from "@/lib/lote-de-links";

describe("avaliarLoteDeLinks", () => {
  test("string vazia → lote vazio", () => {
    assert.deepEqual(avaliarLoteDeLinks(""), []);
    assert.deepEqual(avaliarLoteDeLinks("   \n  \n"), []);
  });

  test("uma linha válida", () => {
    const [linha] = avaliarLoteDeLinks("https://youtu.be/dQw4w9WgXcQ");
    assert.equal(linha.linha, "https://youtu.be/dQw4w9WgXcQ");
    assert.deepEqual(linha.referencia, { plataforma: "youtube", id: "dQw4w9WgXcQ" });
  });

  test("lote misto: válida + inválida + linha em branco no meio", () => {
    const texto = [
      "https://youtu.be/dQw4w9WgXcQ",
      "",
      "isto não é um link",
      "   ",
      "https://www.tiktok.com/@user/video/123",
      "https://vimeo.com/123456",
    ].join("\n");

    const resultado = avaliarLoteDeLinks(texto);

    // linhas em branco somem — só 4 linhas de conteúdo real chegam ao lote.
    assert.equal(resultado.length, 4);

    assert.equal(resultado[0].linha, "https://youtu.be/dQw4w9WgXcQ");
    assert.ok(resultado[0].referencia);
    assert.equal(resultado[0].referencia?.plataforma, "youtube");

    assert.equal(resultado[1].linha, "isto não é um link");
    assert.equal(resultado[1].referencia, null);

    assert.equal(resultado[2].linha, "https://www.tiktok.com/@user/video/123");
    assert.ok(resultado[2].referencia);
    assert.equal(resultado[2].referencia?.plataforma, "tiktok");

    assert.equal(resultado[3].linha, "https://vimeo.com/123456");
    assert.equal(resultado[3].referencia, null);
  });

  test("trim de espaços nas pontas de cada linha", () => {
    const [linha] = avaliarLoteDeLinks("   https://youtu.be/dQw4w9WgXcQ   ");
    assert.equal(linha.linha, "https://youtu.be/dQw4w9WgXcQ");
  });

  test("duas linhas iguais viram duas entradas (dedupe é papel do servidor)", () => {
    const texto = "https://youtu.be/dQw4w9WgXcQ\nhttps://youtu.be/dQw4w9WgXcQ";
    assert.equal(avaliarLoteDeLinks(texto).length, 2);
  });
});
