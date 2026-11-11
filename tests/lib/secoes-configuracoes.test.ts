/**
 * Decisão "quais seções a tela de Configurações mostra", isolada numa função
 * pura (achado P2 da 1ª rodada de revisão): no Safari/Firefox,
 * `suportaPastaLocal()` é falso e o `return` precoce do componente escondia a
 * tela INTEIRA — inclusive a seção do Whisper, cuja instalação roda no
 * SERVIDOR e não precisa da API de pasta do navegador.
 *
 * Contrato: a falta de capacidade de UMA seção nunca esconde OUTRA. O ramo
 * "navegador sem API de pasta" fica restrito à exportação; o Whisper aparece
 * de forma independente.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { secoesDasConfiguracoes } from "@/lib/secoes-configuracoes";

describe("secoesDasConfiguracoes", () => {
  test("navegador sem API de pasta + pacote: exportação vira aviso, Whisper VISÍVEL", () => {
    const secoes = secoesDasConfiguracoes({
      suportaPasta: false,
      whisper: { suportado: true, instalado: false },
    });
    assert.equal(secoes.exportacao, "aviso-navegador");
    assert.equal(secoes.whisper, true);
  });

  test("navegador com API de pasta + pacote: as duas seções", () => {
    const secoes = secoesDasConfiguracoes({
      suportaPasta: true,
      whisper: { suportado: true, instalado: false },
    });
    assert.equal(secoes.exportacao, "completa");
    assert.equal(secoes.whisper, true);
  });

  test("sem seção de Whisper no clone (estado null), exportação normal", () => {
    const secoes = secoesDasConfiguracoes({ suportaPasta: true, whisper: null });
    assert.equal(secoes.exportacao, "completa");
    assert.equal(secoes.whisper, false);
  });

  test("pacote sem suporte a Whisper: sem a seção, mas o aviso de navegador não muda", () => {
    const secoes = secoesDasConfiguracoes({
      suportaPasta: false,
      whisper: { suportado: false, instalado: false },
    });
    assert.equal(secoes.exportacao, "aviso-navegador");
    assert.equal(secoes.whisper, false);
  });
});
