/**
 * O encerramento visto pelo RUNNER (src/pipeline/runner.ts) — os dois lados
 * da INVARIANTE 3 do ciclo desenhado em src/lib/encerrar.ts:
 *
 *   [P1, r4] com a marca de encerramento ligada, a etapa cujo filho foi
 *   morto pela limpeza rejeita — e o job NÃO pode virar `error` nem
 *   `canceled`: fica `running` no banco para o `recoverOrphans()` do próximo
 *   boot re-enfileirar (a promessa do botão: "vídeos que estiverem
 *   processando retomam"). E a fila (drain) não começa job novo com a marca
 *   ligada — começar seria só criar mais um job interrompido no meio.
 *
 * Mesmo padrão de tests/pipeline/cancelar-runner.test.ts: banco real num
 * tmpdir, fila TRAVADA (`__resumeVideoRunner.active = true`) para nenhum
 * drain automático lançar yt-dlp de verdade, deps falsas.
 */
import { test, describe, before, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const RAIZ = process.cwd();

let dataRoot: string;
let enqueue: typeof import("@/pipeline/runner").enqueue;
let processJob: typeof import("@/pipeline/runner").processJob;
let drain: typeof import("@/pipeline/runner").drain;
let recoverOrphans: typeof import("@/pipeline/runner").recoverOrphans;
let marcarEncerramento: typeof import("@/pipeline/lib/marca-de-encerramento").marcarEncerramento;
let resetarMarcaDeEncerramentoParaTestes: typeof import("@/pipeline/lib/marca-de-encerramento").resetarMarcaDeEncerramentoParaTestes;
let db: typeof import("@/db/client").db;
let brutos: typeof import("@/db/schema").brutos;
let jobsTable: typeof import("@/db/schema").jobs;
let eq: typeof import("drizzle-orm").eq;
let inArray: typeof import("drizzle-orm").inArray;

type VideoMetadata = import("@/pipeline/types").VideoMetadata;

function metaFake(id: string, title = `Vídeo ${id}`): VideoMetadata {
  return {
    id,
    url: `https://exemplo.test/${id}`,
    platform: "youtube",
    title,
    channel: null,
    durationSec: null,
    uploadDate: null,
    language: null,
    description: null,
    chapters: [],
    tags: [],
    subtitleLangs: [],
    autoCaptionLangs: [],
    thumbnailUrl: null,
  };
}

/** A fila serial em globalThis — o mesmo objeto que o runner usa. */
function filaDoRunner(): { queue: string[]; active: boolean } {
  const g = globalThis as unknown as { __resumeVideoRunner?: { queue: string[]; active: boolean } };
  assert.ok(g.__resumeVideoRunner, "estado do runner deveria existir após o import");
  return g.__resumeVideoRunner;
}

before(async () => {
  dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bruto-encerrar-runner-"));
  process.env.BRUTO_DATA_ROOT = dataRoot;
  execFileSync("npm", ["run", "db:migrate"], {
    cwd: RAIZ,
    env: { ...process.env, BRUTO_DATA_ROOT: dataRoot },
    stdio: "pipe",
  });

  ({ enqueue, processJob, drain, recoverOrphans } = await import("@/pipeline/runner"));
  ({ marcarEncerramento, resetarMarcaDeEncerramentoParaTestes } = await import(
    "@/pipeline/lib/marca-de-encerramento"
  ));
  ({ db } = await import("@/db/client"));
  ({ brutos, jobs: jobsTable } = await import("@/db/schema"));
  ({ eq, inArray } = await import("drizzle-orm"));

  filaDoRunner().active = true; // trava: nenhum drain automático neste arquivo
});

afterEach(() => {
  // A marca é "por processo" e o processo real nunca a desliga (sai com
  // exit). Aqui cada teste é um processo novo: devolve a marca, esvazia a
  // fila em memória e volta a travá-la — nenhum teste herda estado de outro.
  resetarMarcaDeEncerramentoParaTestes();
  filaDoRunner().queue.length = 0;
  filaDoRunner().active = true;
});

after(() => {
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

function semearBruto(id: string, url = `https://exemplo.test/${id}`): void {
  db.insert(brutos)
    .values({ id, url, platform: "youtube", title: `Vídeo ${id}`, createdAt: new Date() })
    .run();
}

function semearJob(opts: { id: string; url: string; status: string; videoId?: string | null }): void {
  db.insert(jobsTable)
    .values({
      id: opts.id,
      videoId: opts.videoId ?? null,
      url: opts.url,
      status: opts.status,
      progressPct: opts.status === "done" ? 100 : 0,
      createdAt: new Date(),
      ...(opts.status === "done" ? { finishedAt: new Date() } : {}),
    })
    .run();
}

function statusDoJob(id: string): string | undefined {
  return db.select({ status: jobsTable.status }).from(jobsTable).where(eq(jobsTable.id, id)).get()?.status;
}

function dormir(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─────────────────────────────────────────────────────────────────────────────

describe("[P1] job interrompido pelo encerramento continua recuperável", () => {
  test("etapa que rejeita com a marca ligada NÃO vira error/canceled: fica running e o recoverOrphans() do próximo boot o re-enfileira", async () => {
    const jobId = "job-p1-retoma";
    semearJob({ id: jobId, url: "https://www.youtube.com/watch?v=p1retoma000", status: "queued" });

    // A cena real do achado: o passo (b) do ciclo mata o yt-dlp/whisper com o
    // event loop vivo → a promessa da etapa rejeita → o catch do runner vê
    // signal.aborted FALSO (o usuário não cancelou nada; o AbortController do
    // job nem sabe do encerramento). O que decide é a marca do passo (a).
    await processJob(jobId, {
      fetchMetadata: async () => {
        marcarEncerramento(); // o passo (a) disparou enquanto a etapa corria
        throw new Error("yt-dlp morto pelo encerramento (filho rejeitou)");
      },
      persistMetadata: async () => {},
    });

    const status = statusDoJob(jobId);
    assert.notEqual(status, "error", "falha causada pelo encerramento não é erro do vídeo");
    assert.notEqual(status, "canceled", "ninguém cancelou — é o app fechando");
    assert.equal(status, "running", "job fica running (recuperável), como estava no meio da etapa");

    // O próximo boot (processo NOVO, marca apagada) pega ele de volta —
    // é isto que o texto do botão promete.
    resetarMarcaDeEncerramentoParaTestes();
    const ativosAntes = db
      .select({ id: jobsTable.id })
      .from(jobsTable)
      .where(inArray(jobsTable.status, ["running", "queued"]))
      .all().length;
    const n = recoverOrphans(); // fila travada: só semeia, não processa
    assert.equal(n, ativosAntes, "o job interrompido conta como órfão do boot");
    assert.equal(statusDoJob(jobId), "queued", "recoverOrphans o re-enfileira");
    assert.ok(filaDoRunner().queue.includes(jobId), "de volta à fila em memória");
  });

  test("CONTROLE: a MESMA rejeição sem a marca vira error — a marca é o que decide, não qualquer falha", async () => {
    const jobId = "job-erro-normal";
    semearJob({ id: jobId, url: "https://www.youtube.com/watch?v=erronormal1", status: "queued" });

    await processJob(jobId, {
      fetchMetadata: async () => {
        throw new Error("falhou por causa própria (sem encerramento)");
      },
      persistMetadata: async () => {},
    });

    assert.equal(statusDoJob(jobId), "error", "sem a marca, falha da etapa é error como sempre foi");
  });
});

describe("(a) a fila respeita a marca — não inicia job novo", () => {
  test("com a marca ligada no meio do job A, o drain NÃO começa o job B (ele segue queued para o próximo boot)", async () => {
    const urlA = "https://www.youtube.com/watch?v=aaaaaaaaaaa";
    const urlB = "https://www.youtube.com/watch?v=bbbbbbbbbbb";
    const chamadas: string[] = [];

    // Enfileira com a fila TRAVADA (padrão do cancelar-runner): nada anda
    // até o teste destravar e chamar drain com deps falsas.
    const jobA = enqueue(urlA);
    const jobB = enqueue(urlB);
    assert.equal(statusDoJob(jobA), "queued");
    assert.equal(statusDoJob(jobB), "queued");

    filaDoRunner().active = false;
    try {
      await drain({
        // A etapa de A marca o encerramento (passo (a) disparou enquanto A
        // corria) e rejeita (o filho de A foi morto pelo passo (b)) — B não
        // pode nem começar.
        fetchMetadata: async (url) => {
          chamadas.push(url);
          marcarEncerramento();
          throw new Error("interrompido pelo encerramento");
        },
        persistMetadata: async () => {},
      });
    } finally {
      filaDoRunner().active = true;
    }

    assert.deepEqual(chamadas, [urlA], "só o job A rodou — B nunca começou");
    assert.equal(statusDoJob(jobA), "running", "A interrompido pelo encerramento: recuperável, não error");
    assert.equal(statusDoJob(jobB), "queued", "B segue queued no banco");
    assert.ok(filaDoRunner().queue.includes(jobB), "B segue na fila em memória para o próximo boot");
  });
});

describe("invariante 3 — os outros dois caminhos do contrato", () => {
  test("job que termina done ANTES do encerramento seguir concluído segue done (a marca não pune quem chegou a tempo)", async () => {
    const idReal = "p1doneAAAAAA";
    semearBruto(idReal);
    semearJob({
      id: "job-done-antes",
      url: `https://exemplo.test/${idReal}`,
      status: "done",
      videoId: idReal,
    });

    const jobId = "job-p1-done";
    semearJob({ id: jobId, url: "https://vm.tiktok.com/ZMp1done/", status: "queued" });

    // A marca liga no MEIO da etapa, mas a etapa completa normal e o atalho
    // de duplicata tardia grava `done` — a marca não transforma retrospecti-
    // vamente um término justo em interrupção.
    await processJob(jobId, {
      fetchMetadata: async () => {
        marcarEncerramento();
        return metaFake(idReal); // terminou por conta própria
      },
      persistMetadata: async () => {},
    });

    assert.equal(statusDoJob(jobId), "done", "quem terminou antes da morte dos filhos fica done");
  });

  test("cancelamento do USUÁRIO com a marca ligada continua canceled (aborted decide antes da marca)", async () => {
    const jobId = "job-cancelado-no-encerramento";
    semearJob({ id: jobId, url: "https://www.youtube.com/watch?v=cancela0000", status: "queued" });
    let cancelarJob: typeof import("@/pipeline/runner").cancelarJob | undefined;

    const promessa = processJob(jobId, {
      fetchMetadata: async () => {
        marcarEncerramento(); // o app está encerrando…
        ({ cancelarJob } = await import("@/pipeline/runner"));
        await dormir(150); // …e a pessoa cancela ESTE vídeo no meio disso
        return metaFake("cancela0000");
      },
      persistMetadata: async () => {},
    });
    await dormir(80);
    assert.ok(cancelarJob, "fetchMetadata já rodou: o import dinâmico completou");
    const r = await cancelarJob(jobId);
    await promessa;

    assert.equal(r.resultado, "cancelado");
    assert.equal(statusDoJob(jobId), "canceled", "signal.aborted vence: é o usuário falando, não o encerramento");
  });
});
