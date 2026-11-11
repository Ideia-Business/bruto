/**
 * Classe V (integração do instalador): o código de runtime NÃO puxa a
 * toolchain do build para o pacote.
 *
 * O gatilho "sou o módulo principal?" (`import.meta.url` vs
 * `fs.realpathSync(process.argv[1])`) que fechava `migrate.ts`/`seed.ts`
 * fazia o tracer do build standalone varrer o projeto atrás do argv
 * dinâmico e arrastar `dist/` inteiro — inclusive um segundo `node` (o do
 * build) — para o payload de runtime. Medido nesta lane ANTES da correção:
 * `.next/standalone` com 520 MB, 441 MB deles em `.next/standalone/dist`,
 * e o `instrumentation.js.nft.json` citando
 * `dist/Bruto.app/.../node-v26.13.0-darwin-arm64/bin/node`.
 *
 * O contrato que este teste tranca:
 *  1. nenhum módulo de `src/` usa `import.meta.url`, `require.main` ou
 *     `realpathSync` — os três padrões que o tracer não consegue limitar;
 *  2. a invocação de CLI mora em entrypoints SEPARADOS
 *     (`cli-migrate.ts`/`cli-seed.ts`), que importam a função e nada mais —
 *     `migrate.ts`/`seed.ts` só exportam;
 *  3. os scripts `db:migrate`/`db:seed` do package.json apontam para os
 *     entrypoints novos e continuam funcionando idênticos: exit 0 sobre um
 *     BRUTO_DATA_ROOT temporário, com o efeito real no banco.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const RAIZ = process.cwd();
const SRC = path.join(RAIZ, "src");

/** Os padrões que o tracer do build standalone não consegue limitar. */
const PADROES_PROIBIDOS: Array<{ nome: string; re: RegExp }> = [
  { nome: "import.meta.url", re: /import\.meta\.url/ },
  { nome: "require.main", re: /require\.main/ },
  { nome: "realpathSync", re: /realpathSync/ },
];

function arquivosTs(dir: string): string[] {
  const achados: string[] = [];
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entrada.name);
    if (entrada.isDirectory()) achados.push(...arquivosTs(p));
    else if (entrada.name.endsWith(".ts")) achados.push(p);
  }
  return achados;
}

/** Remove comentários de bloco e de linha: o que o tracer vê é código, não
 *  prosa — os padrões proibidos podem (e devem) ser CITADOS em comentário. */
function semComentarios(conteudo: string): string {
  return conteudo.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

describe("classe V — o runtime não carrega padrão que arrasta a toolchain do build", () => {
  test("nenhum módulo de src/ usa import.meta.url, require.main ou realpathSync", () => {
    const ofensores: string[] = [];
    for (const arquivo of arquivosTs(SRC)) {
      const conteudo = semComentarios(fs.readFileSync(arquivo, "utf8"));
      for (const { nome, re } of PADROES_PROIBIDOS) {
        if (re.test(conteudo)) ofensores.push(`${path.relative(RAIZ, arquivo)} (${nome})`);
      }
    }
    assert.deepEqual(ofensores, [], "padrões que o tracer não limita: " + ofensores.join(", "));
  });

  test("migrate.ts/seed.ts só exportam; os entrypoints de CLI existem e importam a função", () => {
    for (const [modulo, cli, funcao] of [
      ["migrate", "cli-migrate", "aplicarMigracoes"],
      ["seed", "cli-seed", "aplicarSeed"],
    ] as const) {
      const cliPath = path.join(SRC, "db", `${cli}.ts`);
      assert.ok(fs.existsSync(cliPath), `entrypoint ausente: src/db/${cli}.ts`);
      const cliSrc = fs.readFileSync(cliPath, "utf8");
      assert.match(cliSrc, new RegExp(`import\\s*{\\s*${funcao}\\s*}`), `${cli}.ts não importa ${funcao}`);
      const modSrc = fs.readFileSync(path.join(SRC, "db", `${modulo}.ts`), "utf8");
      assert.match(modSrc, new RegExp(`export function ${funcao}`), `${modulo}.ts não exporta ${funcao}`);
    }
  });

  test("package.json aponta db:migrate/db:seed para os entrypoints novos", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(RAIZ, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    assert.match(pkg.scripts["db:migrate"], /src\/db\/cli-migrate\.ts/);
    assert.match(pkg.scripts["db:seed"], /src\/db\/cli-seed\.ts/);
  });

  test("db:migrate e db:seed seguem funcionando idênticos (exit 0, efeito real no banco)", () => {
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bruto-cli-db-"));
    try {
      execFileSync("npm", ["run", "db:migrate", "--silent"], {
        cwd: RAIZ,
        env: { ...process.env, BRUTO_DATA_ROOT: dataRoot },
        stdio: "pipe",
      });
      execFileSync("npm", ["run", "db:seed", "--silent"], {
        cwd: RAIZ,
        env: { ...process.env, BRUTO_DATA_ROOT: dataRoot },
        stdio: "pipe",
      });
      const db = new Database(path.join(dataRoot, "bruto.db"), { readonly: true });
      try {
        const journal = db
          .prepare("SELECT COUNT(*) AS n FROM __drizzle_migrations")
          .get() as { n: number };
        assert.ok(journal.n >= 1, "a migração não registrou o journal do Drizzle");
        const categorias = db.prepare("SELECT COUNT(*) AS n FROM categories").get() as { n: number };
        assert.equal(categorias.n, 9, "o seed não garantiu as 9 categorias");
      } finally {
        db.close();
      }
    } finally {
      fs.rmSync(dataRoot, { recursive: true, force: true });
    }
  });
});
