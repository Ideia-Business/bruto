/**
 * CONTROLE NEGATIVO do achado (a) da 1ª rodada: o registro do Chromium no
 * cancelamento foi feito via `browser.process()` — método que NÃO existe no
 * `Browser` do Playwright (isso é do `BrowserServer` de `launchServer()`).
 * O registro era no-op silencioso: cancelar o job não parava o Chromium, o
 * render seguia até o fim e segurava a fila serial.
 *
 * INVARIANTE E1(a): a cobertura do cancelamento dura a vida inteira da
 * operação — aqui nada é dublê. O Chromium REAL (headless, instalado) é
 * lançado por `getBrowser()`, um job real (`rodarComCancelamento`) é
 * cancelado no meio de uma operação em voo, e a prova é o estado do PRÓPRIO
 * browser: desconecta em segundos, e o PRÓXIMO `getBrowser()` relança
 * sozinho um browser conectado e funcional.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Browser } from "playwright";

let getBrowser: typeof import("@/pipeline/lib/browser").getBrowser;
let closeBrowser: typeof import("@/pipeline/lib/browser").closeBrowser;
let rodarComCancelamento: typeof import("@/pipeline/lib/cancelamento").rodarComCancelamento;

before(async () => {
  ({ getBrowser, closeBrowser } = await import("@/pipeline/lib/browser"));
  ({ rodarComCancelamento } = await import("@/pipeline/lib/cancelamento"));
});

after(async () => {
  // Só o browser que ESTE arquivo lançou (o global quente dele).
  await closeBrowser();
});

function dormir(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Espera a condição virar true dentro do prazo — senão falha com a mensagem. */
async function esperarCondicao(cond: () => boolean, prazoMs: number, mensagem: string): Promise<void> {
  const inicio = Date.now();
  while (!cond()) {
    if (Date.now() - inicio > prazoMs) assert.fail(mensagem);
    await dormir(50);
  }
}

describe("INVARIANTE E1(a) — cancelar o job PARA o Chromium (browser real)", () => {
  test(
    "cancelar com render em voo: operação rejeita, browser DESCONECTA em segundos, e o próximo getBrowser() relança sozinho",
    { timeout: 60_000 },
    async () => {
      const controller = new AbortController();
      let browserDoJob: Browser | null = null;
      let desconectou = false;

      // ── o job: pega o browser quente e entra numa operação que só termina
      // (rejeitando) se a conexão do browser morrer — o "render em andamento".
      const fim = rodarComCancelamento({ jobId: "job-browser", signal: controller.signal }, async () => {
        browserDoJob = await getBrowser();
        browserDoJob.on("disconnected", () => {
          desconectou = true;
        });
        const page = await browserDoJob.newPage();
        const operacaoEmVoo = page.evaluate(() => new Promise<void>(() => {}));
        operacaoEmVoo.catch(() => {
          /* a rejeição é aguardada abaixo */
        });
        await dormir(300); // operação em voo, job no meio do export

        controller.abort(); // cancela o job

        const comoTerminou = operacaoEmVoo.then(
          () => "resolveu",
          () => "rejeitou",
        );
        const vencedor = await Promise.race([comoTerminou, dormir(8_000).then(() => "nao-terminou")]);
        assert.equal(
          vencedor,
          "rejeitou",
          "a operação em voo deveria REJEITAR com o Chromium sendo parado pelo cancelamento",
        );
      });
      await fim;

      assert.ok(browserDoJob, "o job deveria ter lançado um browser");
      await esperarCondicao(
        () => browserDoJob !== null && browserDoJob.isConnected() === false,
        5_000,
        "browser AINDA CONECTADO segundos após o cancelamento — o registro não parou o Chromium (achado (a) volta)",
      );
      assert.equal(desconectou, true, "o evento 'disconnected' deveria ter disparado");

      // ── o próximo job: o browser quente compartilhado precisa notar que
      // morreu — relança sozinho, sem travar a fila serial.
      const browserDoProximo = await getBrowser();
      try {
        assert.notEqual(
          browserDoProximo,
          browserDoJob,
          "getBrowser() devolveu o browser morto em vez de relançar",
        );
        assert.ok(browserDoProximo.isConnected(), "o browser do próximo job nasce conectado");
        const page = await browserDoProximo.newPage();
        try {
          assert.equal(await page.evaluate(() => 6 * 7), 42, "o browser relançado deve ser funcional");
        } finally {
          await page.close();
        }
      } finally {
        await closeBrowser();
      }
    },
  );
});
