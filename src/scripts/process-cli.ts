/**
 * CLI da Fase 1 — roda o pipeline completo para uma URL, sem UI.
 *   npm run process -- "<url>" [--whisper] [--traduzir]
 *
 * Loga o progresso de cada etapa via o bus e imprime um resumo final com os
 * caminhos dos artefatos gerados.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { jobs, videos, artifacts, categories } from "@/db/schema";
import { parseYoutubeUrl, artifactPaths } from "@/pipeline/lib/paths";
import { bus } from "@/pipeline/bus";
import { runJobSync } from "@/pipeline/runner";
import type { JobProgress } from "@/pipeline/types";

function parseArgs(argv: string[]): { url: string; whisper: boolean; translate: boolean } {
  const flags = new Set(argv.filter((a) => a.startsWith("--")));
  const positional = argv.filter((a) => !a.startsWith("--"));
  return {
    url: positional[0] ?? "",
    whisper: flags.has("--whisper"),
    translate: flags.has("--traduzir") || flags.has("--translate"),
  };
}

const STEP_LABEL: Record<string, string> = {
  metadata: "Metadados",
  transcript: "Transcrição",
  translate: "Tradução PT-BR",
  summary: "Resumo",
  mindmap: "Mapa mental",
  category: "Categoria",
  export: "Exportação",
};

async function main(): Promise<void> {
  const { url, whisper, translate } = parseArgs(process.argv.slice(2));
  if (!url) {
    console.error('Uso: npm run process -- "<url do youtube>" [--whisper] [--traduzir]');
    process.exit(1);
  }
  if (!parseYoutubeUrl(url)) {
    console.error(`URL inválida do YouTube: ${url}`);
    process.exit(1);
  }

  console.log(`\n▶ Processando: ${url}`);
  if (whisper) console.log("  (forçando transcrição via Whisper)");
  if (translate) console.log("  (tradução completa PT-BR habilitada)");
  console.log("");

  let lastStep = "";
  const onProgress = (p: JobProgress) => {
    if (p.step && p.step !== lastStep) {
      lastStep = p.step;
      console.log(`  [${String(p.progressPct).padStart(3)}%] ${STEP_LABEL[p.step] ?? p.step}…`);
    }
  };
  bus.on("job:*", onProgress);

  const jobId = await runJobSync(url, { forceWhisper: whisper, translate });
  bus.off("job:*", onProgress);

  const job = db.select().from(jobs).where(eq(jobs.id, jobId)).get();
  if (!job || job.status === "error") {
    console.error(`\n✖ Falhou [${job?.errorCode ?? "?"}]: ${job?.errorMessage ?? "erro desconhecido"}`);
    process.exit(1);
  }

  const video = db.select().from(videos).where(eq(videos.id, job.videoId!)).get();
  const cat = video?.categoryId
    ? db.select().from(categories).where(eq(categories.id, video.categoryId)).get()
    : null;
  const arts = db.select().from(artifacts).where(eq(artifacts.videoId, job.videoId!)).all();
  const paths = artifactPaths(job.videoId!);

  console.log(`\n✔ Concluído: "${video?.title}" — ${video?.channel ?? "?"}`);
  console.log(`  Categoria: ${cat?.name ?? "?"} · Fonte da transcrição: ${video?.transcriptSource ?? "?"}`);
  console.log(`  Pasta: ${paths.dir}`);
  console.log(`  Artefatos (${arts.length}):`);
  for (const a of arts) console.log(`    · ${a.kind.padEnd(22)} ${a.filePath}`);
  console.log("");
  process.exit(0);
}

void main();
