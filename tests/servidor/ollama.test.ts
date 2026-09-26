/**
 * Testes de `chamarOllama` (`servidor/lib/ollama.ts`) — foco no achado P2 da
 * revisão cross-vendor de 25/09/2026: o relógio de timeout precisa cobrir a
 * LEITURA DO CORPO, não só a chegada dos cabeçalhos. `fetch` resolve assim que
 * os cabeçalhos chegam; se o timer fosse encerrado nesse ponto, um Ollama que
 * trava DEPOIS de responder os cabeçalhos nunca seria cortado pelo prazo do
 * contrato (170 s) — só pelo teto da própria plataforma, e a função nunca
 * retornaria para o handler devolver a unidade de cota.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { chamarOllama } from "../../servidor/lib/ollama";

/**
 * Duplo do Ollama: responde os cabeçalhos na hora (como o `fetch` real faz),
 * mas o CORPO nunca termina — só é interrompido quando o `AbortSignal` que
 * `chamarOllama` passou for abortado. É a mesma coisa que aconteceria com um
 * `fetch` de verdade contra um servidor que aceita a conexão e trava no meio
 * do stream: o `body` some, os cabeçalhos não.
 */
function fetchQueTravaNoCorpo(): typeof fetch {
  return (async (_url: unknown, init?: RequestInit) => {
    const sinal = init?.signal;
    const corpo = new ReadableStream<Uint8Array>({
      start(controller) {
        const abortar = () => controller.error(new DOMException("aborted", "AbortError"));
        if (sinal?.aborted) {
          abortar();
          return;
        }
        sinal?.addEventListener("abort", abortar, { once: true });
        // Nunca chama enqueue() nem close() — o corpo trava de propósito.
      },
    });
    return new Response(corpo, { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

describe("chamarOllama — timeout cobre a leitura do corpo", () => {
  test("corpo que trava depois dos cabeçalhos é cortado pelo timeout, não pendura para sempre", async () => {
    const inicio = Date.now();
    const resultado = await chamarOllama({
      meta: { title: "Título", channel: null },
      transcricao: "a".repeat(300),
      apiKey: "chave-de-teste-nao-real",
      fetchImpl: fetchQueTravaNoCorpo(),
      // Prazo minúsculo — o teste não pode esperar os 170 s do contrato.
      timeoutMs: 30,
    });
    const duracaoMs = Date.now() - inicio;

    assert.deepEqual(resultado, { ok: false, motivo: "timeout" });
    // Prova que o corte veio do timer (30 ms), não de um acaso de tempo —
    // se o relógio tivesse parado nos cabeçalhos, isto ficaria pendurado
    // pelos 30 s de teto padrão do node:test e o teste falharia por timeout
    // da própria suíte, não por uma asserção.
    assert.ok(duracaoMs < 5_000, `deveria cortar bem antes de 5s (levou ${duracaoMs}ms)`);
  });
});
