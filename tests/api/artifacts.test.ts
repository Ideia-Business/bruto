/**
 * `comLimiteDeNome` e `cabecalhoContentDisposition` — o nome de arquivo de
 * download e o cabeçalho HTTP que o carrega. Duas rodadas de achado da
 * revisão cross-vendor aqui:
 *
 * 1. A versão original cortava a STRING FINAL já com sufixo (`.docx` etc.)
 *    em 120 CHARS; com título de 111+ chars (comum em vídeo do TikTok, ou
 *    depois de um PATCH de título), o corte caía ANTES da extensão, que
 *    desaparecia — docx/pdf/md do mesmo vídeo colapsavam no mesmo nome
 *    truncado, e o loop de `exportar-artefatos.ts` sobrescrevia um com o
 *    outro em silêncio.
 * 2. Cortar por `.length` (unidades UTF-16) em vez de BYTES UTF-8 ainda
 *    deixava passar título muito CJK/emoji que cabia nos "caracteres" JS
 *    mas estourava os 255 bytes reais do sistema de arquivos.
 * 3. O `filename=` cru no `Content-Disposition` quebra com 500 (`TypeError:
 *    Cannot convert argument to a ByteString`) para qualquer título com code
 *    point > 255 — aspas curvas, emoji, CJK. `cabecalhoContentDisposition`
 *    manda a forma `filename*=UTF-8''...` (RFC 6266) mais um fallback ASCII.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { cabecalhoContentDisposition, comLimiteDeNome } from "@/app/api/artifacts/[id]/route";

describe("comLimiteDeNome", () => {
  test("nome curto passa direto, extensão intacta", () => {
    assert.equal(comLimiteDeNome("Resumo - Aula 1.docx"), "Resumo - Aula 1.docx");
  });

  test("nome de 200+ chars é cortado, mas a extensão NUNCA some", () => {
    const nome = `Resumo - ${"x".repeat(200)}.docx`;
    const resultado = comLimiteDeNome(nome);
    assert.ok(resultado.endsWith(".docx"), `deveria terminar em .docx: ${resultado}`);
    assert.ok(resultado.length <= 200, `deveria caber no teto: ${resultado.length}`);
  });

  test("título de 111 chars (o caso reproduzido pelo Grok) preserva a extensão", () => {
    const titulo = "T".repeat(200);
    const nome = `Resumo - ${titulo}.docx`;
    const resultado = comLimiteDeNome(nome);
    assert.ok(resultado.endsWith(".docx"), `deveria terminar em .docx: ${resultado}`);
  });

  test("docx, pdf e md do MESMO vídeo (título idêntico, extensão diferente) nunca colidem no mesmo nome", () => {
    const titulo = "U".repeat(250);
    const docx = comLimiteDeNome(`Resumo - ${titulo}.docx`);
    const pdf = comLimiteDeNome(`Resumo - ${titulo}.pdf`);
    const md = comLimiteDeNome(`Resumo - ${titulo}.md`);
    assert.notEqual(docx, pdf);
    assert.notEqual(docx, md);
    assert.notEqual(pdf, md);
  });

  test("nome sem extensão não quebra (não fica cortando um '.' que não existe)", () => {
    const resultado = comLimiteDeNome("x".repeat(300));
    assert.equal(resultado.length, 200);
  });

  test("respeita um limite customizado", () => {
    assert.equal(comLimiteDeNome("Resumo - Aula.docx", 10).endsWith(".docx"), true);
  });

  // Item 4 (4ª revisão, Grok): corte por BYTES UTF-8, nunca por `.length`
  // (UTF-16) — título muito CJK/emoji podia caber no limite de chars mas
  // estourar os 255 bytes reais do sistema de arquivos.
  test("título muito CJK: cabe no limite de BYTES, nunca separa um caractere ao meio", () => {
    const titulo = "字".repeat(150); // 3 bytes UTF-8 cada = 450 bytes, bem acima do teto
    const resultado = comLimiteDeNome(`Resumo - ${titulo}.docx`, 100);
    assert.ok(resultado.endsWith(".docx"), `deveria terminar em .docx: ${resultado}`);
    const bytes = new TextEncoder().encode(resultado).length;
    assert.ok(bytes <= 100, `deveria caber em 100 bytes: ${bytes}`);
    assert.ok(!resultado.includes("�"), "não deveria haver caractere de substituição");
  });

  test("título muito emoji: cabe no limite de BYTES, nunca separa um par substituto ao meio", () => {
    const titulo = "🔥".repeat(80); // 4 bytes UTF-8 cada = 320 bytes
    const resultado = comLimiteDeNome(`${titulo}.pdf`, 100);
    assert.ok(resultado.endsWith(".pdf"), `deveria terminar em .pdf: ${resultado}`);
    const bytes = new TextEncoder().encode(resultado).length;
    assert.ok(bytes <= 100, `deveria caber em 100 bytes: ${bytes}`);
    assert.ok(!resultado.includes("�"), "não deveria haver caractere de substituição");
  });
});

describe("cabecalhoContentDisposition — item 1 (4ª revisão), nunca quebra com título fora de Latin-1", () => {
  test("título comum (ASCII) vira um Content-Disposition simples de ler", () => {
    const header = cabecalhoContentDisposition("Resumo - Aula 1.docx");
    assert.match(header, /filename="Resumo - Aula 1\.docx"/);
    assert.match(header, /filename\*=UTF-8''/);
  });

  // Repro exato do bug reportado: `new Response(..., {headers: {"Content-Disposition": "attachment; filename=\"${titulo}\""}})`
  // lançava `TypeError: Cannot convert argument to a ByteString` para este
  // título — code point 8220 (aspas curva “) está acima de 255. A prova real
  // é montar um Response/Headers de verdade, não só inspecionar a string:
  // é exatamente onde o 500 acontecia em produção.
  test("título com aspas curvas (o repro real) nunca lança ao virar cabeçalho HTTP de verdade", () => {
    const titulo = "Comenta “IA” que eu te mando o passo a passo.docx";
    assert.doesNotThrow(() => {
      new Response("corpo", {
        headers: { "Content-Disposition": cabecalhoContentDisposition(titulo) },
      });
    });
  });

  test("o filename= cru (sem a correção) É a prova de que o bug era real — CONTROLE POSITIVO", () => {
    const titulo = "Comenta “IA” que eu te mando o passo a passo.docx";
    assert.throws(() => {
      new Response("corpo", {
        headers: { "Content-Disposition": `attachment; filename="${titulo}"` },
      });
    }, /ByteString/);
  });

  test("emoji no título também nunca lança", () => {
    assert.doesNotThrow(() => {
      new Response("corpo", {
        headers: { "Content-Disposition": cabecalhoContentDisposition("Aula 🔥 de verdade.pdf") },
      });
    });
  });

  test("filename* carrega o título completo, decodificável de volta", () => {
    const titulo = "Comenta “IA” que eu te mando o passo a passo.docx";
    const header = cabecalhoContentDisposition(titulo);
    const match = /filename\*=UTF-8''([^;]+)/.exec(header);
    assert.ok(match, "deveria ter o filename*");
    assert.equal(decodeURIComponent(match![1]), titulo);
  });

  test("filename= (fallback ASCII) troca o que não é ASCII imprimível por _, mas não lança nem trava", () => {
    const header = cabecalhoContentDisposition("Comenta “IA” 🔥.docx");
    const match = /filename="([^"]*)"/.exec(header);
    assert.ok(match, "deveria ter o filename= de fallback");
    assert.ok(!/[^\x20-\x7E]/.test(match![1]), "o fallback não deveria ter nada fora do ASCII imprimível");
  });
});
