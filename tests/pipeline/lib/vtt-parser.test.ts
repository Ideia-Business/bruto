/**
 * Testes de `parseVtt` — cobrem os dois formatos reais que o YouTube entrega
 * (documentados no topo do arquivo-fonte): legenda manual limpa, e auto-caption
 * "rolling" que repete a última linha do cue anterior.
 *
 * O caso do dedupe é o que mais vale: sem ele, o texto extraído de qualquer
 * vídeo do YouTube sairia com cada frase duplicada, e ninguém notaria olhando
 * só o começo da transcrição.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseVtt } from "@/pipeline/lib/vtt-parser";

describe("parseVtt — parse básico (legenda manual, sem rolling)", () => {
  test("extrai texto e timestamp de cues simples", () => {
    const vtt = `WEBVTT

00:00:00.000 --> 00:00:02.000
Olá, bem-vindos ao vídeo.

00:00:02.500 --> 00:00:04.000
Hoje vamos falar sobre testes.
`;
    const { text, timestampedText } = parseVtt(vtt);
    assert.equal(text, "Olá, bem-vindos ao vídeo. Hoje vamos falar sobre testes.");
    assert.equal(
      timestampedText,
      "[00:00:00] Olá, bem-vindos ao vídeo.\n[00:00:02] Hoje vamos falar sobre testes.",
    );
  });

  test("ignora blocos NOTE/STYLE/REGION", () => {
    // Esses blocos não são conteúdo falado — se vazassem para o texto, a
    // transcrição ficaria poluída com CSS/comentários do arquivo VTT.
    const vtt = `WEBVTT

NOTE
Isto é um comentário que não deve aparecer.

STYLE
::cue { color: yellow; }

00:00:00.000 --> 00:00:01.000
Texto real do vídeo.
`;
    const { text } = parseVtt(vtt);
    assert.equal(text, "Texto real do vídeo.");
  });

  test("decodifica entidades HTML e remove tags inline", () => {
    const vtt = `WEBVTT

00:00:00.000 --> 00:00:01.000
<c>Isto</c> tem &amp; comercial &lt;e&gt; tags.
`;
    const { text } = parseVtt(vtt);
    assert.equal(text, "Isto tem & comercial <e> tags.");
  });

  test("multi-linha dentro de um único cue vira um parágrafo com espaço", () => {
    const vtt = `WEBVTT

00:00:00.000 --> 00:00:03.000
primeira linha
segunda linha
`;
    const { text } = parseVtt(vtt);
    assert.equal(text, "primeira linha segunda linha");
  });

  test("VTT vazio (só cabeçalho) devolve texto vazio sem lançar", () => {
    const { text, timestampedText } = parseVtt("WEBVTT\n");
    assert.equal(text, "");
    assert.equal(timestampedText, "");
  });
});

describe("parseVtt — dedupe rolling (auto-caption do YouTube)", () => {
  test("remove a linha repetida do cue anterior e mantém só o conteúdo novo", () => {
    // Formato real de auto-caption: cada cue repete a última linha do cue
    // anterior. Sem o dedupe, "linha um" apareceria duas vezes no texto final.
    const vtt = `WEBVTT

00:00:00.000 --> 00:00:02.000 align:start position:0%
linha um

00:00:02.000 --> 00:00:04.000 align:start position:0%
linha um
linha dois

00:00:04.000 --> 00:00:06.000 align:start position:0%
linha dois
linha três
`;
    const { text } = parseVtt(vtt);
    assert.equal(text, "linha um linha dois linha três");
  });

  test("dedupe respeita timing tags por palavra (<00:00:01.319><c> palavra</c>)", () => {
    const vtt = `WEBVTT

00:00:00.000 --> 00:00:02.000 align:start position:0%
Bem-vindos<00:00:01.000><c> ao</c><00:00:01.500><c> vídeo</c>

00:00:02.000 --> 00:00:04.000 align:start position:0%
Bem-vindos ao vídeo
de testes<00:00:03.500><c> hoje</c>
`;
    const { text } = parseVtt(vtt);
    // A 1ª linha do 2º cue, depois de limpa, é igual à última linha emitida
    // pelo 1º cue ("Bem-vindos ao vídeo") — deve ser descartada pelo dedupe.
    assert.equal(text, "Bem-vindos ao vídeo de testes hoje");
  });

  test("legenda manual (sem repetição) não perde nenhuma linha por engano", () => {
    // Garante que o dedupe NÃO é agressivo demais: duas linhas diferentes que
    // por coincidência têm conteúdo parecido não podem ser descartadas.
    const vtt = `WEBVTT

00:00:00.000 --> 00:00:01.000
frase A

00:00:01.000 --> 00:00:02.000
frase B

00:00:02.000 --> 00:00:03.000
frase A
`;
    const { text } = parseVtt(vtt);
    // "frase A" reaparece depois de "frase B" no meio — dedupe é só de 1 linha
    // de memória (a última emitida), então a repetição não-consecutiva deve
    // ser mantida.
    assert.equal(text, "frase A frase B frase A");
  });
});

describe("parseVtt — parágrafos e timestamps", () => {
  test("quebra parágrafo quando o silêncio entre cues excede o gap", () => {
    const vtt = `WEBVTT

00:00:00.000 --> 00:00:01.000
primeiro bloco

00:00:10.000 --> 00:00:11.000
segundo bloco depois de silêncio longo
`;
    const { text } = parseVtt(vtt);
    assert.equal(text, "primeiro bloco\n\nsegundo bloco depois de silêncio longo");
  });

  test("timestampedText usa o início de CADA cue, não do parágrafo", () => {
    const vtt = `WEBVTT

00:01:05.250 --> 00:01:07.000
um cue com hora, minuto e segundo
`;
    const { timestampedText } = parseVtt(vtt);
    assert.equal(timestampedText, "[00:01:05] um cue com hora, minuto e segundo");
  });

  test("aceita timing com vírgula decimal (variante SRT-like)", () => {
    const vtt = `WEBVTT

00:00:00,000 --> 00:00:01,000
formato com vírgula
`;
    const { text } = parseVtt(vtt);
    assert.equal(text, "formato com vírgula");
  });
});
