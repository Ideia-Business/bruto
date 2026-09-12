/**
 * Aplica as migrações versionadas de `drizzle/` ao banco da biblioteca.
 *
 * Substitui o antigo `drizzle-kit push`, que comparava schema com banco e
 * ADIVINHAVA o que fazer. Push não distingue "renomeei a tabela X para Y" de
 * "criei Y e apaguei X": ele pergunta, e a pergunta exige um terminal de
 * verdade — `--force` não a responde, então em CI o processo morre com
 * "Interactive prompts require a TTY terminal", e na máquina de quem usa a
 * resposta é dada no escuro, com a biblioteca inteira em risco. Migração
 * versionada não adivinha: o SQL foi escrito, revisado e commitado antes.
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_ROOT } from "@/pipeline/lib/paths";

const MIGRATIONS_DIR = path.join(process.cwd(), "drizzle");
const DB_PATH = path.join(DATA_ROOT, "bruto.db");

/** Nome da tabela de controle do Drizzle. Fixo na biblioteca; repetido aqui
 *  porque o baseline precisa criá-la antes de o migrator existir. */
const TABELA_JOURNAL = "__drizzle_migrations";

interface EntradaJournal {
  idx: number;
  when: number;
  tag: string;
}

function lerJournal(): EntradaJournal[] {
  const p = path.join(MIGRATIONS_DIR, "meta", "_journal.json");
  const journal = JSON.parse(fs.readFileSync(p, "utf8")) as { entries: EntradaJournal[] };
  return journal.entries;
}

/** Nomes das tabelas que uma migração cria — lidos do próprio SQL, para a
 *  lista nunca divergir do arquivo quando o schema crescer. */
function tabelasCriadasPor(tag: string): string[] {
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, `${tag}.sql`), "utf8");
  return [...sql.matchAll(/CREATE TABLE\s+`([^`]+)`/gi)].map((m) => m[1]);
}

/** O mesmo hash que o Drizzle grava: sha256 do conteúdo bruto do .sql. */
function hashDaMigracao(tag: string): string {
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, `${tag}.sql`), "utf8");
  return crypto.createHash("sha256").update(sql).digest("hex");
}

function tabelaExiste(sqlite: Database.Database, nome: string): boolean {
  const row = sqlite
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(nome);
  return row !== undefined;
}

/**
 * O caso que mais importa: o banco que JÁ EXISTE.
 *
 * Quem já usa o Bruto tem um `bruto.db` criado por `drizzle-kit push` — com
 * todas as tabelas e SEM a tabela de controle do Drizzle. Rodar `migrate` nele
 * faria o Drizzle tentar aplicar a 0000 (que é toda `CREATE TABLE`) e explodir
 * com "table already exists" — na melhor hipótese. Na pior, o banco ficaria
 * num meio-termo.
 *
 * A saída é o BASELINE: quando o banco tem as tabelas da primeira migração mas
 * não tem o journal, registramos a 0000 como já aplicada SEM executá-la. O
 * banco já está naquele estado; só faltava o Drizzle saber disso. Da próxima
 * migração em diante o fluxo é o normal, e nenhum dado é tocado aqui — só se
 * insere uma linha de controle.
 *
 * Retorna true se carimbou o baseline.
 */
function carimbarBaselineSeNecessario(sqlite: Database.Database, entradas: EntradaJournal[]): boolean {
  if (entradas.length === 0) return false;
  if (tabelaExiste(sqlite, TABELA_JOURNAL)) return false; // banco já controlado

  const base = entradas[0];
  const esperadas = tabelasCriadasPor(base.tag);
  const presentes = esperadas.filter((t) => tabelaExiste(sqlite, t));

  // Banco vazio (clone novo): nada a carimbar — a 0000 roda de verdade.
  if (presentes.length === 0) return false;

  // Meio-termo: o banco tem PARTE das tabelas da baseline. Pode ser um push
  // antigo, anterior a alguma tabela nova. Carimbar aqui deixaria o banco
  // permanentemente incompleto, e executar a 0000 quebraria nas que existem.
  // Nenhuma das duas é segura, então paramos e dizemos exatamente o que falta.
  if (presentes.length !== esperadas.length) {
    const faltando = esperadas.filter((t) => !presentes.includes(t));
    throw new Error(
      `Banco em estado intermediário: tem ${presentes.join(", ")} mas falta ${faltando.join(", ")}.\n` +
        `Não dá para carimbar o baseline com segurança. Saídas: (a) rode uma vez ` +
        `\`npx drizzle-kit push\` para completar o schema e depois \`npm run db:migrate\`; ` +
        `ou (b) se o banco for descartável, apague ${DB_PATH} e rode a migração do zero.`,
    );
  }

  sqlite.exec(
    `CREATE TABLE IF NOT EXISTS ${TABELA_JOURNAL} (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at numeric
    )`,
  );
  sqlite
    .prepare(`INSERT INTO ${TABELA_JOURNAL} ("hash", "created_at") VALUES (?, ?)`)
    .run(hashDaMigracao(base.tag), base.when);
  return true;
}

function principal(): void {
  fs.mkdirSync(DATA_ROOT, { recursive: true });
  const sqlite = new Database(DB_PATH);
  // Mesmos pragmas do client: o migrator abre a sua própria conexão e não
  // herdaria nada de lá.
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  try {
    const carimbou = carimbarBaselineSeNecessario(sqlite, lerJournal());
    if (carimbou) {
      console.log("ℹ️  Banco pré-existente detectado: baseline marcado como aplicado (nada foi executado).");
    }
    migrate(drizzle(sqlite), { migrationsFolder: MIGRATIONS_DIR });
    console.log(`✅ Migrações aplicadas em ${DB_PATH}`);
  } finally {
    sqlite.close();
  }
}

principal();
