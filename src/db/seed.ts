import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { db } from "./client";
import { categories } from "./schema";

const SEED: Array<{ name: string; slug: string; sortOrder: number }> = [
  { name: "Tecnologia", slug: "tecnologia", sortOrder: 1 },
  { name: "Negócios", slug: "negocios", sortOrder: 2 },
  { name: "Educação", slug: "educacao", sortOrder: 3 },
  { name: "Ciência", slug: "ciencia", sortOrder: 4 },
  { name: "Saúde", slug: "saude", sortOrder: 5 },
  { name: "Finanças", slug: "financas", sortOrder: 6 },
  { name: "Desenvolvimento Pessoal", slug: "desenvolvimento-pessoal", sortOrder: 7 },
  { name: "Entretenimento", slug: "entretenimento", sortOrder: 8 },
  { name: "Outros", slug: "outros", sortOrder: 9 },
];

/**
 * Garante as categorias-base. Exportada para o boot do app empacotado
 * (`instrumentation.ts`) chamar logo depois das migrações — o
 * `npm run db:seed` continua chamando a mesma função pelo gatilho de
 * execução direta no fim do arquivo (INVARIANTE F2: o script não muda de
 * comportamento). Idempotente (`onConflictDoNothing`).
 */
export function aplicarSeed(): void {
  for (const cat of SEED) {
    db.insert(categories).values(cat).onConflictDoNothing().run();
  }
  console.log(`✅ Seed concluído: ${SEED.length} categorias garantidas.`);
}

// Executado como script (`npm run db:seed` → `tsx src/db/seed.ts`): roda na
// hora. Importado (boot do app): exporta e nada mais.
if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  aplicarSeed();
}
