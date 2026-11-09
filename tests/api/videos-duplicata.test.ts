/**
 * (d) + (g) Duplicata ativa nas portas de entrada:
 *   POST /api/videos e POST /api/videos/[id]/retry devolvem
 *   409 { error: "Esse vídeo já está na fila", duplicate: true, jobId, videoId }
 *   quando o vídeo JÁ TEM job queued/running — comparando a IDENTIDADE do vídeo
 *   (youtu.be × watch?v= × shorts), não a string da URL.
 *
 * Controles: vídeo diferente entra (202); o 409 antigo de "Vídeo já processado"
 * continua igual; retry de vídeo cujo último job foi canceled entra (202);
 * retry com job ativo → 409 duplicate.
 *
 * Banco real em tmpdir; fila travada (`active = true`) para o 202 não disparar
 * yt-dlp de verdade.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const RAIZ = process.cwd();

let dataRoot: string;
let POSTvideos: typeof import("@/app/api/videos/route").POST;
let POSTretry: typeof import("@/app/api/videos/[id]/retry/route").POST;
let db: typeof import("@/db/client").db;
let brutos: typeof import("@/db/schema").brutos;
let jobsTable: typeof import("@/db/schema").jobs;

before(async () => {
  dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bruto-videos-duplicata-"));
  process.env.BRUTO_DATA_ROOT = dataRoot;
  execFileSync("npm", ["run", "db:migrate"], {
    cwd: RAIZ,
    env: { ...process.env, BRUTO_DATA_ROOT: dataRoot },
    stdio: "pipe",
  });

  ({ POST: POSTvideos } = await import("@/app/api/videos/route"));
  ({ POST: POSTretry } = await import("@/app/api/videos/[id]/retry/route"));
  ({ db } = await import("@/db/client"));
  ({ brutos, jobs: jobsTable } = await import("@/db/schema"));

  const g = globalThis as unknown as { __resumeVideoRunner?: { active: boolean } };
  g.__resumeVideoRunner!.active = true; // fila travada: 202 não processa nada
});

after(() => {
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

function requisicaoPost(body: unknown, rota = "/api/videos"): Request {
  return new Request(`http://127.0.0.1:3000${rota}`, {
    method: "POST",
    headers: {
      host: "127.0.0.1:3000",
      "x-bruto-cliente": "app",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

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
      ...(opts.status === "done" || opts.status === "error" || opts.status === "canceled"
        ? { finishedAt: new Date() }
        : {}),
    })
    .run();
}

describe("POST /api/videos — 409 de duplicata ATIVA", () => {
  test("mesma URL com job queued → 409 { error: 'Esse vídeo já está na fila', duplicate, jobId, videoId }", async () => {
    const res1 = await POSTvideos(requisicaoPost({ url: "https://www.youtube.com/watch?v=jjjjjjjjjjj" }));
    assert.equal(res1.status, 202, "primeira entrada é aceita");
    const body1 = (await res1.json()) as { jobId: string; videoId: string };
    assert.equal(body1.videoId, "jjjjjjjjjjj");

    const res2 = await POSTvideos(requisicaoPost({ url: "https://www.youtube.com/watch?v=jjjjjjjjjjj" }));
    assert.equal(res2.status, 409);
    const body2 = (await res2.json()) as {
      error: string;
      duplicate: boolean;
      jobId: string;
      videoId: string;
    };
    assert.equal(body2.error, "Esse vídeo já está na fila");
    assert.equal(body2.duplicate, true);
    assert.equal(body2.jobId, body1.jobId, "aponta para o job ATIVO");
    assert.equal(body2.videoId, "jjjjjjjjjjj");
  });

  test("youtu.be × watch?v= do MESMO vídeo → 409 (identidade, não string da URL)", async () => {
    const res1 = await POSTvideos(requisicaoPost({ url: "https://youtu.be/kkkkkkkkkkk" }));
    assert.equal(res1.status, 202);

    const res2 = await POSTvideos(
      requisicaoPost({ url: `https://www.youtube.com/watch?v=kkkkkkkkkkk&t=30s` }),
    );
    assert.equal(res2.status, 409);
    const body = (await res2.json()) as { error: string; duplicate: boolean; videoId: string };
    assert.equal(body.error, "Esse vídeo já está na fila");
    assert.equal(body.videoId, "kkkkkkkkkkk");
  });

  test("/shorts/ do mesmo vídeo → 409", async () => {
    const res1 = await POSTvideos(requisicaoPost({ url: "https://www.youtube.com/shorts/lllllllllll" }));
    assert.equal(res1.status, 202);

    const res2 = await POSTvideos(requisicaoPost({ url: "https://youtu.be/lllllllllll" }));
    assert.equal(res2.status, 409);
  });

  test("job RUNNING com videoId preenchido → 409", async () => {
    const id = "mmmmmmmmmmm";
    semearBruto(id, `https://www.youtube.com/watch?v=${id}`);
    semearJob({
      id: "job-running-m",
      url: `https://www.youtube.com/watch?v=${id}`,
      status: "running",
      videoId: id,
    });

    const res = await POSTvideos(requisicaoPost({ url: `https://youtu.be/${id}` }));
    assert.equal(res.status, 409);
    const body = (await res.json()) as { error: string; duplicate: boolean; jobId: string };
    assert.equal(body.error, "Esse vídeo já está na fila");
    assert.equal(body.jobId, "job-running-m");
  });

  test("controle negativo: vídeo DIFERENTE entra (202)", async () => {
    const res = await POSTvideos(requisicaoPost({ url: "https://youtu.be/nnnnnnnnnnn" }));
    assert.equal(res.status, 202);
    const body = (await res.json()) as { jobId: string; videoId: string };
    assert.equal(body.videoId, "nnnnnnnnnnn");
  });

  test("controle: vídeo concluído continua dando o 409 ANTIGO ('Vídeo já processado')", async () => {
    const id = "ooooooooooo";
    semearBruto(id, `https://www.youtube.com/watch?v=${id}`);
    semearJob({ id: "job-done-o", url: `https://www.youtube.com/watch?v=${id}`, status: "done", videoId: id });

    const res = await POSTvideos(requisicaoPost({ url: `https://youtu.be/${id}` }));
    assert.equal(res.status, 409);
    const body = (await res.json()) as { error: string; duplicate: boolean; videoId: string; jobId?: string };
    assert.equal(body.error, "Vídeo já processado");
    assert.equal(body.duplicate, true);
    assert.equal(body.videoId, id);
    assert.equal(body.jobId, undefined, "o 409 de concluído não tem jobId — é outro contrato");
  });

  test("link inválido continua 400 (nada mudou aí)", async () => {
    const res = await POSTvideos(requisicaoPost({ url: "https://exemplo.com/video" }));
    assert.equal(res.status, 400);
  });
});

describe("POST /api/videos/[id]/retry", () => {
  test("vídeo cujo último job foi canceled → 202 ('Tentar de novo' segue valendo)", async () => {
    const id = "ppppppppppp";
    semearBruto(id, `https://www.youtube.com/watch?v=${id}`);
    semearJob({ id: "job-canceled-p", url: `https://www.youtube.com/watch?v=${id}`, status: "canceled", videoId: id });

    const res = await POSTretry(requisicaoPost({}, `/api/videos/${id}/retry`), {
      params: Promise.resolve({ id }),
    });
    assert.equal(res.status, 202);
    const body = (await res.json()) as { jobId: string; videoId: string };
    assert.equal(body.videoId, id);
    assert.ok(body.jobId);
  });

  test("retry com job ATIVO (o retry anterior na fila) → 409 duplicate", async () => {
    const id = "qqqqqqqqqqq";
    semearBruto(id, `https://www.youtube.com/watch?v=${id}`);

    const res1 = await POSTretry(requisicaoPost({}, `/api/videos/${id}/retry`), {
      params: Promise.resolve({ id }),
    });
    assert.equal(res1.status, 202);
    const body1 = (await res1.json()) as { jobId: string };

    const res2 = await POSTretry(requisicaoPost({}, `/api/videos/${id}/retry`), {
      params: Promise.resolve({ id }),
    });
    assert.equal(res2.status, 409);
    const body2 = (await res2.json()) as { error: string; duplicate: boolean; jobId: string; videoId: string };
    assert.equal(body2.error, "Esse vídeo já está na fila");
    assert.equal(body2.duplicate, true);
    assert.equal(body2.jobId, body1.jobId);
    assert.equal(body2.videoId, id);
  });

  test("retry de vídeo com job running → 409 duplicate", async () => {
    const id = "rrrrrrrrrr2";
    semearBruto(id, `https://youtu.be/${id}`);
    semearJob({ id: "job-running-r2", url: `https://youtu.be/${id}`, status: "running", videoId: id });

    const res = await POSTretry(requisicaoPost({}, `/api/videos/${id}/retry`), {
      params: Promise.resolve({ id }),
    });
    assert.equal(res.status, 409);
    const body = (await res.json()) as { error: string; duplicate: boolean; jobId: string; videoId: string };
    assert.equal(body.error, "Esse vídeo já está na fila");
    assert.equal(body.duplicate, true);
    assert.equal(body.jobId, "job-running-r2");
    assert.equal(body.videoId, id);
  });

  test("vídeo inexistente → 404 (como sempre)", async () => {
    const res = await POSTretry(requisicaoPost({}, "/api/videos/naoexiste12345/retry"), {
      params: Promise.resolve({ id: "naoexiste12345" }),
    });
    assert.equal(res.status, 404);
  });
});
