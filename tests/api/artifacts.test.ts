/**
 * `comLimiteDeNome` — o corte de nome de arquivo de download preservando a
 * extensão. Achado da revisão cross-vendor (Codex + Grok, confirmado nos
 * dois): a versão antiga cortava a STRING FINAL já com sufixo (`.docx` etc.)
 * em 120 chars; com título de 111+ chars (comum em vídeo do TikTok, ou depois
 * de um PATCH de título), o corte caía ANTES da extensão, que desaparecia —
 * docx/pdf/md do mesmo vídeo colapsavam no mesmo nome truncado, e o loop de
 * `exportar-artefatos.ts` sobrescrevia um com o outro em silêncio.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { comLimiteDeNome } from "@/app/api/artifacts/[id]/route";

describe("comLimiteDeNome", () => {
  test("nome curto passa direto, extensão intacta", () => {
    assert.equal(comLimiteDeNome("Resumo - Aula 1.docx"), "Resumo - Aula 1.docx");
  });

  test("nome de 200+ chars é cortado, mas a extensão NUNCA some", () => {
    const nome = `Resumo - ${"x".repeat(200)}.docx`;
    const resultado = comLimiteDeNome(nome);
    assert.ok(resultado.endsWith(".docx"), `deveria terminar em .docx: ${resultado}`);
    assert.ok(resultado.length <= 120, `deveria caber no teto: ${resultado.length}`);
  });

  test("título de 111 chars (o caso reproduzido pelo Grok) preserva a extensão", () => {
    const titulo = "T".repeat(111);
    const nome = `Resumo - ${titulo}.docx`; // 9 + 111 + 5 = 125, acima do teto de 120
    const resultado = comLimiteDeNome(nome);
    assert.ok(resultado.endsWith(".docx"), `deveria terminar em .docx: ${resultado}`);
  });

  test("docx, pdf e md do MESMO vídeo (título idêntico, extensão diferente) nunca colidem no mesmo nome", () => {
    const titulo = "U".repeat(150);
    const docx = comLimiteDeNome(`Resumo - ${titulo}.docx`);
    const pdf = comLimiteDeNome(`Resumo - ${titulo}.pdf`);
    const md = comLimiteDeNome(`Resumo - ${titulo}.md`);
    assert.notEqual(docx, pdf);
    assert.notEqual(docx, md);
    assert.notEqual(pdf, md);
  });

  test("nome sem extensão não quebra (não fica cortando um '.' que não existe)", () => {
    const resultado = comLimiteDeNome("x".repeat(200));
    assert.equal(resultado.length, 120);
  });

  test("respeita um limite customizado", () => {
    assert.equal(comLimiteDeNome("Resumo - Aula.docx", 10).endsWith(".docx"), true);
  });
});
