/**
 * Teste de regressão da migração `0001` — o rename de `videos` para `brutos`.
 *
 * Por que ele existe: a migração tem três linhas (`ALTER TABLE ... RENAME TO`,
 * mais o índice) e depende de um comportamento do SQLite que ela própria NÃO
 * pode garantir — quando uma tabela é renomeada, as cláusulas `REFERENCES` das
 * tabelas filhas são reescritas para o nome novo, mas isso só acontece se
 * `foreign_keys` estiver ON **ou** `legacy_alter_table` estiver OFF. Com a
 * combinação errada (`foreign_keys=OFF` e `legacy_alter_table=ON`, medida em
 * 12/09/2026 no SQLite 3.53.3), o RENAME acontece e as três filhas ficam
 * apontando para uma tabela `videos` que não existe mais — **sem erro nenhum**.
 *
 * Ligar o pragma de dentro do arquivo `.sql` não resolveria: `PRAGMA
 * foreign_keys` é no-op dentro de transação, e o migrator do Drizzle roda tudo
 * em transação. (Foi exatamente isso que invalidou o SQL que o `drizzle-kit
 * generate` emitiu, e o motivo de a migração ter sido escrita à mão.)
 *
 * Quem garante a condição hoje é `src/db/migrate.ts`, que liga `foreign_keys`
 * ANTES de abrir a transação. Esse é um detalhe a uma linha de distância de ser
 * removido por engano — daí este teste: ele roda o caminho REAL
 * (`npm run db:migrate`) sobre um banco de verdade, com dado, e afirma o
 * RESULTADO (a quem as filhas apontam), não o mecanismo. Se alguém trocar o
 * pragma, ligar o `legacy_alter_table` ou reescrever a migração, o teste
 * reprova aqui em vez de o banco de alguém quebrar em silêncio.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const RAIZ = process.cwd();
const PRIMEIRA_MIGRACAO = path.join(RAIZ, "drizzle", "0000_esquema_inicial.sql");

/** Uma linha reconhecível, para provar que é O MESMO dado do outro lado. */
const CANARIO = {
  id: "CANARIO0001",
  url: "https://exemplo.test/canario",
  title: "Canário da migração",
  channel: "Canal do Canário",
  durationSec: 4242,
};

let dataRoot: string;
let dbPath: string;

/** Banco no estado PRÉ-rename: o schema da 0000, com dado nas cinco tabelas. */
function semear(destino: string): void {
  const db = new Database(destino);
  const sql = fs.readFileSync(PRIMEIRA_MIGRACAO, "utf8").split("--> statement-breakpoint").join(";");
  db.exec(sql);
  db.prepare("INSERT INTO categories (id, name, slug, sort_order) VALUES (1, ?, ?, 0)").run(
    "Concursos",
    "concursos",
  );
  db.prepare(
    "INSERT INTO videos (id, url, platform, title, channel, duration_sec, category_id, created_at) VALUES (?, ?, 'youtube', ?, ?, ?, 1, 1757700000)",
  ).run(CANARIO.id, CANARIO.url, CANARIO.title, CANARIO.channel, CANARIO.durationSec);
  // As três filhas: é o REFERENCES delas que o rename precisa reescrever.
  db.prepare(
    "INSERT INTO artifacts (id, video_id, kind, file_path, created_at) VALUES ('a1', ?, 'summary_md', '/tmp/x.md', 1757700000)",
  ).run(CANARIO.id);
  db.prepare(
    "INSERT INTO jobs (id, video_id, url, status, progress_pct, created_at) VALUES ('j1', ?, ?, 'done', 100, 1757700000)",
  ).run(CANARIO.id, CANARIO.url);
  db.prepare(
    "INSERT INTO filoes (id, name, slug, sort_order, created_at) VALUES ('f1', 'Direito', 'direito', 1, 1757700000)",
  ).run();
  db.prepare(
    "INSERT INTO filao_brutos (filao_id, video_id, added_at) VALUES ('f1', ?, 1757700000)",
  ).run(CANARIO.id);
  db.close();
}

