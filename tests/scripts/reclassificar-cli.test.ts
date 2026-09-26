/**
 * `npm run reclassificar` — o reprocessamento retroativo do passo 05, rodando
 * SEQUENCIAL sobre uma amostra pequena de um banco de teste (nunca contra a
 * biblioteca de verdade). Mesmo padrão de `tests/db/migrate.test.ts`: exercita
 * o CAMINHO REAL (o script publicado, via subprocesso), não uma reimplementação.
 *
 * `BRUTO_LLM_PROVIDER` aponta para um provedor que não existe — a chamada à IA
 * falha de forma síncrona e determinística (LLM_NOT_CONFIGURED), sem rede e sem
 * depender de haver `claude`/`codex` autenticados nesta máquina. Isso também
 * prova o best-effort do passo 05: sem IA disponível, o vídeo cai em "outros"
 * em vez de derrubar o lote — exatamente o que a classificação sempre fez.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const RAIZ = process.cwd();

const COM_ARTEFATO = { id: "COMARTEFATO01", title: "Vídeo com transcrição e resumo" };
const SEM_ARTEFATO = { id: "SEMARTEFATO01", title: "Vídeo sem transcrição nem resumo" };

let dataRoot: string;
let dbPath: string;

function rodar(args: string[] = []): string {
  return execFileSync("npm", ["run", "reclassificar", "--", ...args], {
    cwd: RAIZ,
    env: {
      ...process.env,
      BRUTO_DATA_ROOT: dataRoot,
      BRUTO_LLM_PROVIDER: "provedor-inexistente-para-teste",
    },
    encoding: "utf8",
  });
}

describe("npm run reclassificar — reprocessamento retroativo sequencial", () => {
  before(() => {
    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bruto-reclassificar-"));
    dbPath = path.join(dataRoot, "bruto.db");

    execFileSync("npm", ["run", "db:migrate"], {
      cwd: RAIZ,
      env: { ...process.env, BRUTO_DATA_ROOT: dataRoot },
      stdio: "pipe",
    });
    execFileSync("npm", ["run", "db:seed"], {
      cwd: RAIZ,
      env: { ...process.env, BRUTO_DATA_ROOT: dataRoot },
      stdio: "pipe",
    });

    const sqlite = new Database(dbPath);
    const now = Math.floor(Date.now() / 1000);
    for (const v of [COM_ARTEFATO, SEM_ARTEFATO]) {
      sqlite
        .prepare(
          "INSERT INTO brutos (id, url, platform, title, created_at) VALUES (?, ?, 'youtube', ?, ?)",
        )
        .run(v.id, `https://exemplo.test/${v.id}`, v.title, now);
    }
    sqlite.close();

    // Só o COM_ARTEFATO ganha transcript.txt + summary.md em disco — é o que
    // separa "reclassificável" de "pulado" no script.
    const dir = path.join(dataRoot, "library", COM_ARTEFATO.id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "transcript.txt"), "Transcrição de teste, sem conteúdo real.");
    fs.writeFileSync(path.join(dir, "summary.md"), "## Visão Geral\nResumo de teste.");
  });

  after(() => {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });

  test("termina com sucesso (best-effort: sem IA disponível, cai em 'outros' em vez de falhar o lote)", () => {
    const saida = rodar();
    assert.match(saida, /Reclassificando 2 bruto\(s\)/);
  });

  test("o vídeo COM artefato foi classificado (não pulado)", () => {
    const saida = rodar();
    assert.match(saida, new RegExp(`✔ ${COM_ARTEFATO.title} → outros`));
  });

  test("o vídeo SEM artefato foi pulado, não classificado", () => {
    const saida = rodar();
    assert.match(saida, new RegExp(`⏭ {2}${SEM_ARTEFATO.title} — sem transcrição/resumo em disco, pulado`));
    assert.doesNotMatch(saida, new RegExp(`✔ ${SEM_ARTEFATO.title}`));
  });

  test("resumo final reporta 1 reclassificado e 1 pulado", () => {
    const saida = rodar();
    assert.match(saida, /Concluído: 1 reclassificado\(s\), 1 pulado\(s\) \(sem artefato\), 0 com erro\./);
  });

  test("o banco reflete o resultado: só o vídeo com artefato ganhou category_id", () => {
    rodar();
    const sqlite = new Database(dbPath, { readonly: true });
    const linhas = sqlite
      .prepare("SELECT id, category_id FROM brutos ORDER BY id")
      .all() as { id: string; category_id: number | null }[];
    sqlite.close();

    const comArtefato = linhas.find((l) => l.id === COM_ARTEFATO.id);
    const semArtefato = linhas.find((l) => l.id === SEM_ARTEFATO.id);
    assert.ok(comArtefato?.category_id != null, "o vídeo com artefato deveria ter ganhado uma categoria");
    assert.equal(semArtefato?.category_id, null, "o vídeo pulado não deveria ter sido tocado");
  });

  test("filtrar por um único id processa só aquele vídeo", () => {
    const saida = rodar([SEM_ARTEFATO.id]);
    assert.match(saida, /Reclassificando 1 bruto\(s\)/);
    assert.match(saida, new RegExp(`⏭ {2}${SEM_ARTEFATO.title}`));
    assert.doesNotMatch(saida, new RegExp(COM_ARTEFATO.title));
  });
});
