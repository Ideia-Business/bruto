/**
 * INVARIANTE F4 — o boot empacotado nunca sobe sem schema.
 *
 * Em modo pacote, `register()` (instrumentation) aplica as migrações e o seed
 * ANTES de re-enfileirar órfãos: se a migração falha, o boot FALHA (rejeita)
 * com mensagem clara — nunca um servidor de pé sem tabelas.
 *
 * Montagem: `BRUTO_DATA_ROOT` temporário e vazio; depois do boot, o banco tem
 * de existir com as tabelas do schema, o journal do Drizzle e as 9 categorias
 * do seed. O `cwd` é o do projeto (a pasta `drizzle/` é relativa a ele, como
 * no pacote, onde cwd = `app/` e a pasta viaja junto).
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

let raiz: string;
let dataRoot: string;

let salvas: Record<string, string | undefined>;
const VARS = ["BRUTO_EMPACOTADO", "BRUTO_DATA_ROOT", "NEXT_RUNTIME"] as const;

let register: typeof import("@/instrumentation").register;

before(async () => {
  raiz = fs.mkdtempSync(path.join(os.tmpdir(), "bruto-boot-pacote-"));
  dataRoot = path.join(raiz, "dados");

  salvas = {};
  for (const v of VARS) salvas[v] = process.env[v];

  process.env.BRUTO_EMPACOTADO = "1";
  process.env.BRUTO_DATA_ROOT = dataRoot;
  process.env.NEXT_RUNTIME = "nodejs";

  ({ register } = await import("@/instrumentation"));
});

after(() => {
  for (const v of VARS) {
    if (salvas[v] === undefined) delete process.env[v];
    else process.env[v] = salvas[v]!;
  }
  fs.rmSync(raiz, { recursive: true, force: true });
});

describe("boot em modo pacote (F4)", () => {
  test("register() aplica migrações e seed antes de qualquer job", async () => {
    await register();

    const dbPath = path.join(dataRoot, "bruto.db");
    assert.equal(fs.existsSync(dbPath), true, "o boot não criou o banco");

    const db = new Database(dbPath, { readonly: true });
    const tabelas = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
    ).map((r) => r.name);
    const categorias = (
      db.prepare("SELECT count(*) AS c FROM categories").get() as { c: number }
    ).c;
    const journal = (
      db.prepare("SELECT count(*) AS c FROM __drizzle_migrations").get() as { c: number }
    ).c;
    db.close();

    for (const t of ["brutos", "jobs", "categories", "artifacts"]) {
      assert.ok(tabelas.includes(t), `faltou a tabela ${t} (achei: ${tabelas.join(", ")})`);
    }
    assert.equal(journal > 0, true, "o journal do Drizzle não foi gravado");
    assert.equal(categorias, 9, "o seed de categorias não rodou");
  });

  test("o boot é idempotente: rodar de novo não duplica seed nem quebra", async () => {
    await register();
    const db = new Database(path.join(dataRoot, "bruto.db"), { readonly: true });
    const categorias = (
      db.prepare("SELECT count(*) AS c FROM categories").get() as { c: number }
    ).c;
    db.close();
    assert.equal(categorias, 9);
  });

  test("falha de migração DERRUBA o boot — nunca servidor de pé sem tabelas", async () => {
    // BRUTO_DATA_ROOT apontando para dentro de um ARQUIVO: nem a pasta nem o
    // banco podem ser criados — a migração falha na cara.
    const arquivoNoCaminho = path.join(raiz, "sou-um-arquivo");
    fs.writeFileSync(arquivoNoCaminho, "x");
    const dataRootQuebrado = path.join(arquivoNoCaminho, "dados");

    process.env.BRUTO_DATA_ROOT = dataRootQuebrado;
    try {
      await assert.rejects(() => register(), /migra|ENOTDIR|ENOENT|banco/i);
    } finally {
      process.env.BRUTO_DATA_ROOT = dataRoot;
    }
  });
});
