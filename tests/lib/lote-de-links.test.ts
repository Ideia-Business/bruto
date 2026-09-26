/**
 * Testes de `avaliarLoteDeLinks` (`src/lib/lote-de-links.ts`) — o parser puro
 * por trás do textarea multi-link do diálogo. Cobre lote misto (linha
 * válida + inválida + vazia), para provar que uma linha ruim não engole
 * as boas.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  avaliarLoteDeLinks,
  chaveDeRastreio,
  contarEnvioDoLote,
  filtrarNaoEnviados,
  planejarEnvioDoLote,
} from "@/lib/lote-de-links";

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

describe("filtrarNaoEnviados — não reenvia o que já voltou fila/duplicado", () => {
  test("linha cujo id já está em jaEnviados some do lote; a outra fica", () => {
    // Simula: 1ª rodada mandou youtu.be/X pra fila; a pessoa edita e
    // adiciona uma linha nova, mas a linha do X (mesmo em outra grafia)
    // continua no textarea — não pode virar um 2º job do mesmo vídeo.
    const lote = avaliarLoteDeLinks(
      ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://youtu.be/AAAAAAAAAAA"].join("\n"),
    );
    const jaEnviados = new Set([chaveDeRastreio(lote[0])]);

    const restante = filtrarNaoEnviados(lote, jaEnviados);

    assert.equal(restante.length, 1);
    assert.equal(restante[0].linha, "https://youtu.be/AAAAAAAAAAA");
  });

  test("chave por id barra a mesma mídia mesmo em grafia diferente da que gerou a chave", () => {
    const jaEnviados = new Set([chaveDeRastreio(avaliarLoteDeLinks("https://youtu.be/dQw4w9WgXcQ")[0])]);
    const loteComOutraGrafia = avaliarLoteDeLinks("https://www.youtube.com/watch?v=dQw4w9WgXcQ");

    assert.deepEqual(filtrarNaoEnviados(loteComOutraGrafia, jaEnviados), []);
  });

  test("sem id (link curto do TikTok), a chave cai no texto cru — só barra o texto idêntico", () => {
    const linhaOriginal = avaliarLoteDeLinks("https://vm.tiktok.com/ZMabc123/")[0];
    const jaEnviados = new Set([chaveDeRastreio(linhaOriginal)]);

    const mesmoTexto = avaliarLoteDeLinks("https://vm.tiktok.com/ZMabc123/");
    const textoDiferente = avaliarLoteDeLinks("https://vm.tiktok.com/ZMoutro9/");

    assert.deepEqual(filtrarNaoEnviados(mesmoTexto, jaEnviados), []);
    assert.equal(filtrarNaoEnviados(textoDiferente, jaEnviados).length, 1);
  });

  test("jaEnviados vazio não filtra nada", () => {
    const lote = avaliarLoteDeLinks("https://youtu.be/dQw4w9WgXcQ\nisto não é um link");
    assert.deepEqual(filtrarNaoEnviados(lote, new Set()), lote);
  });
});

describe("contarEnvioDoLote — na fila conta por jobId único", () => {
  test("duas linhas com o mesmo jobId (mesma mídia, agrupada) contam como 1 na fila", () => {
    const contagem = contarEnvioDoLote([
      { status: "fila", jobId: "job-1" },
      { status: "fila", jobId: "job-1" },
    ]);
    assert.equal(contagem.naFila, 1);
  });

  test("duas linhas com jobId diferente contam como 2", () => {
    const contagem = contarEnvioDoLote([
      { status: "fila", jobId: "job-1" },
      { status: "fila", jobId: "job-2" },
    ]);
    assert.equal(contagem.naFila, 2);
  });

  test("duplicados e falhas (erro + inválido) contam por linha, não por jobId", () => {
    const contagem = contarEnvioDoLote([
      { status: "duplicado" },
      { status: "duplicado" },
      { status: "erro" },
      { status: "invalido" },
    ]);
    assert.equal(contagem.naFila, 0);
    assert.equal(contagem.duplicados, 2);
    assert.equal(contagem.falhas, 2);
  });

  test("lote vazio conta tudo zero", () => {
    assert.deepEqual(contarEnvioDoLote([]), { naFila: 0, duplicados: 0, falhas: 0 });
  });
});
