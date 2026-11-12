/**
 * POST /api/encerrar — o contrato da demanda 43fe2879 (botão "Encerrar o
 * Bruto"): a rota é casca fina da lógica injetável (src/lib/encerrar.ts);
 * estes testes exercitam a casca com banco real em tmpdir (padrão da suíte) e
 * com exit/agendar FALSOS — o process.exit real nunca roda no teste.
 *
 *   403 {ok:false, code:"origem-recusada"}   outro site (CSRF de localhost)
 *   415 Content-Type que não application/json (corpo JSON é obrigatório)
 *   409 {ok:false, code:"processamento-em-andamento", ativos:n}
 *                                           job running/queued sem {"confirmar":true}
 *   202 {ok:true}                            encerra ~300 ms depois de responder
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const RAIZ = process.cwd();

let dataRoot: string;
let caminhoPid: string;
let POST: typeof import("@/app/api/encerrar/route").POST;
let db: typeof import("@/db/client").db;
let jobsTable: typeof import("@/db/schema").jobs;

before(async () => {
  dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bruto-encerrar-route-"));
  process.env.BRUTO_DATA_ROOT = dataRoot;
  execFileSync("npm", ["run", "db:migrate"], {
    cwd: RAIZ,
    env: { ...process.env, BRUTO_DATA_ROOT: dataRoot },
    stdio: "pipe",
  });

  ({ POST } = await import("@/app/api/encerrar/route"));
  ({ db } = await import("@/db/client"));
  ({ jobs: jobsTable } = await import("@/db/schema"));
});

after(() => {
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

interface OpcoesRequisicao {
  /** undefined = sem o cabeçalho. */
  origin?: string;
  secFetchSite?: string;
  contentType?: string;
  corpo?: string;
}

function requisicao(opts: OpcoesRequisicao = {}): Request {
  const headers: Record<string, string> = {};
  if (opts.origin !== undefined) headers.origin = opts.origin;
  if (opts.secFetchSite !== undefined) headers["sec-fetch-site"] = opts.secFetchSite;
  headers["content-type"] = opts.contentType ?? "application/json";
  return new Request("http://127.0.0.1:3000/api/encerrar", {
    method: "POST",
    headers,
    body: opts.corpo ?? "{}",
  });
}

function semearJob(id: string, status: "queued" | "running" | "done"): void {
  db.insert(jobsTable)
    .values({
      id,
      videoId: null,
      url: `https://exemplo.test/${id}`,
      status,
      progressPct: status === "done" ? 100 : 0,
      createdAt: new Date(),
      ...(status === "done" ? { finishedAt: new Date() } : {}),
    })
    .run();
}

/** Deps falsas só para o que é perigoso (agendar/exit); o resto é o de produção. */
function depsSegurasParaTeste() {
  const agendadas: Array<() => void> = [];
  const exitados: number[] = [];
  return {
    deps: {
      agendar: (fn: () => void) => {
        agendadas.push(fn);
      },
      exit: (codigo: number) => {
        exitados.push(codigo);
      },
    },
    agendadas,
    exitados,
    disparar: () => {
      for (const fn of agendadas) fn();
    },
  };
}

describe("guarda de origem (CSRF de localhost) — 403 {ok:false, code:'origem-recusada'}", () => {
  test("Origin de outro site", async () => {
    const res = await POST(requisicao({ origin: "https://site-mau.exemplo", secFetchSite: "cross-site" }));
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { ok: false, code: "origem-recusada" });
  });

  test("Origin: null", async () => {
    const res = await POST(requisicao({ origin: "null", secFetchSite: "same-site" }));
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { ok: false, code: "origem-recusada" });
  });

  test("sem Origin com Sec-Fetch-Site: cross-site", async () => {
    const res = await POST(requisicao({ secFetchSite: "cross-site" }));
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { ok: false, code: "origem-recusada" });
  });

  test("sem Origin e sem Sec-Fetch-Site (qualquer outro caso)", async () => {
    const res = await POST(requisicao({}));
    assert.equal(res.status, 403);
  });
});