/** A tabela que a FK `video_id` de `tabela` referencia, segundo o próprio banco. */
function alvoDaFk(db: Database.Database, tabela: string): string {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE name = ?").get(tabela) as
    | { sql: string }
    | undefined;
  assert.ok(row, `a tabela ${tabela} deveria existir depois da migração`);
  const m = row.sql.match(/FOREIGN KEY\s*\(\s*[`"]?video_id[`"]?\s*\)\s*REFERENCES\s*[`"]?(\w+)/i);
  assert.ok(m, `${tabela} deveria ter uma FK por video_id; DDL: ${row.sql}`);
  return m[1];
}

describe("migração 0001 — videos vira brutos sem quebrar o banco", () => {
  before(() => {
    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bruto-migrate-"));
    dbPath = path.join(dataRoot, "bruto.db");
    semear(dbPath);

    // O CAMINHO REAL, não uma reimplementação: é `src/db/migrate.ts` que liga o
    // pragma do qual a migração depende, então é ele que precisa ser exercido.
    execFileSync("npm", ["run", "db:migrate"], {
      cwd: RAIZ,
      env: { ...process.env, BRUTO_DATA_ROOT: dataRoot },
      stdio: "pipe",
    });
  });

  after(() => {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });

  test("a tabela foi renomeada: existe `brutos`, não existe mais `videos`", () => {
    const db = new Database(dbPath, { readonly: true });
    const nomes = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
    ).map((r) => r.name);
    db.close();
    assert.ok(nomes.includes("brutos"), `esperava a tabela brutos; achei: ${nomes.join(", ")}`);
    assert.ok(!nomes.includes("videos"), "a tabela videos não deveria ter sobrado");
  });

  test("o dado atravessou intacto — é a mesma linha, não uma tabela nova vazia", () => {
    const db = new Database(dbPath, { readonly: true });
    const linhas = db
      .prepare("SELECT id, url, title, channel, duration_sec FROM brutos")
      .all() as Record<string, unknown>[];
    db.close();
    assert.equal(linhas.length, 1);
    assert.deepEqual(linhas[0], {
      id: CANARIO.id,
      url: CANARIO.url,
      title: CANARIO.title,
      channel: CANARIO.channel,
      duration_sec: CANARIO.durationSec,
    });
  });

  test("as três filhas guardaram as suas linhas", () => {
    const db = new Database(dbPath, { readonly: true });
    const conta = (t: string) =>
      (db.prepare(`SELECT count(*) AS c FROM ${t}`).get() as { c: number }).c;
    const resultado = {
      artifacts: conta("artifacts"),
      jobs: conta("jobs"),
      filao_brutos: conta("filao_brutos"),
    };
    db.close();
    assert.deepEqual(resultado, { artifacts: 1, jobs: 1, filao_brutos: 1 });
  });

  /** A CONDIÇÃO DE PROPÓSITO deste arquivo. Se um dia falhar, leia o cabeçalho. */
  test("as três filhas passaram a referenciar `brutos` — não a tabela que sumiu", () => {
    const db = new Database(dbPath, { readonly: true });
    const alvos = {
      artifacts: alvoDaFk(db, "artifacts"),
      jobs: alvoDaFk(db, "jobs"),
      filao_brutos: alvoDaFk(db, "filao_brutos"),
    };
    db.close();
    assert.deepEqual(alvos, { artifacts: "brutos", jobs: "brutos", filao_brutos: "brutos" });
  });

  test("integridade referencial: `foreign_key_check` não acusa nada", () => {
    const db = new Database(dbPath, { readonly: true });
    const problemas = db.prepare("PRAGMA foreign_key_check").all();
    db.close();
    assert.deepEqual(problemas, []);
  });

  /**
   * `foreign_key_check` vazio é prova FRACA: ele também volta vazio num banco
   * cujas FKs apontam para o nada. Esta é a asserção positiva — a única que
   * distingue "íntegro" de "sem ninguém conferindo".
   */
  test("a FK é imposta de verdade: inserir filho órfão é rejeitado", () => {
    const db = new Database(dbPath);
    db.pragma("foreign_keys = ON");
    assert.throws(
      () =>
        db
          .prepare(
            "INSERT INTO artifacts (id, video_id, kind, file_path, created_at) VALUES ('orfao', 'NAO_EXISTE', 'summary_md', '/tmp/y.md', 1757700000)",
          )
          .run(),
      (erro: NodeJS.ErrnoException) => erro.code === "SQLITE_CONSTRAINT_FOREIGNKEY",
      "um filho apontando para um bruto inexistente deveria ser recusado",
    );
    db.close();
  });
});
