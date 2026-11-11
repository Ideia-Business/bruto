/**
 * Aviso de versão nova (modo pacote): consulta a API de releases do GitHub no
 * máximo uma vez por dia (cache em `$BRUTO_DATA_ROOT`), compara com a versão
 * do app e devolve a novidade — ou silêncio.
 *
 * SEM REDE nos testes: o `fetch` é injetado. Falha de rede, JSON quebrado ou
 * release velha NUNCA viram erro — devolvem "sem novidade".
 */
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { verificarAtualizacao } from "@/pipeline/lib/atualizacao";

let dataRoot: string;
let salvaEmpacotado: string | undefined;
let salvaDataRoot: string | undefined;

before(() => {
  dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bruto-atualizacao-"));
  salvaEmpacotado = process.env.BRUTO_EMPACOTADO;
  salvaDataRoot = process.env.BRUTO_DATA_ROOT;
  process.env.BRUTO_EMPACOTADO = "1";
  process.env.BRUTO_DATA_ROOT = dataRoot;
});

after(() => {
  if (salvaEmpacotado === undefined) delete process.env.BRUTO_EMPACOTADO;
  else process.env.BRUTO_EMPACOTADO = salvaEmpacotado;
  if (salvaDataRoot === undefined) delete process.env.BRUTO_DATA_ROOT;
  else process.env.BRUTO_DATA_ROOT = salvaDataRoot;
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

beforeEach(() => {
  fs.rmSync(path.join(dataRoot, "verificacao-versao.json"), { force: true });
});

function fetchQueDevolve(corpo: unknown, status = 200) {
  const chamadas: string[] = [];
  const fetchFn = async (url: string | URL) => {
    chamadas.push(String(url));
    return new Response(typeof corpo === "string" ? corpo : JSON.stringify(corpo), { status });
  };
  return { fetchFn, chamadas };
}

describe("verificarAtualizacao — modo pacote", () => {
  test("release mais nova: devolve versão e link", async () => {
    const { fetchFn } = fetchQueDevolve({
      tag_name: "v9.9.9",
      html_url: "https://github.com/Ideia-Business/bruto/releases/tag/v9.9.9",
    });
    const r = await verificarAtualizacao({ fetchFn, versaoAtual: "0.2.0" });
    assert.equal(r.nova, "9.9.9");
    assert.equal(r.url, "https://github.com/Ideia-Business/bruto/releases/tag/v9.9.9");
  });

  test("release igual ou mais velha: silêncio", async () => {
    const { fetchFn } = fetchQueDevolve({ tag_name: "v0.2.0", html_url: "https://x" });
    const r = await verificarAtualizacao({ fetchFn, versaoAtual: "0.2.0" });
    assert.deepEqual(r, { nova: null, url: null });

    const maisVelha = fetchQueDevolve({ tag_name: "v0.1.0", html_url: "https://x" });
    const r2 = await verificarAtualizacao({ fetchFn: maisVelha.fetchFn, versaoAtual: "0.2.0" });
    assert.deepEqual(r2, { nova: null, url: null });
  });

  test("consulta no máximo uma vez por dia: a segunda chamada usa o cache", async () => {
    const { fetchFn, chamadas } = fetchQueDevolve({ tag_name: "v9.9.9", html_url: "https://x" });
    await verificarAtualizacao({ fetchFn, versaoAtual: "0.2.0" });
    const r = await verificarAtualizacao({ fetchFn, versaoAtual: "0.2.0" });
    assert.equal(chamadas.length, 1, "a segunda verificação no mesmo dia não pode ir à rede");
    assert.equal(r.nova, "9.9.9");
  });

  test("cache com mais de um dia: consulta de novo", async () => {
    fs.writeFileSync(
      path.join(dataRoot, "verificacao-versao.json"),
      JSON.stringify({ em: Date.now() - 25 * 60 * 60 * 1000, tag: "v9.9.9", url: "https://velha" }),
    );
    const { fetchFn, chamadas } = fetchQueDevolve({ tag_name: "v10.0.0", html_url: "https://nova" });
    const r = await verificarAtualizacao({ fetchFn, versaoAtual: "0.2.0" });
    assert.equal(chamadas.length, 1);
    assert.equal(r.nova, "10.0.0");
  });

  test("sem rede: silêncio, nunca erro", async () => {
    const fetchFn = async () => {
      throw new Error("ENOTFOUND");
    };
    const r = await verificarAtualizacao({ fetchFn, versaoAtual: "0.2.0" });
    assert.deepEqual(r, { nova: null, url: null });
  });

  test("resposta quebrada (não-JSON, sem tag): silêncio", async () => {
    const texto = fetchQueDevolve("<html>rate limited</html>");
    const r = await verificarAtualizacao({ fetchFn: texto.fetchFn, versaoAtual: "0.2.0" });
    assert.deepEqual(r, { nova: null, url: null });

    const semTag = fetchQueDevolve({ message: "Not Found" });
    const r2 = await verificarAtualizacao({ fetchFn: semTag.fetchFn, versaoAtual: "0.2.0" });
    assert.deepEqual(r2, { nova: null, url: null });
  });
});

describe("verificarAtualizacao — modo clone (controle F2)", () => {
  test("não consulta nada, devolve silêncio", async () => {
    delete process.env.BRUTO_EMPACOTADO;
    try {
      const { fetchFn, chamadas } = fetchQueDevolve({ tag_name: "v9.9.9", html_url: "https://x" });
      const r = await verificarAtualizacao({ fetchFn, versaoAtual: "0.2.0" });
      assert.deepEqual(r, { nova: null, url: null });
      assert.equal(chamadas.length, 0);
    } finally {
      process.env.BRUTO_EMPACOTADO = "1";
    }
  });
});
