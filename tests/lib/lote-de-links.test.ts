/**
 * Testes de `avaliarLoteDeLinks` (`src/lib/lote-de-links.ts`) — o parser puro
 * por trás do textarea multi-link do diálogo. Cobre lote misto (linha
 * válida + inválida + vazia), para provar que uma linha ruim não engole
 * as boas.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { avaliarLoteDeLinks, planejarEnvioDoLote } from "@/lib/lote-de-links";

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

  test("duas linhas iguais viram duas entradas (dedupe de rede é papel de planejarEnvioDoLote)", () => {
    const texto = "https://youtu.be/dQw4w9WgXcQ\nhttps://youtu.be/dQw4w9WgXcQ";
    assert.equal(avaliarLoteDeLinks(texto).length, 2);
  });
});

describe("planejarEnvioDoLote — agrupa por id, nunca por texto", () => {
  test("mesma URL em duas grafias → uma chamada de rede só, duas linhas no resumo", () => {
    // youtu.be/<id> e youtube.com/watch?v=<id> resolvem para o mesmo id em
    // reconhecerLink — a 2ª linha não pode disparar POST de novo.
    const texto = ["https://youtu.be/dQw4w9WgXcQ", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"].join("\n");
    const lote = avaliarLoteDeLinks(texto);
    const { tarefas, seguidores } = planejarEnvioDoLote(lote);

    assert.equal(tarefas.length, 1, "só uma tarefa de rede para o par");
    assert.equal(tarefas[0].index, 0);
    assert.equal(seguidores.length, 1);
    assert.deepEqual(seguidores[0], { index: 1, liderIndex: 0 });

    // As duas linhas continuam representadas: 1 tarefa + 1 seguidora = 2 slots.
    assert.equal(tarefas.length + seguidores.length, 2);
  });

  test("duas linhas com texto idêntico → dois slots no resumo, não um", () => {
    const texto = "https://youtu.be/dQw4w9WgXcQ\nhttps://youtu.be/dQw4w9WgXcQ";
    const lote = avaliarLoteDeLinks(texto);
    const { tarefas, seguidores } = planejarEnvioDoLote(lote);

    // Uma chamada de rede (mesmo id)...
    assert.equal(tarefas.length, 1);
    // ...mas os dois ÍNDICES do lote original aparecem no plano, cada um
    // com seu papel — nunca colapsados num Map chaveado por texto.
    const indicesCobertos = new Set([...tarefas.map((t) => t.index), ...seguidores.map((s) => s.index)]);
    assert.deepEqual(indicesCobertos, new Set([0, 1]));
  });

  test("link curto do TikTok (id vazio) nunca agrupa, mesmo com texto idêntico", () => {
    const texto = "https://vm.tiktok.com/ZMabc123/\nhttps://vm.tiktok.com/ZMabc123/";
    const lote = avaliarLoteDeLinks(texto);
    assert.equal(lote[0].referencia?.id, "", "id vazio é o cenário que não pode agrupar");

    const { tarefas, seguidores } = planejarEnvioDoLote(lote);
    assert.equal(tarefas.length, 2, "cada ocorrência dispara sua própria chamada");
    assert.equal(seguidores.length, 0);
  });

  test("linha inválida fica fora do plano", () => {
    const texto = "https://youtu.be/dQw4w9WgXcQ\nisto não é um link";
    const lote = avaliarLoteDeLinks(texto);
    const { tarefas, seguidores } = planejarEnvioDoLote(lote);
    assert.equal(tarefas.length, 1);
    assert.equal(tarefas[0].index, 0);
    assert.equal(seguidores.length, 0);
  });
});
