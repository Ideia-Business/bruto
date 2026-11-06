/**
 * Testes de `extension/src/lib/ligar-app-textos.ts`.
 *
 * Os textos foram aprovados pelo dono palavra por palavra (grelha de
 * 06/11/2026) — se um destes testes falhar, quem mexeu no texto ou no
 * mapeamento é que precisa se explicar, não o teste.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import type { ResultadoLigar } from "../../extension/src/lib/host-nativo";
import {
  TEXTO_ABRIR_O_APP,
  TEXTO_BOTAO_LIGAR,
  TEXTO_DEMORA,
  TEXTO_ERRO,
  TEXTO_FALHA_AO_LIGAR,
  TEXTO_HOST_AUSENTE,
  TEXTO_LIGANDO,
  TEXTO_PERMISSAO_NEGADA,
  TEXTO_PRONTO,
  mensagemDoLigar,
} from "../../extension/src/lib/ligar-app-textos";

describe("textos exatos, aprovados pelo dono", () => {
  test("TEXTO_BOTAO_LIGAR", () => {
    assert.equal(TEXTO_BOTAO_LIGAR, "Ligar o app");
  });

  test("TEXTO_LIGANDO", () => {
    assert.equal(TEXTO_LIGANDO, "Ligando o app… na primeira vez pode levar alguns minutos.");
  });

  test("TEXTO_PRONTO", () => {
    assert.equal(TEXTO_PRONTO, "Pronto: o app está ligado.");
  });

  test("TEXTO_DEMORA", () => {
    assert.equal(TEXTO_DEMORA, "Ainda iniciando. Reabra a extensão em 1 minuto.");
  });

  test("TEXTO_PERMISSAO_NEGADA", () => {
    assert.equal(
      TEXTO_PERMISSAO_NEGADA,
      "Sem essa permissão a extensão não consegue ligar o app. Abra o app pelo ícone e clique de novo.",
    );
  });

  test("TEXTO_HOST_AUSENTE", () => {
    assert.equal(
      TEXTO_HOST_AUSENTE,
      "A extensão ainda não está ligada ao app neste computador. Rode o instalador do Bruto de novo e tente outra vez.",
    );
  });

  test("TEXTO_FALHA_AO_LIGAR", () => {
    assert.equal(
      TEXTO_FALHA_AO_LIGAR,
      "O app não subiu. Detalhes no arquivo bruto-server.log, na pasta temporária do sistema.",
    );
  });

  test("TEXTO_ERRO", () => {
    assert.equal(TEXTO_ERRO, "Algo travou ao ligar o app.");
  });

  test("TEXTO_ABRIR_O_APP", () => {
    assert.equal(TEXTO_ABRIR_O_APP, "Abrir o app");
  });
});

describe("mensagemDoLigar — resultado → mensagem", () => {
  test("pronto → ok, ligado", () => {
    const r: ResultadoLigar = { resultado: "pronto", iniciado: true };
    assert.deepEqual(mensagemDoLigar(r), { tipo: "ok", texto: TEXTO_PRONTO, ligado: true });
  });

  test("pronto sem ter iniciado continua pronto", () => {
    // O app já estava de pé antes do clique — para a tela é o mesmo "pronto".
    const r: ResultadoLigar = { resultado: "pronto", iniciado: false };
    assert.deepEqual(mensagemDoLigar(r), { tipo: "ok", texto: TEXTO_PRONTO, ligado: true });
  });

  test("demora → atenção, não ligado", () => {
    const r: ResultadoLigar = { resultado: "demora" };
    assert.deepEqual(mensagemDoLigar(r), { tipo: "atencao", texto: TEXTO_DEMORA, ligado: false });
  });

  test("permissao-negada → atenção, não ligado", () => {
    const r: ResultadoLigar = { resultado: "permissao-negada" };
    assert.deepEqual(mensagemDoLigar(r), {
      tipo: "atencao",
      texto: TEXTO_PERMISSAO_NEGADA,
      ligado: false,
    });
  });

  test("host-ausente → ruim, não ligado", () => {
    const r: ResultadoLigar = { resultado: "host-ausente" };
    assert.deepEqual(mensagemDoLigar(r), { tipo: "ruim", texto: TEXTO_HOST_AUSENTE, ligado: false });
  });

  test("falha-ao-ligar → ruim, não ligado", () => {
    const r: ResultadoLigar = { resultado: "falha-ao-ligar" };
    assert.deepEqual(mensagemDoLigar(r), {
      tipo: "ruim",
      texto: TEXTO_FALHA_AO_LIGAR,
      ligado: false,
    });
  });

  test("erro → ruim, não ligado", () => {
    const r: ResultadoLigar = { resultado: "erro" };
    assert.deepEqual(mensagemDoLigar(r), { tipo: "ruim", texto: TEXTO_ERRO, ligado: false });
  });

  test("ligado só é true em pronto", () => {
    const todos: ResultadoLigar[] = [
      { resultado: "pronto", iniciado: true },
      { resultado: "demora" },
      { resultado: "permissao-negada" },
      { resultado: "host-ausente" },
      { resultado: "falha-ao-ligar" },
      { resultado: "erro" },
    ];
    for (const r of todos) {
      assert.equal(mensagemDoLigar(r).ligado, r.resultado === "pronto");
    }
  });
});
