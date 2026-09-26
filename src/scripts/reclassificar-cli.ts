/**
 * Reprocessamento retroativo do passo 05 (categoria + tags + título) — decisão
 * do dono: todos os brutos já existentes ganham tag uma vez, e todo vídeo novo
 * já sai com ela (o passo 05 do pipeline normal, sem mudar nada aqui).
 *
 *   npm run reclassificar [-- <youtube_id>]
 *
 * SEQUENCIAL DE PROPÓSITO — nunca paralelo. Cada vídeo consulta as tags que os
 * anteriores do MESMO lote já criaram (`tagNamesInCategory`, sempre fresca) para
 * reaproveitar em vez de duplicar o mesmo assunto; paralelismo quebraria
 * exatamente essa garantia (dois vídeos do mesmo assunto veriam a lista "antes"
 * e cada um criaria a sua tag).
 */
import fs from "node:fs";
import { db } from "@/db/client";
import { brutos } from "@/db/schema";
import { eq } from "drizzle-orm";
import { artifactPaths } from "@/pipeline/lib/paths";
import { runCategory } from "@/pipeline/steps/05-category";

async function main(): Promise<void> {
  const soUmId = process.argv[2];
  const todos = soUmId
    ? db.select().from(brutos).where(eq(brutos.id, soUmId)).all()
    : db.select().from(brutos).all();

  if (todos.length === 0) {
    console.log(soUmId ? `Nenhum bruto com id "${soUmId}".` : "Biblioteca vazia — nada para reclassificar.");
    return;
  }

  console.log(`\n▶ Reclassificando ${todos.length} bruto(s), um por vez…\n`);

  let ok = 0;
  let semArtefato = 0;
  let comErro = 0;

  for (const bruto of todos) {
    const paths = artifactPaths(bruto.id);
    if (!fs.existsSync(paths.transcript) || !fs.existsSync(paths.summary)) {
      console.log(`  ⏭  ${bruto.title} — sem transcrição/resumo em disco, pulado`);
      semArtefato++;
      continue;
    }

    const transcriptText = fs.readFileSync(paths.transcript, "utf8");
    const summaryMd = fs.readFileSync(paths.summary, "utf8");

    try {
      const resultado = await runCategory(
        { id: bruto.id, title: bruto.title, channel: bruto.channel, tags: [] },
        transcriptText,
        summaryMd,
      );
      // `categorySlug: null` = falha de CHAMADA (timeout, IA fora do ar) OU de
      // PARSING (resposta fora do formato esperado) — o vídeo manteve a
      // categoria que já tinha, e isto conta como FALHA, nunca sucesso.
      // Reportar "outros" aqui seria mentir que reclassificamos.
      if (resultado.categorySlug === null) {
        console.log(`  ✖ ${bruto.title} — não foi possível classificar, categoria mantida como estava`);
        comErro++;
        continue;
      }
      const tagsTexto = resultado.tags.length > 0 ? resultado.tags.join(", ") : "(nenhuma)";
      const tituloTexto = resultado.titleSuggestion ? ` · título novo: "${resultado.titleSuggestion}"` : "";
      console.log(`  ✔ ${bruto.title} → ${resultado.categorySlug} [${tagsTexto}]${tituloTexto}`);
      ok++;
    } catch (err) {
      console.log(`  ✖ ${bruto.title} — falhou: ${err instanceof Error ? err.message : String(err)}`);
      comErro++;
    }
  }

  console.log(
    `\nConcluído: ${ok} reclassificado(s), ${semArtefato} pulado(s) (sem artefato), ${comErro} com erro.\n`,
  );
  process.exit(comErro > 0 ? 1 : 0);
}

void main();
