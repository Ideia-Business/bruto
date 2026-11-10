/**
 * INVARIANTE E1(b) — a cobertura de cancelamento de um `fetch` dura a vida
 * INTEIRA da operação: `fetch()` resolver só prova que os CABEÇALHOS chegaram.
 * Se o endpoint manda os cabeçalhos e demora no corpo, o vínculo com o sinal
 * do job tem que continuar até o corpo ser consumido (`res.json()` /
 * `arrayBuffer`) — soltá-lo antes faz cancelar nesse intervalo não abortar
 * nada (achado (b) da 1ª rodada).
 *
 * Aqui entram TODOS os `fetch(` de `src/pipeline/**` (varredura da classe,
 * não do caso): `postJson` (providers/http.ts) e `downloadThumbnail`
 * (ytdlp.ts). Servidor local em 127.0.0.1:porta efêmera, sem rede externa.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let rodarComCancelamento: typeof import("@/pipeline/lib/cancelamento").rodarComCancelamento;
let postJson: typeof import("@/pipeline/lib/llm/providers/http").postJson;
let LlmHttpError: typeof import("@/pipeline/lib/llm/providers/http").LlmHttpError;
let downloadThumbnail: typeof import("@/pipeline/lib/ytdlp").downloadThumbnail;

before(async () => {
  ({ rodarComCancelamento } = await import("@/pipeline/lib/cancelamento"));
  ({ postJson, LlmHttpError } = await import("@/pipeline/lib/llm/providers/http"));
  ({ downloadThumbnail } = await import("@/pipeline/lib/ytdlp"));
});

/** Servidores que ESTE arquivo abriu — fechados no after, connections inclusas. */
const servidores: http.Server[] = [];

async function servidorCabecalhosECorpoPreso(corpoFinal: string | null, atrasoMs = 0): Promise<string> {
  const servidor = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.write('{"ok":'); // corpo PARCIAL já em trânsito
    if (corpoFinal === null) {
      // segura o corpo para sempre — o endpoint lento do achado (b)
      return;
    }
    setTimeout(() => res.end(corpoFinal), atrasoMs);
  });
  await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
  servidores.push(servidor);
  const porta = (servidor.address() as AddressInfo).port;
  return `http://127.0.0.1:${porta}/v1/responder`;
}

after(async () => {
  for (const servidor of servidores) {
    servidor.closeAllConnections?.();
    await new Promise<void>((r) => servidor.close(() => r()));
  }
});

function dormir(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe("postJson — cancelar durante a LEITURA do corpo rejeita rápido", () => {
  test(
    "cabeçalhos chegaram, corpo seguro: abort rejeita em < 1s com timeout de provedor de 60s",
    { timeout: 30_000 },
    async () => {
      const url = await servidorCabecalhosECorpoPreso(null);
      const controller = new AbortController();

      let erro: unknown = null;
      const chamada = rodarComCancelamento({ jobId: "job-http-corpo", signal: controller.signal }, () =>
        postJson({ url, headers: {}, body: { q: "resuma" }, timeoutMs: 60_000, label: "teste" }),
      );
      chamada.catch(() => {
        /* pode rejeitar depois do guard (fechamento do servidor no after) */
      });

      await dormir(300); // fetch() já resolveu (só cabeçalhos); res.json() lendo corpo preso
      const inicio = Date.now();
      controller.abort();

      const comoTerminou = chamada.then(
        () => "resolveu",
        (e) => {
          erro = e;
          return "rejeitou";
        },
      );
      const vencedor = await Promise.race([comoTerminou, dormir(1_000).then(() => "nao-terminou")]);

      assert.notEqual(
        vencedor,
        "nao-terminou",
        "cancelar durante a leitura do corpo deveria rejeitar em < 1s — o sinal foi solto antes de consumir o corpo (achado (b))",
      );
      const durou = Date.now() - inicio;
      assert.ok(erro instanceof LlmHttpError, `esperava LlmHttpError, veio ${String(erro)}`);
      assert.ok(durou < 1_000, `rejeitou em ${durou}ms — abort decide, não o timeout de 60s`);
    },
  );

  test("controle: sem cancelamento, a resposta lenta (cabeçalhos agora, corpo depois) completa normalmente", async () => {
    const url = await servidorCabecalhosECorpoPreso("true}", 600);
    const json = await rodarComCancelamento({ jobId: "job-http-ok", signal: new AbortController().signal }, () =>
      postJson({ url, headers: {}, body: { q: "resuma" }, timeoutMs: 60_000, label: "teste" }),
    );
    assert.deepEqual(json, { ok: true });
  });
});

describe("downloadThumbnail — mesmo critério (nenhum fetch solta o sinal antes do corpo)", () => {
  test("abort durante a leitura do corpo: falha não-fatal resolve rápido e não grava arquivo", { timeout: 30_000 }, async () => {
    const url = await servidorCabecalhosECorpoPreso(null);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bruto-thumb-corpo-"));
    const destino = path.join(dir, "thumb.jpg");
    const controller = new AbortController();

    try {
      const chamada = rodarComCancelamento({ jobId: "job-thumb", signal: controller.signal }, () =>
        downloadThumbnail(url, destino),
      );
      await dormir(300); // cabeçalhos chegaram, arrayBuffer() lendo corpo preso
      const inicio = Date.now();
      controller.abort();

      await Promise.race([chamada, dormir(1_000).then(() => assert.fail("abort deveria encerrar em < 1s"))]);
      const durou = Date.now() - inicio;
      assert.ok(durou < 1_000, `encerrou em ${durou}ms — abort decide, não a rede`);
      assert.equal(fs.existsSync(destino), false, "nenhum arquivo de thumbnail em corpo abortado");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
