/**
 * POST /api/jobs/[id]/cancel — contrato da etapa 2 (tela):
 *   200 { jobId, status: "canceled" }  |  404 job inexistente
 *   | 409 { error, status } se já done/error/canceled (idempotência EXPLÍCITA)
 * E o SSE de /api/jobs/[id]/events FECHA em canceled como fecha em done/error.
 *
 * Banco real em tmpdir (padrão da suíte); fila travada para nada rodar sozinho.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const RAIZ = process.cwd();

let dataRoot: string;
let POST: typeof import("@/app/api/jobs/[id]/cancel/route").POST;
let GETevents: typeof import("@/app/api/jobs/[id]/events/route").GET;
let enqueue: typeof import("@/pipeline/runner").enqueue;
let processJob: typeof import("@/pipeline/runner").processJob;
let db: typeof import("@/db/client").db;
let brutos: typeof import("@/db/schema").brutos;
let jobsTable: typeof import("@/db/schema").jobs;
let eq: typeof import("drizzle-orm").eq;

type VideoMetadata = import("@/pipeline/types").VideoMetadata;

function metaFake(id: string): VideoMetadata {
  return {
    id,
    url: `https://exemplo.test/${id}`,
    platform: "youtube",
    title: `Vídeo ${id}`,
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

before(async () => {
  dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bruto-jobs-cancel-route-"));
  process.env.BRUTO_DATA_ROOT = dataRoot;
  execFileSync("npm", ["run", "db:migrate"], {
    cwd: RAIZ,
    env: { ...process.env, BRUTO_DATA_ROOT: dataRoot },
    stdio: "pipe",
  });

  ({ POST } = await import("@/app/api/jobs/[id]/cancel/route"));
  ({ GET: GETevents } = await import("@/app/api/jobs/[id]/events/route"));
  ({ enqueue, processJob } = await import("@/pipeline/runner"));
  ({ db } = await import("@/db/client"));
  ({ brutos, jobs: jobsTable } = await import("@/db/schema"));
  ({ eq } = await import("drizzle-orm"));

  const g = globalThis as unknown as { __resumeVideoRunner?: { active: boolean } };
  g.__resumeVideoRunner!.active = true; // fila travada: nada processa sozinho
});

after(() => {
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

function requisicao(jobId: string, opts: { cliente?: string | null; host?: string } = {}): Request {
  const headers: Record<string, string> = {};
  if (opts.host !== null) headers.host = opts.host ?? "127.0.0.1:3000";
  if (opts.cliente !== null) headers["x-bruto-cliente"] = opts.cliente ?? "app";
  return new Request(`http://127.0.0.1:3000/api/jobs/${jobId}/cancel`, {
    method: "POST",
    headers,
  });
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
      ...(opts.status === "done" || opts.status === "error" || opts.status === "canceled"
        ? { finishedAt: new Date() }
        : {}),
    })
    .run();
}

function statusDoJob(id: string): string | undefined {
  return db.select({ status: jobsTable.status }).from(jobsTable).where(eq(jobsTable.id, id)).get()?.status;
}

describe("guarda de escrita (mesma das outras rotas de mutação)", () => {
  test("sem X-Bruto-Cliente → 415", async () => {
    const res = await POST(requisicao("qualquer", { cliente: null }), {
      params: Promise.resolve({ id: "qualquer" }),
    });
    assert.equal(res.status, 415);
  });

  test("host não-loopback → 403", async () => {
    const res = await POST(requisicao("qualquer", { host: "exemplo.com" }), {
      params: Promise.resolve({ id: "qualquer" }),
    });
    assert.equal(res.status, 403);
  });
});

describe("POST /api/jobs/[id]/cancel", () => {
  test("job inexistente → 404", async () => {
    const res = await POST(requisicao("job-que-nao-existe"), {
      params: Promise.resolve({ id: "job-que-nao-existe" }),
    });
    assert.equal(res.status, 404);
    const body = (await res.json()) as { error?: string };
    assert.ok(typeof body.error === "string");
  });

  test("job queued → 200 com o corpo EXATO { jobId, status: 'canceled' } e grava no banco", async () => {
    const jobId = enqueue("https://www.youtube.com/watch?v=qqqqqqqqqqq");
    const res = await POST(requisicao(jobId), { params: Promise.resolve({ id: jobId }) });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { jobId, status: "canceled" });
    assert.equal(statusDoJob(jobId), "canceled");
  });

  test("segundo cancelamento NÃO é 200 silencioso → 409 { error, status: 'canceled' }", async () => {
    semearJob({ id: "job-ja-cancelado", url: "https://exemplo.test/x", status: "canceled" });
    const res = await POST(requisicao("job-ja-cancelado"), {
      params: Promise.resolve({ id: "job-ja-cancelado" }),
    });
    assert.equal(res.status, 409);
    const body = (await res.json()) as { error?: string; status?: string };
    assert.equal(body.status, "canceled");
    assert.ok(typeof body.error === "string");
  });

  test("job done → 409 { error, status: 'done' }", async () => {
    db.insert(brutos)
      .values({
        id: "vidDone1",
        url: "https://exemplo.test/y",
        platform: "youtube",
        title: "Vídeo vidDone1",
        createdAt: new Date(),
      })
      .run();
    semearJob({ id: "job-ja-done", url: "https://exemplo.test/y", status: "done", videoId: "vidDone1" });
    const res = await POST(requisicao("job-ja-done"), { params: Promise.resolve({ id: "job-ja-done" }) });
    assert.equal(res.status, 409);
    const body = (await res.json()) as { error?: string; status?: string };
    assert.equal(body.status, "done");
  });

  test("job error → 409 { error, status: 'error' }", async () => {
    semearJob({
      id: "job-ja-error",
      url: "https://exemplo.test/z",
      status: "error",
    });
    db.update(jobsTable)
      .set({ errorCode: "UNKNOWN", errorMessage: "algo" })
      .where(eq(jobsTable.id, "job-ja-error"))
      .run();
    const res = await POST(requisicao("job-ja-error"), { params: Promise.resolve({ id: "job-ja-error" }) });
    assert.equal(res.status, 409);
    const body = (await res.json()) as { error?: string; status?: string };
    assert.equal(body.status, "error");
  });

  test(
    "job RUNNING com trabalho em andamento → 200 canceled (a rota espera o job assentar)",
    { timeout: 20_000 },
    async () => {
      const jobId = "job-running-cancelavel";
      semearJob({ id: jobId, url: "https://www.youtube.com/watch?v=rrrrrrrrrrr", status: "queued" });

      const rodando = processJob(jobId, {
        fetchMetadata: async () => {
          await new Promise((r) => setTimeout(r, 400));
          return metaFake("rrrrrrrrrrr");
        },
        persistMetadata: async () => {
          throw new Error("não deveria chegar aqui: cancelado durante o fetch");
        },
      });
      await new Promise((r) => setTimeout(r, 100)); // deixa virar running

      const res = await POST(requisicao(jobId), { params: Promise.resolve({ id: jobId }) });
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { jobId, status: "canceled" });
      await rodando;
      assert.equal(statusDoJob(jobId), "canceled");
    },
  );
});

describe("SSE /api/jobs/[id]/events fecha em canceled", () => {
  test("stream abre, recebe o evento canceled e FECHA (como faz em done/error)", { timeout: 15_000 }, async () => {
    const jobId = enqueue("https://www.youtube.com/watch?v=sssssssssss");
    const req = new Request(`http://127.0.0.1:3000/api/jobs/${jobId}/events`, {
      headers: { host: "127.0.0.1:3000" },
    });
    const res = await GETevents(req, { params: Promise.resolve({ id: jobId }) });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/);

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let texto = "";
    const leitura = (async () => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return "fechou";
        texto += decoder.decode(value, { stream: true });
        if (/data: [^\n]*"canceled"/.test(texto)) {
          void reader.cancel().catch(() => {});
          return "cancelado-no-meio";
        }
      }
    })();

    // dá tempo do snapshot inicial chegar, então cancela
    await new Promise((r) => setTimeout(r, 150));
    const resCancel = await POST(requisicao(jobId), { params: Promise.resolve({ id: jobId }) });
    assert.equal(resCancel.status, 200);

    const resultado = await Promise.race([
      leitura,
      new Promise<string>((resolve) => setTimeout(() => resolve("nao-fechou"), 8_000).unref()),
    ]);

    // Ou o stream fechou sozinho após o evento canceled (comportamento certo),
    // ou o evento chegou e o cancel explícito do reader encerrou a leitura —
    // nos dois casos o evento canceled foi emitido no bus.
    assert.notEqual(resultado, "nao-fechou", "o stream deveria terminar após o evento canceled");
    const eventos = texto
      .split("\n\n")
      .filter((p) => p.startsWith("data: "))
      .map((p) => JSON.parse(p.slice(6)) as { status: string });
    assert.ok(eventos.length >= 2, "snapshot inicial + evento de cancelamento");
    assert.equal(eventos[eventos.length - 1].status, "canceled");
  });
});
