import { defineConfig } from "drizzle-kit";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Raiz de dados — mesma resolução de src/pipeline/lib/paths.ts. Duplicada de
 * propósito: o drizzle-kit carrega este arquivo fora do bundle do Next, onde o
 * alias "@/" não resolve. Se mudar aqui, mude lá.
 */
const DATA_ROOT =
  process.env.BRUTO_DATA_ROOT ?? path.join(os.homedir(), ".bruto");

// Em clone novo o diretório ainda não existe, e o better-sqlite3 não o cria:
// falha ao abrir o arquivo e — pior — o drizzle-kit ainda assim sai com código
// 0, então a preparação do banco seguia para o seed e estourava com um confuso
// "no such table: categories". Criar aqui elimina a causa. (Hoje quem aplica o
// schema é `db:migrate`; este config serve ao `db:generate` e ao `db:studio`.)
fs.mkdirSync(DATA_ROOT, { recursive: true });

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: path.join(DATA_ROOT, "bruto.db"),
  },
});