describe("corpo JSON obrigatório", () => {
  test("Content-Type text/plain → 415 (nem chega a contar jobs)", async () => {
    const res = await POST(
      requisicao({ secFetchSite: "same-origin", contentType: "text/plain", corpo: "{}" }),
    );
    assert.equal(res.status, 415);
  });

  test("JSON inválido → 400", async () => {
    const res = await POST(
      requisicao({ secFetchSite: "same-origin", corpo: "não é json" }),
    );
    assert.equal(res.status, 400);
  });
});

describe("jobs em andamento — 409 × 202", () => {
  test("job running + queued sem confirmar → 409 com ativos:2 e NADA agendado", async () => {
    semearJob("job-rodando", "running");
    semearJob("job-nativo", "queued");
    const t = depsSegurasParaTeste();
    const res = await POST(requisicao({ secFetchSite: "same-origin", corpo: "{}" }), {
      deps: t.deps,
    });
    assert.equal(res.status, 409);
    assert.deepEqual(await res.json(), {
      ok: false,
      code: "processamento-em-andamento",
      ativos: 2,
    });
    assert.equal(t.agendadas.length, 0);
    assert.equal(t.exitados.length, 0);
  });

  test("mesmos jobs com {\"confirmar\":true} → 202 e agenda o desligamento", async () => {
    const t = depsSegurasParaTeste();
    const res = await POST(requisicao({ secFetchSite: "same-origin", corpo: '{"confirmar":true}' }), {
      deps: t.deps,
    });
    assert.equal(res.status, 202);
    assert.deepEqual(await res.json(), { ok: true });
    assert.equal(t.agendadas.length, 1);
  });
});

describe("202 e o desligamento agendado (deps falsas; exit real NUNCA roda)", () => {
  before(() => {
    caminhoPid = path.join(dataRoot, "servidor.pid");
    // Os jobs semeados no describe anterior continuam no banco — estes casos
    // são "sem job ativo", então a mesa começa limpa.
    db.delete(jobsTable).run();
  });

  test("sem job ativo: 202 {ok:true}; o disparo apaga servidor.pid quando ele é DESTE processo", async () => {
    fs.writeFileSync(caminhoPid, String(process.pid));
    const t = depsSegurasParaTeste();
    const res = await POST(requisicao({ secFetchSite: "same-origin" }), { deps: t.deps });
    assert.equal(res.status, 202);
    assert.deepEqual(await res.json(), { ok: true });
    assert.equal(t.agendadas.length, 1);
    t.disparar();
    assert.deepEqual(t.exitados, [0]);
    assert.equal(fs.existsSync(caminhoPid), false, "o servidor.pid do próprio processo devia sumir");
  });

  test("servidor.pid de OUTRO processo: o disparo encerra (exit 0) mas NÃO apaga o arquivo", async () => {
    fs.writeFileSync(caminhoPid, "999999");
    const t = depsSegurasParaTeste();
    const res = await POST(requisicao({ origin: "http://127.0.0.1:3000" }), { deps: t.deps });
    assert.equal(res.status, 202);
    t.disparar();
    assert.deepEqual(t.exitados, [0]);
    assert.equal(fs.existsSync(caminhoPid), true, "pid alheio não é removido");
  });

  test("sem servidor.pid nenhum: 202 e o disparo segue (exit 0) sem erro", async () => {
    fs.rmSync(caminhoPid, { force: true });
    const t = depsSegurasParaTeste();
    const res = await POST(requisicao({ origin: "http://localhost:3000" }), { deps: t.deps });
    assert.equal(res.status, 202);
    t.disparar();
    assert.deepEqual(t.exitados, [0]);
  });
});

describe("a porta do servidor decide a origem aceita", () => {
  before(() => {
    db.delete(jobsTable).run();
  });

  test("PORT=3999: aceita http://127.0.0.1:3999 e recusa a 3000", async () => {
    const portaOriginal = process.env.PORT;
    process.env.PORT = "3999";
    try {
      const t = depsSegurasParaTeste();
      const resOk = await POST(requisicao({ origin: "http://127.0.0.1:3999" }), { deps: t.deps });
      assert.equal(resOk.status, 202);
      const resNok = await POST(requisicao({ origin: "http://127.0.0.1:3000" }), { deps: t.deps });
      assert.equal(resNok.status, 403);
    } finally {
      if (portaOriginal === undefined) delete process.env.PORT;
      else process.env.PORT = portaOriginal;
    }
  });
});
