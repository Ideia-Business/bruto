import { nanoid } from "nanoid";
import { redact } from "@/pipeline/lib/llm/redact";
import { eq, inArray, and, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { jobs, type Job } from "@/db/schema";
import { isBrutoDone, getBrutoById, getJobAtivoDoVideo } from "@/db/queries";
import { emitProgress } from "./bus";
import { fetchMetadata, persistMetadata } from "./steps/01-metadata";
import { runTranscript } from "./steps/02-transcript";
import { runTranslate } from "./steps/06-translate";
import { runSummary } from "./steps/03-summary";
import { runMindmap } from "./steps/04-mindmap";
import { runCategory } from "./steps/05-category";
import { runExport } from "./steps/06-export";
import fs from "node:fs";
import { artifactPaths, parseMediaUrl } from "./lib/paths";
import { recusarSeCancelado, rodarComCancelamento } from "./lib/cancelamento";
import {
  PipelineError,
  type ErrorCode,
  type JobProgress,
  type JobStep,
  type JobStatus,
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
  /** AbortController do job que está rodando AGORA neste processo. */
  cancelamentos: Map<string, AbortController>;
  /** Resolve quando o processJob do job settle (done/error/canceled). */
  finalizacoes: Map<string, Promise<void>>;
}
const globalForRunner = globalThis as unknown as { __resumeVideoRunner?: RunnerState };
const state: RunnerState =
  globalForRunner.__resumeVideoRunner ?? {
    queue: [],
    active: false,
    cancelamentos: new Map(),
    finalizacoes: new Map(),
  };
globalForRunner.__resumeVideoRunner = state;

/** Emite o snapshot ATUAL do job no bus (lê do SQLite, a fonte de verdade). */
function emitirJob(jobId: string): void {
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
  emitirJob(jobId);
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

/**
 * Processa a fila serialmente até esvaziar. `deps` existe para o TESTE provar
 * comportamento da fila sem lançar yt-dlp de verdade (produção não passa nada).
 */
export async function drain(deps?: DepsProcessJob): Promise<void> {
  if (state.active) return;
  state.active = true;
  try {
    while (state.queue.length > 0) {
      const jobId = state.queue.shift();
      if (jobId) await processJob(jobId, deps);
    }
  } finally {
    state.active = false;
  }
}

export interface DepsDuplicataTardia {
  isBrutoDone: (id: string) => boolean;
  parseMediaUrl: (url: string) => { id: string } | null;
}

/**
 * Link curto (vm./vt.tiktok.com) não expõe ID na URL — o dedupe de
 * `POST /api/videos` (que roda ANTES do enqueue) não tem o que comparar e
 * deixa passar. Só depois do yt-dlp rodar (etapa metadata) o ID real aparece,
 * e só então dá para saber que é o mesmo vídeo de um job já `done`. Sem isso,
 * cada link curto repetido baixava áudio, transcrevia e resumia tudo de novo
 * à toa.
 *
 * Isolado ao caso em que a URL original não tinha ID extraível: um job de
 * reprocessamento intencional (`/api/videos/[id]/retry`) sempre reenfileira a
 * URL canônica (já com o ID real), então nunca cai aqui — `parseMediaUrl`
 * devolve o ID de cara e a função retorna `false`.
 */
export function ehDuplicataTardia(
  jobUrl: string,
  metaId: string,
  deps: DepsDuplicataTardia = { isBrutoDone, parseMediaUrl },
): boolean {
  const idJaEraConhecidoNoEnqueue = deps.parseMediaUrl(jobUrl)?.id !== "";
  return !idJaEraConhecidoNoEnqueue && deps.isBrutoDone(metaId);
}

export interface DepsDuplicataAtivaTardia {
  parseMediaUrl: (url: string) => { id: string } | null;
  getJobAtivoDoVideo: (id: string, excetoJobId?: string) => { id: string } | null;
}

/** Mensagem de contrato do job cancelado por duplicata ativa (Q5). */
export const MENSAGEM_DUPLICADO_ATIVO = "Duplicado: este vídeo já está sendo processado em outro job";

/**
 * Irmã da `ehDuplicataTardia` para o caso ATIVO: o link curto descobre, depois
 * da etapa metadata, que o ID real já está sendo processado por OUTRO job
 * (queued/running) — este job se encerra como `canceled` (não `error`, não
 * `done`). Opções diferentes (`forceWhisper`/`translate`) NÃO abrem exceção:
 * duplicata é por identidade do vídeo. `excetoJobId` impede o job de ser
 * duplicata de si mesmo.
 */
export function ehDuplicataAtivaTardia(
  jobUrl: string,
  metaId: string,
  excetoJobId?: string,
  deps: DepsDuplicataAtivaTardia = { parseMediaUrl, getJobAtivoDoVideo },
): boolean {
  const idJaEraConhecidoNoEnqueue = deps.parseMediaUrl(jobUrl)?.id !== "";
  return !idJaEraConhecidoNoEnqueue && deps.getJobAtivoDoVideo(metaId, excetoJobId) !== null;
}

export interface DepsSincronizarTitulo {
  getBrutoById: (id: string) => { title: string } | null;
}

/**
 * Repõe `meta.title` com o título ATUAL do banco antes do resto do pipeline
 * rodar. `persistMetadata` NUNCA toca no título num reprocessamento (ver
 * `01-metadata.ts`) — sem isto, um vídeo já classificado antes (com um título
 * bom já confirmado) teria os prompts de resumo/categoria/tags desta passada
 * avaliando o título CRU do yt-dlp como "o original", e a IA podia então
 * SOBRESCREVER o título bom com uma reescrita do texto cru (achado do Grok,
 * 10ª rodada — efeito colateral do achado da rodada anterior).
 */
export function sincronizarTituloComBanco(
  meta: VideoMetadata,
  deps: DepsSincronizarTitulo = { getBrutoById },
): void {
  const atual = deps.getBrutoById(meta.id);
  if (atual) meta.title = atual.title;
}

export interface DepsProcessJob {
  fetchMetadata: (url: string) => Promise<VideoMetadata>;
  persistMetadata: (meta: VideoMetadata) => Promise<void>;
}

/**
 * Executa o pipeline completo de um job. Erros viram estado `error` tipado;
 * cancelamento vira estado `canceled` (o que já foi salvo, salva fica).
 *
 * `deps` tem default de produção (`fetchMetadata`/`persistMetadata` reais) e
 * só existe para o teste conseguir provar, sem indireção, que o atalho de
 * duplicata tardia NUNCA chama `persistMetadata` — sem isso não dava para
 * verificar "o banco não foi tocado" sem depender de um yt-dlp de verdade.
 *
 * corrida cancelar×terminar (INVARIANTE D): todas as transições de estado são
 * escritas guarded e sem await no meio — em JS single-threaded isso as torna
 * atômicas entre o cancelador e o pipeline. Ou o cancelamento grava
 * `canceled` primeiro (e a transição queued→running do pipeline no-opa, ou o
 * catch vira `canceled`), ou o pipeline grava `done`/`error` primeiro (e o
 * cancelador devolve o estado real). Nunca os dois.
 */
export async function processJob(
  jobId: string,
  deps: DepsProcessJob = { fetchMetadata, persistMetadata },
): Promise<void> {
  const job = db.select().from(jobs).where(eq(jobs.id, jobId)).get();
  if (!job) return;
  if (job.status === "canceled") return; // cancelado enquanto esperava a vez

  // Controller ANTES da escrita de `running`: quem lê `running` no banco pode
  // confiar que este processo TEM o controller do job.
  const controller = new AbortController();
  state.cancelamentos.set(jobId, controller);
  let assentar!: () => void;
  const assentou = new Promise<void>((resolve) => {
    assentar = resolve;
  });
  state.finalizacoes.set(jobId, assentou);
  try {
    // Transição queued→running GUARDED: se um cancelamento de queued ganhou a
    // corrida, o UPDATE não altera nada (changes = 0) e o job NUNCA roda.
    const transicao = db
      .update(jobs)
      .set({ status: "running", startedAt: new Date(), progressPct: 2 })
      .where(and(eq(jobs.id, jobId), ne(jobs.status, "canceled")))
      .run();
    if (transicao.changes === 0) return;
    emitirJob(jobId);

    await rodarComCancelamento(
      { jobId, signal: controller.signal },
      () => executarJob(jobId, job, controller.signal, deps),
    );
  } finally {
    state.cancelamentos.delete(jobId);
    state.finalizacoes.delete(jobId);
    assentar();
  }
}

/**
 * O corpo do pipeline, sempre dentro do contexto de cancelamento do job:
 * cada await longo é seguido de `recusarSeCancelado` — cancelar no meio de
 * uma etapa encerra o job NA PRÓXIMA fronteira, nunca grava `done` depois.
 */
async function executarJob(
  jobId: string,
  job: Job,
  signal: AbortSignal,
  deps: DepsProcessJob,
): Promise<void> {
  try {
    recusarSeCancelado(signal);

    // 1) metadata — só a BUSCA (--dump-json); nada de disco/banco ainda. É a
    // checagem de duplicata tardia logo abaixo que decide se vale a pena
    // persistir (ver comentário de `persistMetadata` em `01-metadata.ts`).
    update(jobId, { currentStep: "metadata", progressPct: 5 });
    const meta: VideoMetadata = await deps.fetchMetadata(job.url);
    recusarSeCancelado(signal);

    if (ehDuplicataTardia(job.url, meta.id)) {
      update(jobId, {
        videoId: meta.id,
        status: "done",
        currentStep: null,
        progressPct: 100,
        finishedAt: new Date(),
        errorCode: null,
        errorMessage: null,
      });
      return;
    }

    if (ehDuplicataAtivaTardia(job.url, meta.id, jobId)) {
      // Link curto que desemboca num vídeo JÁ na fila/em execução em outro
      // job: este se encerra como canceled, SEM persistir nada (não há
      // `brutos` para criar — o outro job é quem está criando).
      update(jobId, {
        status: "canceled",
        currentStep: null,
        finishedAt: new Date(),
        errorCode: null,
        errorMessage: MENSAGEM_DUPLICADO_ATIVO,
      });
      return;
    }

    await deps.persistMetadata(meta);
    recusarSeCancelado(signal);
    update(jobId, { videoId: meta.id });

    sincronizarTituloComBanco(meta);

    // 2) transcript
    update(jobId, { currentStep: "transcript", progressPct: 15 });
    const transcript = await runTranscript(job.url, meta, {
      forceWhisper: job.forceWhisper ?? false,
      onTick: (pct) => {
        // Mapeia 0-100 da etapa para a faixa global 15-45%.
        update(jobId, { progressPct: 15 + Math.round((pct / 100) * 30) });
      },
    });
    recusarSeCancelado(signal);

    // 2.5) translate (opcional): vídeo não-PT + pedido de tradução
    if ((job.translate ?? false) && !transcript.isPortuguese) {
      update(jobId, { currentStep: "translate", progressPct: 46 });
      await runTranslate(meta, transcript.timestampedText, (pct) => {
        update(jobId, { progressPct: 46 + Math.round((pct / 100) * 8) });
      });
      recusarSeCancelado(signal);
    }

    // 3) summary
    update(jobId, { currentStep: "summary", progressPct: 55 });
    const summaryMd = await runSummary(meta, transcript.text);
    recusarSeCancelado(signal);

    // 4) mindmap
    update(jobId, { currentStep: "mindmap", progressPct: 66 });
    const mindmapMd = await runMindmap(meta, transcript.text);
    recusarSeCancelado(signal);

    // 5) category (+ tags + título mais fiel)
    update(jobId, { currentStep: "category", progressPct: 74 });
    const categoryResult = await runCategory(meta, transcript.text, summaryMd);
    recusarSeCancelado(signal);
    // O passo 05 já gravou o título novo no banco — sem isto, o export (passo
    // 6, logo abaixo) usaria o `meta.title` capturado ANTES da classificação,
    // e o PDF/DOCX sairia com o título velho enquanto o banco já tem o novo.
    if (categoryResult.titleSuggestion) {
      meta.title = categoryResult.titleSuggestion;
    }

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
    recusarSeCancelado(signal);

    // Sem await entre este checkpoint e o write: o `done` só entra se o job
    // não estava cancelado NO INSTANTE da escrita — nunca depois dela.
    update(jobId, {
      status: "done",
      currentStep: null,
      progressPct: 100,
      finishedAt: new Date(),
      errorCode: null,
      errorMessage: null,
    });
  } catch (err) {
    if (signal.aborted) {
      // O cancelamento é a CAUSA da exceção (filho morto, fetch abortado,
      // checkpoint entre etapas): terminal é `canceled`, não `error`.
      update(jobId, {
        status: "canceled",
        currentStep: null,
        finishedAt: new Date(),
        errorCode: null,
        errorMessage: null,
      });
      return;
    }
    const code: ErrorCode = err instanceof PipelineError ? err.code : "UNKNOWN";
    // A ÚLTIMA fronteira antes do banco. As camadas de cima já redigem, mas é
    // esta linha que PERSISTE — e o que é persistido não se corrige depois. Uma
    // exceção vinda de caminho que ninguém previu (biblioteca de terceiro, erro
    // de rede com URL) morre aqui, não em `jobs.error_message`.
    const message = redact(err instanceof Error ? err.message : String(err));
    update(jobId, {
      status: "error",
      errorCode: code,
      errorMessage: message,
      finishedAt: new Date(),
    });
  }
}

export type ResultadoCancelamento =
  | { resultado: "cancelado" }
  | { resultado: "inexistente" }
  | { resultado: "terminal"; status: JobStatus };

/**
 * Cancela um job (Q1–Q3). `queued`: sai da fila na hora e vira `canceled`.
 * `running`: aborta o controller — processos filhos daquele job morrem, o
 * fetch de LLM em andamento é abortado e o runner grava `canceled` na
 * primeira fronteira. `done`/`error`/`canceled`: estado terminal é terminal,
 * devolve o estado real (idempotência EXPLÍCITA, sem 200 silencioso).
 *
 * Na corrida com o término do job, ESPERA o job assentar e devolve o estado
 * que ficou no banco — um dos dois, nunca os dois.
 */
export async function cancelarJob(jobId: string): Promise<ResultadoCancelamento> {
  for (;;) {
    const job = db.select().from(jobs).where(eq(jobs.id, jobId)).get();
    if (!job) return { resultado: "inexistente" };
    const status = job.status as JobStatus;

    if (status === "done" || status === "error" || status === "canceled") {
      return { resultado: "terminal", status };
    }

    if (status === "queued") {
      state.queue = state.queue.filter((id) => id !== jobId);
      const escrita = db
        .update(jobs)
        .set({
          status: "canceled",
          currentStep: null,
          errorCode: null,
          errorMessage: null,
          finishedAt: new Date(),
        })
        .where(and(eq(jobs.id, jobId), eq(jobs.status, "queued")))
        .run();
      if (escrita.changes > 0) {
        emitirJob(jobId);
        return { resultado: "cancelado" };
      }
      continue; // perdeu a corrida com o drain — reavalia o estado novo
    }

    // running
    const controller = state.cancelamentos.get(jobId);
    if (!controller) {
      // `running` no banco sem controller NESTE processo: nada daqui está
      // executando (sobrou de crash/boot) — marca direto, ainda guarded.
      const escrita = db
        .update(jobs)
        .set({
          status: "canceled",
          currentStep: null,
          errorCode: null,
          errorMessage: null,
          finishedAt: new Date(),
        })
        .where(and(eq(jobs.id, jobId), eq(jobs.status, "running")))
        .run();
      if (escrita.changes > 0) {
        emitirJob(jobId);
        return { resultado: "cancelado" };
      }
      continue; // terminou justo agora — reavalia
    }

    controller.abort();
    const assentou = state.finalizacoes.get(jobId);
    if (assentou) await assentou;
    const fim = db.select({ status: jobs.status }).from(jobs).where(eq(jobs.id, jobId)).get();
    const statusFinal = (fim?.status ?? job.status) as JobStatus;
    return statusFinal === "canceled"
      ? { resultado: "cancelado" }
      : { resultado: "terminal", status: statusFinal };
  }
}

/**
 * No boot do servidor, jobs que ficaram `running` (crash/restart) voltam para
 * `queued` e são re-enfileirados — nenhum job fica preso. `canceled` é
 * terminal: o boot NÃO ressuscita.
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
    if (row && (row.status === "done" || row.status === "error" || row.status === "canceled")) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  return jobId;
}
