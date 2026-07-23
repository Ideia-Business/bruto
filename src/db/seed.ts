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

for (const cat of SEED) {
  db.insert(categories).values(cat).onConflictDoNothing().run();
}

console.log(`✅ Seed concluído: ${SEED.length} categorias garantidas.`);
