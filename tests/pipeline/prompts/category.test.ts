/**
 * `conteudoParaClassificacao` — a versão anterior deste prompt cortava a
 * transcrição em 1500 caracteres (`transcriptStart.slice(0, 1500)`), então um
 * vídeo longo era classificado só pelos primeiros minutos. Este teste prova
 * que a versão nova NÃO corta: um marcador colocado bem depois do caractere
 * 1500 precisa sobreviver inteiro no texto que vai para a IA.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { categoryPrompt, conteudoParaClassificacao, parseCategorySlug } from "@/pipeline/prompts/category";

describe("conteudoParaClassificacao — sem corte em 1500 caracteres", () => {
  test("um marcador depois do caractere 1500 sobrevive inteiro", () => {
    const recheio = "x".repeat(3000);
    const marcador = "MARCADOR-DEPOIS-DE-1500";
    const transcript = `${recheio}${marcador}${recheio}`;
    const resultado = conteudoParaClassificacao("resumo curto", transcript);

    assert.ok(
      resultado.includes(marcador),
      "o marcador, colocado bem depois do caractere 1500, deveria estar íntegro no texto",
    );
    assert.ok(
      resultado.length > 1500,
      "o texto final deveria ser maior que o corte antigo de 1500 caracteres",
    );
  });

  test("inclui o resumo E a transcrição completa, nas duas seções", () => {
    const resultado = conteudoParaClassificacao("## resumo aqui", "transcrição aqui");
    assert.ok(resultado.includes("resumo aqui"));
    assert.ok(resultado.includes("transcrição aqui"));
  });
});

describe("categoryPrompt", () => {
  test("lista as 9 categorias e os dados do vídeo, sem embutir transcrição", () => {
    const prompt = categoryPrompt({ title: "Título X", channel: "Canal Y", tags: ["a", "b"] });
    assert.ok(prompt.includes("tecnologia"));
    assert.ok(prompt.includes("outros"));
    assert.ok(prompt.includes("Título X"));
    assert.ok(prompt.includes("Canal Y"));
  });

  test("canal ausente vira 'desconhecido'", () => {
    const prompt = categoryPrompt({ title: "T", channel: null, tags: [] });
    assert.ok(prompt.includes("desconhecido"));
  });
});

describe("parseCategorySlug", () => {
  test("aceita um slug válido, mesmo com espaço/maiúscula ao redor", () => {
    assert.equal(parseCategorySlug("  Tecnologia  "), "tecnologia");
  });

  test("tolera aspas/crase/ponto final envolvendo o slug", () => {
    assert.equal(parseCategorySlug('"tecnologia"'), "tecnologia");
    assert.equal(parseCategorySlug("`tecnologia`"), "tecnologia");
    assert.equal(parseCategorySlug("tecnologia."), "tecnologia");
  });

  test("'outros' só quando a IA respondeu exatamente 'outros'", () => {
    assert.equal(parseCategorySlug("outros"), "outros");
  });

  /**
   * REGRESSÃO (achado do Grok na revisão cross-vendor): a versão anterior
   * removia todo caractere fora de `a-z-` da resposta INTEIRA antes de
   * comparar — "Categoria: tecnologia" virava "categoriatecnologia", não
   * batia com nada, e caía em "outros" por adivinhação. Depois da correção do
   * item 1 desta lane (falha de chamada não sobrescreve categoria), esse
   * "outros" por engano passou a se comportar como classificação de VERDADE e
   * sobrescrevia a categoria correta que o vídeo já tinha. Agora qualquer
   * resposta com texto ao redor do slug é FALHA DE PARSING (null), nunca
   * "outros" por adivinhação.
   */
  test("REGRESSÃO: preâmbulo/sufixo em torno do slug vira falha de parsing (null), nunca 'outros'", () => {
    assert.equal(parseCategorySlug("Categoria: tecnologia"), null);
    assert.equal(parseCategorySlug("A categoria é tecnologia."), null);
    assert.equal(parseCategorySlug("tecnologia\n\nEste vídeo fala sobre..."), null);
  });

  test("resposta que não bate com nenhum slug válido vira falha de parsing (null)", () => {
    assert.equal(parseCategorySlug("categoria-inventada"), null);
    assert.equal(parseCategorySlug(""), null);
  });
});
