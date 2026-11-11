/**
 * CLASSE DD no estado intermediário da migração — nenhuma mensagem manda a
 * pessoa apagar o banco, e a falha NÃO toca no arquivo.
 *
 * O achado que originou este teste (revisão, alta): um banco antigo com dados
 * e apenas PARTE das tabelas esperadas recebia a orientação "apague
 * `<dbPath>` e reabra / rode do zero" — com os registros da biblioteca
 * dentro. A saída correta tem três partes obrigatórias, nos DOIS modos
 * (clone e pacote):
 *
 *  1. o que aconteceu (quais tabelas existem, qual falta);
 *  2. que NADA foi alterado no banco e ONDE ele está;
 *  3. o caminho seguro — preservar uma cópia e pedir ajuda (no clone, o
 *     reparo não destrutivo que já existe: `drizzle-kit push`, que mostra o
 *     que vai mudar e pergunta antes).
 *
 * E uma prova além do texto: o sha256 do `bruto.db` antes da migração falhar
 * é EXATAMENTE o mesmo depois — nem o cabeçalho do arquivo pode mudar (um
 * `PRAGMA journal_mode` já mudaria), então a detecção precisa acontecer sem
 * abrir o banco para escrita.
 *
 * Montagem: banco temporário no estado pré-journal com uma tabela da 0000
 * faltando e dado canário nas outras; o caminho REAL (`npm run db:migrate`)
 * roda duas vezes sobre o MESMO banco — uma em modo clone, uma em modo
 * pacote — e o banco tem de continuar intacto para a segunda leitura.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const RAIZ = process.cwd();
const PRIMEIRA_MIGRACAO = path.join(RAIZ, "drizzle", "0000_esquema_inicial.sql");

/** A tabela da 0000 que "faltou" neste banco — a mensagem tem de nomeá-la. */
const TABELA_AUSENTE = "filao_brutos";

/** Verbo destrutivo que NUNCA pode aparecer numa saída para a pessoa. */
const DD_VERBO = /apague|apagar|exclua|excluir|remova|remover|deletar|delete/i;

const CANARIO = { id: "CANARIO-DD", url: "https://exemplo.test/dd", title: "Canário da classe DD" };

let dataRoot: string;
let dbPath: string;
let hashAntes: string;

function sha256Do(arquivo: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(arquivo)).digest("hex");
}

/** Banco parcial: todas as tabelas da 0000 MENOS uma, com dado, sem journal. */
function semearParcial(destino: string): void {
  const db = new Database(destino);
  const sql = fs.readFileSync(PRIMEIRA_MIGRACAO, "utf8").split("--> statement-breakpoint").join(";");
  db.exec(sql);
  db.exec(`DROP TABLE ${TABELA_AUSENTE}`);
  db.prepare("INSERT INTO categories (id, name, slug, sort_order) VALUES (1, ?, ?, 0)").run(
    "Concursos",
    "concursos",
  );
  db.prepare(
    "INSERT INTO videos (id, url, platform, title, channel, duration_sec, category_id, created_at) VALUES (?, ?, 'youtube', ?, 'Canal DD', 60, 1, 1757700000)",
  ).run(CANARIO.id, CANARIO.url, CANARIO.title);
  db.close();
}

/** O caminho REAL — `npm run db:migrate` — capturando saída e código de saída. */
function rodarMigracao(empacotado: boolean): { status: number | null; saida: string } {
  const env: NodeJS.ProcessEnv = { ...process.env, BRUTO_DATA_ROOT: dataRoot };
  if (empacotado) env.BRUTO_EMPACOTADO = "1";
  else delete env.BRUTO_EMPACOTADO;
  const r = spawnSync("npm", ["run", "db:migrate"], { cwd: RAIZ, env, encoding: "utf8" });
  return { status: r.status, saida: `${r.stdout ?? ""}\n${r.stderr ?? ""}` };
}

let clone: { status: number | null; saida: string };
let pacote: { status: number | null; saida: string };

before(() => {
  dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bruto-dd-"));
  dbPath = path.join(dataRoot, "bruto.db");
  semearParcial(dbPath);
  hashAntes = sha256Do(dbPath);

  // Os DOIS modos sobre o MESMO banco: se a primeira falha tocasse no
  // arquivo, a segunda já partiria de outro estado.
  clone = rodarMigracao(false);
  pacote = rodarMigracao(true);
});

after(() => {
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

describe("estado intermediário — a migração falha SEM tocar no banco (classe DD)", () => {
  test("nos dois modos a migração FALHA (não segue com schema incompleto)", () => {
    assert.notEqual(clone.status, 0, `clone passou?! saída:\n${clone.saida}`);
    assert.notEqual(pacote.status, 0, `pacote passou?! saída:\n${pacote.saida}`);
  });

  test("CLASSE DD: nenhuma das duas saídas manda apagar/excluir/remover dado da pessoa", () => {
    assert.ok(!DD_VERBO.test(clone.saida), `modo clone:\n${clone.saida}`);
    assert.ok(!DD_VERBO.test(pacote.saida), `modo pacote:\n${pacote.saida}`);
  });

  test("a mensagem diz o que aconteceu: as tabelas presentes e a que falta", () => {
    for (const [modo, r] of [["clone", clone], ["pacote", pacote]] as const) {
      assert.ok(r.saida.includes("estado intermediário"), `${modo}:\n${r.saida}`);
      assert.ok(r.saida.includes(TABELA_AUSENTE), `${modo} não nomeou a tabela que falta:\n${r.saida}`);
    }
  });

  test("a mensagem diz que NADA foi alterado e ONDE o banco está", () => {
    for (const [modo, r] of [["clone", clone], ["pacote", pacote]] as const) {
      assert.ok(/NÃO alterou nada/i.test(r.saida), `${modo}:\n${r.saida}`);
      assert.ok(r.saida.includes(dbPath), `${modo} não nomeou o caminho do banco:\n${r.saida}`);
      assert.ok(/cópia/i.test(r.saida), `${modo} não orientou preservar uma cópia:\n${r.saida}`);
    }
  });

  test("modo pacote: o caminho seguro é a cópia de ~/.bruto/bruto.db + suporte", () => {
    assert.ok(pacote.saida.includes("~/.bruto/bruto.db"), pacote.saida);
    assert.ok(/suporte/i.test(pacote.saida), pacote.saida);
  });

  test("modo clone: aponta o reparo NÃO destrutivo que já existe (drizzle-kit push pergunta antes)", () => {
    assert.ok(clone.saida.includes("npx drizzle-kit push"), clone.saida);
    assert.ok(/confirma|pergunta/i.test(clone.saida), clone.saida);
  });

  test("PROVA: o arquivo do banco é bit a bit o mesmo — sha256 antes = depois das duas falhas", () => {
    assert.equal(sha256Do(dbPath), hashAntes);
  });

  test("o dado canário continua lá, legível", () => {
    const db = new Database(dbPath, { readonly: true });
    const linha = db
      .prepare("SELECT id, url, title FROM videos WHERE id = ?")
      .get(CANARIO.id) as Record<string, unknown> | undefined;
    db.close();
    assert.deepEqual(linha, { id: CANARIO.id, url: CANARIO.url, title: CANARIO.title });
  });
});
