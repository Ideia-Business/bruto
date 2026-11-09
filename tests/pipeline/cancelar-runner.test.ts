/**
 * Cancelamento no nível do RUNNER (src/pipeline/runner.ts) — fila em memória,
 * banco real num tmpdir (mesmo padrão de tests/pipeline/runner.test.ts), deps
 * injetadas para nunca lançar yt-dlp/whisper de verdade.
 *
 * Truque de isolamento: a fila serial (`drain`) é TRAVADA
 * (`__resumeVideoRunner.active = true`) antes de qualquer `enqueue`, para o
 * teste controlar QUANDO a fila anda — e andar só com deps falsas. Sem isso,
 * `enqueue` dispararia `drain()` com as deps de produção e o teste lançaria
 * yt-dlp de verdade (instalado nesta máquina — e proibido tocar rede).
 */
import { test, describe, before, after } from "node:test";
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
let cancelarJob: typeof import("@/pipeline/runner").cancelarJob;
let recoverOrphans: typeof import("@/pipeline/runner").recoverOrphans;
let ehDuplicataAtivaTardia: typeof import("@/pipeline/runner").ehDuplicataAtivaTardia;
let getJobAtivoDoVideo: typeof import("@/db/queries").getJobAtivoDoVideo;
let isBrutoDone: typeof import("@/db/queries").isBrutoDone;
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
  dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bruto-cancelar-runner-"));
  process.env.BRUTO_DATA_ROOT = dataRoot;
  execFileSync("npm", ["run", "db:migrate"], {
    cwd: RAIZ,
    env: { ...process.env, BRUTO_DATA_ROOT: dataRoot },
    stdio: "pipe",
  });

  ({ enqueue, processJob, drain, cancelarJob, recoverOrphans, ehDuplicataAtivaTardia } =
    await import("@/pipeline/runner"));
  ({ getJobAtivoDoVideo, isBrutoDone } = await import("@/db/queries"));
  ({ db } = await import("@/db/client"));
  ({ brutos, jobs: jobsTable } = await import("@/db/schema"));
  ({ eq, inArray } = await import("drizzle-orm"));

  filaDoRunner().active = true; // trava: nenhum drain automático neste arquivo
});

