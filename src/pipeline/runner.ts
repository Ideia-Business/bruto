import { nanoid } from "nanoid";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { jobs } from "@/db/schema";
import { emitProgress } from "./bus";
import { runMetadata } from "./steps/01-metadata";
import { runTranscript } from "./steps/02-transcript";
import { runTranslate } from "./steps/06-translate";
import { runSummary } from "./steps/03-summary";
import { runMindmap } from "./steps/04-mindmap";
import { runCategory } from "./steps/05-category";
import { runExport } from "./steps/06-export";
import fs from "node:fs";
import { artifactPaths } from "./lib/paths";
import {
  PipelineError,
  type ErrorCode,
  type JobProgress,
  type JobStep,
  type VideoMetadata,
} from "./types";

export interface EnqueueOptions {
  forceWhisper?: boolean;
  translate?: boolean;
}

/** Fila serial (concorrência 1) em globalThis — sobrevive ao hot reload. */
interface RunnerState {
  queue: string[];
  active: boolean;
}
const globalForRunner = globalThis as unknown as { __resumeVideoRunner?: RunnerState };
const state: RunnerState =
  globalForRunner.__resumeVideoRunner ?? { queue: [], active: false };
globalForRunner.__resumeVideoRunner = state;

/** Atualiza o job no SQLite (fonte de verdade) e emite o snapshot no bus. */
function update(
  jobId: string,
  patch: Partial<{
    status: JobProgress["status"];
    currentStep: JobStep | null;
    progressPct: number;
    errorCode: ErrorCode | null;
    errorMessage: string | null;
    videoId: string | null;
    startedAt: Date;
    finishedAt: Date;
  }>,
): void {
  db.update(jobs).set(patch).where(eq(jobs.id, jobId)).run();
  const row = db.select().from(jobs).where(eq(jobs.id, jobId)).get();
  if (row) {
    emitProgress({
      jobId: row.id,
      videoId: row.videoId,
      status: row.status as JobProgress["status"],
      step: row.currentStep as JobStep | null,
      progressPct: row.progressPct,
      errorCode: row.errorCode as ErrorCode | null,
      errorMessage: row.errorMessage,
    });
  }
}

/**
 * Cria um job `queued` e o coloca na fila. Retorna o jobId imediatamente;
 * o processamento roda em background (serial).
 */
export function enqueue(url: string, opts: EnqueueOptions = {}): string {
  const jobId = nanoid();
  db.insert(jobs)
    .values({
      id: jobId,
      videoId: null,
      url,
      status: "queued",
      currentStep: null,
      progressPct: 0,
      forceWhisper: opts.forceWhisper ?? false,
      translate: opts.translate ?? false,
      createdAt: new Date(),
    })
    .run();
  emitProgress({
    jobId,
    videoId: null,
    status: "queued",
    step: null,
    progressPct: 0,
    errorCode: null,
    errorMessage: null,
  });
  state.queue.push(jobId);
  void drain();
  return jobId;
}

/** Processa a fila serialmente até esvaziar. */
async function drain(): Promise<void> {
  if (state.active) return;
  state.active = true;
  try {
    while (state.queue.length > 0) {
      const jobId = state.queue.shift();
      if (jobId) await processJob(jobId);
    }
  } finally {
    state.active = false;
  }
}

/** Executa o pipeline completo de um job. Erros viram estado `error` tipado. */
export async function processJob(jobId: string): Promise<void> {
  const job = db.select().from(jobs).where(eq(jobs.id, jobId)).get();
  if (!job) return;

  update(jobId, { status: "running", startedAt: new Date(), progressPct: 2 });

  try {
    // 1) metadata
    update(jobId, { currentStep: "metadata", progressPct: 5 });
    const meta: VideoMetadata = await runMetadata(job.url);
    update(jobId, { videoId: meta.id });

    // 2) transcript
    update(jobId, { currentStep: "transcript", progressPct: 15 });
    const transcript = await runTranscript(job.url, meta, {
      forceWhisper: job.forceWhisper ?? false,
      onTick: (pct) => {
        // Mapeia 0-100 da etapa para a faixa global 15-45%.
        update(jobId, { progressPct: 15 + Math.round((pct / 100) * 30) });
      },
    });

    // 2.5) translate (opcional): vídeo não-PT + pedido de tradução
    if ((job.translate ?? false) && !transcript.isPortuguese) {
      update(jobId, { currentStep: "translate", progressPct: 46 });
      await runTranslate(meta, transcript.timestampedText, (pct) => {
        update(jobId, { progressPct: 46 + Math.round((pct / 100) * 8) });
      });
    }

    // 3) summary
    update(jobId, { currentStep: "summary", progressPct: 55 });
    const summaryMd = await runSummary(meta, transcript.text);

    // 4) mindmap
    update(jobId, { currentStep: "mindmap", progressPct: 66 });
    const mindmapMd = await runMindmap(meta, transcript.text);

    // 5) category
    update(jobId, { currentStep: "category", progressPct: 74 });
    await runCategory(meta, transcript.text);

    // 6) export — docx, pdf e imagem do mapa mental
    update(jobId, { currentStep: "export", progressPct: 80 });
    const dir = artifactPaths(meta.id).dir;
    const translatedPath = dir + "/transcript.pt-BR.txt";
    const transcriptTranslated = fs.existsSync(translatedPath)
      ? fs.readFileSync(translatedPath, "utf8")
      : null;
    const studyPath = dir + "/study.md";
    const studyMd = fs.existsSync(studyPath) ? fs.readFileSync(studyPath, "utf8") : null;
    await runExport({
      meta,
      summaryMd,
      studyMd,
      mindmapMd,
      transcript: transcript.text,
      transcriptTranslated,
      onTick: (pct) => update(jobId, { progressPct: 80 + Math.round((pct / 100) * 18) }),
    });

    update(jobId, {
      status: "done",
      currentStep: null,
      progressPct: 100,
      finishedAt: new Date(),
      errorCode: null,
      errorMessage: null,
    });
  } catch (err) {
    const code: ErrorCode = err instanceof PipelineError ? err.code : "UNKNOWN";
    const message = err instanceof Error ? err.message : String(err);
    update(jobId, {
      status: "error",
      errorCode: code,
      errorMessage: message,
      finishedAt: new Date(),
    });
  }
}

/**
 * No boot do servidor, jobs que ficaram `running` (crash/restart) voltam para
 * `queued` e são re-enfileirados — nenhum job fica preso.
 */
export function recoverOrphans(): number {
  const orphans = db
    .select({ id: jobs.id })
    .from(jobs)
    .where(inArray(jobs.status, ["running", "queued"]))
    .all();
  if (orphans.length === 0) return 0;
  for (const o of orphans) {
    db.update(jobs)
      .set({ status: "queued", currentStep: null, progressPct: 0 })
      .where(eq(jobs.id, o.id))
      .run();
    if (!state.queue.includes(o.id)) state.queue.push(o.id);
  }
  void drain();
  return orphans.length;
}

/** Roda um job de forma síncrona (await até terminar) — usado pela CLI da Fase 1. */
export async function runJobSync(url: string, opts: EnqueueOptions = {}): Promise<string> {
  const jobId = enqueue(url, opts);
  // enqueue já disparou drain(); esperamos a fila terminar este job.
  while (true) {
    const row = db.select({ status: jobs.status }).from(jobs).where(eq(jobs.id, jobId)).get();
    if (row && (row.status === "done" || row.status === "error")) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  return jobId;
}
