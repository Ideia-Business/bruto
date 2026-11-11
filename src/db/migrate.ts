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
import os from "node:os";
import path from "node:path";
import { juntarCaminho } from "@/lib/caminho-opaco";

/** Nome da tabela de controle do Drizzle. Fixo na biblioteca; repetido aqui
 *  porque o baseline precisa criá-la antes de o migrator existir. */
const TABELA_JOURNAL = "__drizzle_migrations";

interface EntradaJournal {
  idx: number;
  when: number;
  tag: string;
}

function lerJournal(migrationsDir: string): EntradaJournal[] {
  // juntarCaminho (não path.join) em todo o arquivo: os literais de
  // diretório/arquivo ao lado de partes dinâmicas fazem o tracer do
  // standalone varrer o projeto atrás deles (ver caminho-opaco.ts) — foi o
  // que duplicou o diretório drizzle a partir de dist/Bruto.app no payload.
  const p = juntarCaminho(migrationsDir, "meta", "_journal.json");
  const journal = JSON.parse(fs.readFileSync(p, "utf8")) as { entries: EntradaJournal[] };
  return journal.entries;
}

/** Nomes das tabelas que uma migração cria — lidos do próprio SQL, para a
 *  lista nunca divergir do arquivo quando o schema crescer. */
function tabelasCriadasPor(migrationsDir: string, tag: string): string[] {
  const sql = fs.readFileSync(juntarCaminho(migrationsDir, `${tag}.sql`), "utf8");
  return [...sql.matchAll(/CREATE TABLE\s+`([^`]+)`/gi)].map((m) => m[1]);
}

/** O mesmo hash que o Drizzle grava: sha256 do conteúdo bruto do .sql. */
function hashDaMigracao(migrationsDir: string, tag: string): string {
  const sql = fs.readFileSync(juntarCaminho(migrationsDir, `${tag}.sql`), "utf8");
  return crypto.createHash("sha256").update(sql).digest("hex");
}

function tabelaExiste(sqlite: Database.Database, nome: string): boolean {
  const row = sqlite
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(nome);
  return row !== undefined;
}

/**
 * O meio-termo perigoso: o banco tem PARTE das tabelas da baseline (pode ser
 * um push antigo, anterior a alguma tabela nova). Carimbar deixaria o banco
 * permanentemente incompleto, e executar a 0000 quebraria nas que existem.
 *
 * Retorna o que tem e o que falta — ou null quando o banco NÃO está nesse
 * caso (vazio, completo ou já controlado pelo journal).
 */
function detectarEstadoIntermediario(
  sqlite: Database.Database,
  entradas: EntradaJournal[],
  migrationsDir: string,
): { presentes: string[]; faltando: string[] } | null {
  if (entradas.length === 0) return null;
  if (tabelaExiste(sqlite, TABELA_JOURNAL)) return null;

  const base = entradas[0];
  const esperadas = tabelasCriadasPor(migrationsDir, base.tag);
  const presentes = esperadas.filter((t) => tabelaExiste(sqlite, t));

  if (presentes.length === 0 || presentes.length === esperadas.length) return null;
  return { presentes, faltando: esperadas.filter((t) => !presentes.includes(t)) };
}

/**
 * A saída do estado intermediário, POR MODO — e em NENHUM dos dois ela manda
 * apagar ou sobrescrever o banco (CLASSE DD): dado da pessoa não é consertado
 * às cegas. A orientação é sempre preservar uma cópia e pedir ajuda; no clone
 * existe um reparo não destrutivo (`drizzle-kit push` mostra o que vai mudar
 * e pergunta antes — nada é aplicado sem confirmação), no app instalado não
 * há ferramenta de schema, então o caminho é o suporte.
 */
function mensagemEstadoIntermediario(
  presentes: string[],
  faltando: string[],
  dbPath: string,
): string {
  const saidas =
    process.env.BRUTO_EMPACOTADO === "1"
      ? `No app instalado não há ferramenta de schema à mão. Caminho seguro: ` +
        `(1) faça uma cópia de ~/.bruto/bruto.db (por exemplo, ` +
        `\`cp ~/.bruto/bruto.db ~/Desktop/bruto-backup.db\`); ` +
        `(2) fale com o suporte e envie esta mensagem.`
      : `Caminho seguro: (1) faça uma cópia de ${dbPath}; ` +
        `(2) rode \`npx drizzle-kit push\` para completar o schema — ele mostra o que ` +
        `vai mudar e pergunta antes, nada é aplicado sem a sua confirmação; ` +
        `(3) rode \`npm run db:migrate\`. Em caso de dúvida, abra uma demanda antes.`;
  return (
    `Banco em estado intermediário: tem ${presentes.join(", ")} mas falta ${faltando.join(", ")}.\n` +
    `Não dá para carimbar o baseline com segurança, e o Bruto NÃO alterou nada — ` +
    `o banco está intacto em ${dbPath}. ${saidas}`
  );
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
 *
 * Pré-condição garantida por `aplicarMigracoes`: o banco NÃO está em estado
 * intermediário (o portão somente-leitura já falhou antes, sem tocar no
 * arquivo). Aqui só restam dois casos: banco vazio (nada a carimbar) ou
 * banco com a baseline completa (carimbar).
 */
function carimbarBaselineSeNecessario(
  sqlite: Database.Database,
  entradas: EntradaJournal[],
  migrationsDir: string,
): boolean {
  if (entradas.length === 0) return false;
  if (tabelaExiste(sqlite, TABELA_JOURNAL)) return false; // banco já controlado

  const base = entradas[0];
  const esperadas = tabelasCriadasPor(migrationsDir, base.tag);
  const presentes = esperadas.filter((t) => tabelaExiste(sqlite, t));

  // Banco vazio (clone novo): nada a carimbar — a 0000 roda de verdade.
  if (presentes.length === 0) return false;

  sqlite.exec(
    `CREATE TABLE IF NOT EXISTS ${TABELA_JOURNAL} (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at numeric
    )`,
  );
  sqlite
    .prepare(`INSERT INTO ${TABELA_JOURNAL} ("hash", "created_at") VALUES (?, ?)`)
    .run(hashDaMigracao(migrationsDir, base.tag), base.when);
  return true;
}

/**
 * Aplica as migrações de `drizzle/` ao banco da biblioteca. Exportada para o
 * boot do app empacotado (`instrumentation.ts`) chamar antes de re-enfileirar
 * órfãos — o `npm run db:migrate` chama a mesma função pelo entrypoint de
 * CLI separado (`cli-migrate.ts`), porque o gatilho "sou o módulo principal?"
 * neste arquivo fazia o tracer do build standalone arrastar a toolchain do
 * build para o pacote (INVARIANTE F2 mantida: o script não muda de
 * comportamento).
 *
 * A pasta `drizzle/` é relativa ao `cwd` (no pacote, `…/Resources/app`, para
 * onde o W1 a copia). A raiz de dados segue a mesma regra de `paths.ts`
 * (`BRUTO_DATA_ROOT` ?? `~/.bruto`), calculada por CHAMADA — não na carga do
 * módulo — porque o boot e os testes ajustam `BRUTO_DATA_ROOT` por execução.
 */
export function aplicarMigracoes(): void {
  const migrationsDir = juntarCaminho(process.cwd(), "drizzle");
  const dataRoot = process.env.BRUTO_DATA_ROOT ?? path.join(os.homedir(), ".bruto");
  const dbPath = path.join(dataRoot, "bruto.db");

  fs.mkdirSync(dataRoot, { recursive: true });

  // CLASSE DD — o portão do estado intermediário: a inspeção abre o banco
  // SOMENTE-LEITURA e fecha antes de qualquer conexão de escrita ou pragma.
  // Se o schema está parcial, a migração falha aqui sem tocar no arquivo —
  // até o cabeçalho mudaria se o `journal_mode` rodasse (sha256 antes =
  // depois, provado em tests/db/migrate-estado-intermediario.test.ts).
  const entradas = lerJournal(migrationsDir);
  if (fs.existsSync(dbPath)) {
    const inspecao = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      const estado = detectarEstadoIntermediario(inspecao, entradas, migrationsDir);
      if (estado) {
        throw new Error(
          mensagemEstadoIntermediario(estado.presentes, estado.faltando, dbPath),
        );
      }
    } finally {
      inspecao.close();
    }
  }

  const sqlite = new Database(dbPath);
  // Mesmos pragmas do client: o migrator abre a sua própria conexão e não
  // herdaria nada de lá.
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  try {
    const carimbou = carimbarBaselineSeNecessario(sqlite, entradas, migrationsDir);
    if (carimbou) {
      console.log("ℹ️  Banco pré-existente detectado: baseline marcado como aplicado (nada foi executado).");
    }
    migrate(drizzle(sqlite), { migrationsFolder: migrationsDir });
    console.log(`✅ Migrações aplicadas em ${dbPath}`);
  } finally {
    sqlite.close();
  }
}