after(() => {
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

function semearBruto(id: string, url = `https://exemplo.test/${id}`): void {
  db.insert(brutos)
    .values({ id, url, platform: "youtube", title: `Vídeo ${id}`, createdAt: new Date() })
    .run();
}

function semearJob(opts: {
  id: string;
  url: string;
  status: string;
  videoId?: string | null;
  forceWhisper?: boolean;
  translate?: boolean;
}): void {
  db.insert(jobsTable)
    .values({
      id: opts.id,
      videoId: opts.videoId ?? null,
      url: opts.url,
      status: opts.status,
      progressPct: opts.status === "done" ? 100 : 0,
      forceWhisper: opts.forceWhisper ?? false,
      translate: opts.translate ?? false,
      createdAt: new Date(),
      ...(opts.status === "done" ? { finishedAt: new Date() } : {}),
    })
    .run();
}

function statusDoJob(id: string): string | undefined {
  return db.select({ status: jobsTable.status }).from(jobsTable).where(eq(jobsTable.id, id)).get()?.status;
}

function jobRow(id: string) {
  return db.select().from(jobsTable).where(eq(jobsTable.id, id)).get();
}

function dormir(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─────────────────────────────────────────────────────────────────────────────

describe("(a) cancelar job queued", () => {
  test("sai da fila na hora, vira canceled, drain NÃO o processa e o próximo job segue", async () => {
    const urlA = "https://www.youtube.com/watch?v=aaaaaaaaaaa";
    const urlB = "https://vm.tiktok.com/ZMjobB/"; // link curto → atalho done controlável
    const idRealB = "bbbbbbbbbbb";

    const jobA = enqueue(urlA);
    const jobB = enqueue(urlB);
    assert.equal(statusDoJob(jobA), "queued");
    assert.equal(statusDoJob(jobB), "queued");

    const r = await cancelarJob(jobA);
    assert.deepEqual(r, { resultado: "cancelado" });
    assert.equal(statusDoJob(jobA), "canceled");
    assert.ok(jobRow(jobA)?.finishedAt, "cancelamento grava finishedAt");
    assert.ok(!filaDoRunner().queue.includes(jobA), "job cancelado sai da fila em memória");

    // Vídeo do job B já está done → o atalho de duplicata tardia fecha o job
    // sem tocar em yt-dlp: é assim que o teste prova que a fila ANDOU até o B.
    semearBruto(idRealB, `https://www.tiktok.com/@p/video/${idRealB}`);
    semearJob({ id: "job-done-b", url: urlB, status: "done", videoId: idRealB });

    const chamadas: string[] = [];
    filaDoRunner().active = false;
    await drain({
      fetchMetadata: async (url) => {
        chamadas.push(url);
        return metaFake(idRealB, "B via atalho");
      },
      persistMetadata: async () => {
        throw new Error("atalho de duplicata tardia não deve persistir");
      },
    });
    filaDoRunner().active = true;

    assert.deepEqual(chamadas, [urlB], "drain processa só o B — o A cancelado não pode rodar");
    assert.equal(statusDoJob(jobA), "canceled", "A permanece canceled após o drain");
    assert.equal(statusDoJob(jobB), "done", "o próximo job seguiu e terminou");
  });

  test("processJob pula job cancelado mesmo se ele ainda estiver na fila (redexão de corrida)", async () => {
    const jobX = enqueue("https://www.youtube.com/watch?v=xxxxxxxxxxx");
    filaDoRunner().queue.push(jobX); // simula: cancelamento e drain disputaram o job

    const r = await cancelarJob(jobX);
    assert.equal(r.resultado, "cancelado");
    filaDoRunner().queue.push(jobX); // reenfileirado por fora — não pode rodar

    let chamou = false;
    await processJob(jobX, {
      fetchMetadata: async () => {
        chamou = true;
        return metaFake("xxxxxxxxxxx");
      },
      persistMetadata: async () => {},
    });
    assert.equal(chamou, false, "job canceled no banco não pode executar etapa nenhuma");
    assert.equal(statusDoJob(jobX), "canceled");
  });
});

describe("(e) duplicata tardia contra job ATIVO (link curto)", () => {
  const MSG = "Duplicado: este vídeo já está sendo processado em outro job";

  test("job ativo queued com videoId null (id pela URL) → canceled com a mensagem, SEM persistMetadata", async () => {
    // ID numérico: é o formato que o parser do TikTok extrai de /video/<id>
    const idReal = "7111111111111111111";
    const urlCanonica = `https://www.tiktok.com/@p/video/${idReal}`;
    semearJob({ id: "job-ativo-1", url: urlCanonica, status: "queued" });

    const jobCurto = "job-curto-1";
    semearJob({ id: jobCurto, url: "https://vm.tiktok.com/ZMcurto1/", status: "queued" });

    let persistiu = false;
    await processJob(jobCurto, {
      fetchMetadata: async () => metaFake(idReal, "título cru do yt-dlp"),
      persistMetadata: async () => {
        persistiu = true;
      },
    });

    const row = jobRow(jobCurto);
    assert.equal(row?.status, "canceled");
    assert.equal(row?.errorMessage, MSG);
    assert.equal(row?.errorCode, null);
    assert.equal(persistiu, false, "o caminho de duplicata NUNCA persiste metadata");
  });

  test("job ativo running com videoId preenchido → canceled (identidade por videoId)", async () => {
    const idReal = "7222222222222222222";
    semearBruto(idReal);
    semearJob({
      id: "job-ativo-2",
      url: `https://www.tiktok.com/@p/video/${idReal}`,
      status: "running",
      videoId: idReal,
    });

    const jobCurto = "job-curto-2";
    semearJob({ id: jobCurto, url: "https://vt.tiktok.com/ZMcurto2/", status: "queued" });

    await processJob(jobCurto, {
      fetchMetadata: async () => metaFake(idReal),
      persistMetadata: async () => {},
    });
    assert.equal(jobRow(jobCurto)?.status, "canceled");
    assert.equal(jobRow(jobCurto)?.errorMessage, MSG);
  });

  test("opções diferentes (forceWhisper/translate) NÃO abrem exceção — duplicata é por identidade", async () => {
    const idReal = "7333333333333333333";
    semearJob({
      id: "job-ativo-3",
      url: `https://www.tiktok.com/@p/video/${idReal}`,
      status: "queued",
      forceWhisper: false,
      translate: false,
    });

    const jobCurto = "job-curto-3";
    semearJob({
      id: jobCurto,
      url: "https://vm.tiktok.com/ZMcurto3/",
      status: "queued",
      forceWhisper: true,
      translate: true,
    });

    await processJob(jobCurto, {
      fetchMetadata: async () => metaFake(idReal),
      persistMetadata: async () => {},
    });
    assert.equal(jobRow(jobCurto)?.status, "canceled", "mesmo com outras opções, é duplicata");
  });

  test("não é duplicata de SI MESMO: o próprio job (rodando com videoId null) não se cancela", async () => {
    const idReal = "7444444444444444444";
    const urlCanonica = `https://www.tiktok.com/@p/video/${idReal}`;
    const jobUnico = "job-unico-1";
    semearJob({ id: jobUnico, url: urlCanonica, status: "queued" });

    // O job é o ÚNICO ativo do vídeo (identidade pela própria URL). O corte do
    // teste vem DEPOIS das checagens de duplicata: persistMetadata é chamado
    // (prova que o pipeline seguiu) e lança, encerrando como `error` — nunca
    // `canceled`. Sem esse corte, o teste chamaria yt-dlp de verdade.
    let persistiu = false;
    await processJob(jobUnico, {
      fetchMetadata: async () => metaFake(idReal),
      persistMetadata: async () => {
        persistiu = true;
        throw new Error("cortado pelo teste após as checagens de duplicata");
      },
    });
    assert.equal(persistiu, true, "job único segue o pipeline — não se cancela como duplicata de si");
    assert.equal(jobRow(jobUnico)?.status, "error", "terminou pelo corte do teste, não como canceled");
  });
});

describe("ehDuplicataAtivaTardia — deps injetadas (sem banco)", () => {
  // Vídeo "123" tem DOIS jobs ativos (o próprio "job-1" e "outro-job");
  // vídeo "789" tem SÓ o próprio "job-1" — o caso "não sou duplicata de mim".
  const JOBS_ATIVOS: Record<string, string[]> = {
    "123": ["job-1", "outro-job"],
    "789": ["job-1"],
  };
  const deps = {
    parseMediaUrl: (url: string) => {
      const m = /tiktok\.com\/video\/(\d+)/.exec(url);
      return m ? { id: m[1] } : { id: "" };
    },
    getJobAtivoDoVideo: (id: string, excetoJobId?: string) => {
      const ativos = (JOBS_ATIVOS[id] ?? []).filter((job) => job !== excetoJobId);
      return ativos.length > 0 ? { id: ativos[0] } : null;
    },
  };

  test("link curto + id ativo em outro job → true", () => {
    assert.equal(ehDuplicataAtivaTardia("https://vm.tiktok.com/ZMx/", "123", "job-1", deps), true);
  });

  test("link curto + id livre → false", () => {
    assert.equal(ehDuplicataAtivaTardia("https://vm.tiktok.com/ZMx/", "456", "job-1", deps), false);
  });

  test("o único job ativo é o PRÓPRIO (excetoJobId) → false — não é duplicata de si", () => {
    assert.equal(ehDuplicataAtivaTardia("https://vm.tiktok.com/ZMx/", "789", "job-1", deps), false);
  });

  test("URL com ID conhecido nunca cai aqui (o dedupe dela é antes do enqueue)", () => {
    assert.equal(
      ehDuplicataAtivaTardia("https://www.tiktok.com/video/123", "123", "job-1", deps),
      false,
    );
  });
});

describe("(f) INVARIANTE D — estado terminal é terminal", () => {
  test("recoverOrphans NÃO ressuscita job canceled (só running/queued voltam)", () => {
    // O banco é compartilhado entre os testes do arquivo: o "antes" captura o
    // que já estava ativo, e o que conta é o DELTA (running e queued contam,
    // canceled não) — e o estado final de cada job.
    const ativosAntes = db
      .select({ id: jobsTable.id })
      .from(jobsTable)
      .where(inArray(jobsTable.status, ["queued", "running"]))
      .all().length;

    semearJob({ id: "job-canceled-boot", url: "https://exemplo.test/c1", status: "canceled" });
    semearJob({ id: "job-running-boot", url: "https://exemplo.test/r1", status: "running" });
    semearJob({ id: "job-queued-boot", url: "https://exemplo.test/q1", status: "queued" });

    const n = recoverOrphans();
    assert.equal(n, ativosAntes + 2, "canceled NÃO conta como órfão; running e queued sim");
    assert.equal(statusDoJob("job-canceled-boot"), "canceled", "canceled continua canceled");
    assert.equal(statusDoJob("job-running-boot"), "queued");
    assert.equal(statusDoJob("job-queued-boot"), "queued");
    assert.ok(
      !filaDoRunner().queue.includes("job-canceled-boot"),
      "canceled não pode voltar para a fila em memória",
    );
  });

  test("corrida cancelar×terminar — cancelamento chega DEPOIS do done: vence o done, e a resposta é o estado real", async () => {
    const idReal = "corrida1";
    semearBruto(idReal);
    semearJob({ id: "job-done-corrida1", url: `https://exemplo.test/${idReal}`, status: "done", videoId: idReal });

    const job = "job-corrida-1";
    semearJob({ id: job, url: "https://vm.tiktok.com/ZMcorrida1/", status: "queued" });

    const promessa = processJob(job, {
      fetchMetadata: async () => {
        await dormir(50);
        return metaFake(idReal);
      },
      persistMetadata: async () => {},
    });
    await promessa; // terminou (atalho done) ANTES do cancelamento
    assert.equal(statusDoJob(job), "done");

    const r = await cancelarJob(job);
    assert.deepEqual(r, { resultado: "terminal", status: "done" });
    assert.equal(statusDoJob(job), "done", "done é terminal — cancelamento tardio não muda nada");
  });

  test("corrida cancelar×terminar — cancelamento chega DURANTE a etapa: vira canceled, NUNCA done", async () => {
    const idReal = "corrida2";
    semearBruto(idReal);
    semearJob({ id: "job-done-corrida2", url: `https://exemplo.test/${idReal}`, status: "done", videoId: idReal });

    const job = "job-corrida-2";
    semearJob({ id: job, url: "https://vm.tiktok.com/ZMcorrida2/", status: "queued" });

    const promessa = processJob(job, {
      fetchMetadata: async () => {
        await dormir(400); // a etapa demora; o cancelamento chega no meio
        return metaFake(idReal); // …e o resultado chegaria DEPOIS
      },
      persistMetadata: async () => {},
    });
    await dormir(100); // job já está running
    const r = await cancelarJob(job);
    await promessa;

    assert.deepEqual(r, { resultado: "cancelado" }, "a rota devolve o estado real: canceled");
    assert.equal(statusDoJob(job), "canceled", "um dos dois estados — e só um");
    assert.notEqual(statusDoJob(job), "done");
    assert.equal(jobRow(job)?.errorMessage, null, "cancelamento manual não é erro");
    assert.equal(jobRow(job)?.errorCode, null);
  });

  test("cancelar job running órfão (running no banco, sem controller neste processo) → canceled direto", async () => {
    const job = "job-orfao-running";
    semearJob({ id: job, url: "https://exemplo.test/orfao", status: "running" });
    const r = await cancelarJob(job);
    assert.equal(r.resultado, "cancelado");
    assert.equal(statusDoJob(job), "canceled");
  });
});

describe("(h) isBrutoDone só enxerga done", () => {
  test("vídeo com job canceled NÃO está done (o vídeo não conta como concluído)", () => {
    const id = "hhhhhhhhhhh";
    semearBruto(id);
    semearJob({ id: "job-cancelado-h", url: `https://exemplo.test/${id}`, status: "canceled", videoId: id });
    assert.equal(isBrutoDone(id), false);
  });

  test("controle: com job done continua true (comportamento de sempre)", () => {
    const id = "h2h2h2h2h2h";
    semearBruto(id);
    semearJob({ id: "job-done-h2", url: `https://exemplo.test/${id}`, status: "done", videoId: id });
    assert.equal(isBrutoDone(id), true);
  });
});

describe("(c/INVARIANTE C) getJobAtivoDoVideo — identidade do vídeo, não a string da URL", () => {
  const ID = "dQw4w9WgXcQ";

  test("youtu.be × watch?v= × shorts do MESMO vídeo são a MESMA identidade", () => {
    semearBruto(ID, `https://www.youtube.com/watch?v=${ID}`);
    // job queued, videoId null: a identidade vem da URL dele
    semearJob({ id: "job-c3-1", url: `https://youtu.be/${ID}`, status: "queued" });
    assert.ok(getJobAtivoDoVideo(ID), "mesmo vídeo, forma diferente de URL → achou o job ativo");

    // job running com videoId preenchido: identidade vem do videoId
    semearJob({ id: "job-c3-2", url: `https://www.youtube.com/shorts/${ID}`, status: "running", videoId: ID });
    assert.ok(getJobAtivoDoVideo(ID), "shorts/running também resolve");
  });

  test("vídeo diferente → null", () => {
    assert.equal(getJobAtivoDoVideo("outroVideoAA"), null);
  });

  test("excetoJobId exclui o próprio job", () => {
    // tirando o job-c3-1, ainda há o job-c3-2 — e vice-versa
    assert.equal(getJobAtivoDoVideo(ID, "job-c3-1")?.id, "job-c3-2");
    assert.equal(getJobAtivoDoVideo(ID, "job-c3-2")?.id, "job-c3-1");
  });

  test("job done/error/canceled não é ativo", () => {
    const id = "zXzXzXzXzXz";
    semearBruto(id);
    semearJob({ id: "job-c3-done", url: `https://youtu.be/${id}`, status: "done", videoId: id });
    semearJob({ id: "job-c3-err", url: `https://youtu.be/${id}`, status: "error", videoId: id });
    semearJob({ id: "job-c3-canc", url: `https://youtu.be/${id}`, status: "canceled", videoId: id });
    assert.equal(getJobAtivoDoVideo(id), null);
  });
});
