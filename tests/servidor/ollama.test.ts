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

import { chamarOllama, truncarUtf8SemPartirCaractere, TETO_AULA_BYTES } from "../../servidor/lib/ollama";

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

// --- corte por bytes UTF-8, não por caracteres (achado P2, 26/09/2026, 3ª rodada) --

describe("truncarUtf8SemPartirCaractere", () => {
  test("texto ASCII que já cabe não é alterado", () => {
    assert.equal(truncarUtf8SemPartirCaractere("abcdef", 100), "abcdef");
  });

  test("texto ASCII maior que o limite corta exatamente no byte (1 byte = 1 char)", () => {
    assert.equal(truncarUtf8SemPartirCaractere("abcdef", 3), "abc");
  });

  test("texto exatamente do tamanho do limite não corta nada", () => {
    const texto = "abc"; // 3 bytes
    assert.equal(truncarUtf8SemPartirCaractere(texto, 3), texto);
  });

  test("CJK: cada caractere é 1 unidade UTF-16 mas 3 bytes UTF-8 — corta pelo BYTE, nunca no meio do caractere", () => {
    const texto = "あ".repeat(5); // 5 caracteres, 15 bytes UTF-8
    const cortado = truncarUtf8SemPartirCaractere(texto, 10);
    // O corte cairia no meio do 4º caractere (bytes 9–11) — tem de recuar
    // para excluí-lo inteiro, sobrando só os 3 primeiros (9 bytes).
    assert.equal(cortado, "あああ");
    assert.ok(new TextEncoder().encode(cortado).length <= 10);
  });

  test("emoji (par surrogate em UTF-16, 4 bytes em UTF-8): nunca separa as duas metades do par", () => {
    const emoji = "\u{1F600}"; // 😀 — 2 unidades UTF-16, 4 bytes UTF-8
    const texto = emoji.repeat(4); // 16 bytes
    const cortado = truncarUtf8SemPartirCaractere(texto, 10);
    // O corte cairia no meio do 3º emoji (bytes 8–11) — sobra só 2 inteiros.
    assert.equal(cortado, emoji.repeat(2));
    assert.ok(new TextEncoder().encode(cortado).length <= 10);
    // Nenhum surrogate solto: comprimento par, e iterar por code point não
    // produz caractere de substituição nem string quebrada.
    assert.equal(cortado.length % 2, 0);
    assert.deepEqual([...cortado], [emoji, emoji]);
  });

  test("string vazia continua vazia", () => {
    assert.equal(truncarUtf8SemPartirCaractere("", 10), "");
  });
});

describe("chamarOllama — o teto de 200 KB é por BYTES, não por caracteres", () => {
  test("aula com muito CJK: .length fica bem abaixo de 200.000, mas os bytes UTF-8 passam de 200 KB — o corte tem de disparar mesmo assim", async () => {
    // "あ" = 3 bytes UTF-8, 1 unidade UTF-16. 90.000 caracteres passava batido
    // pela checagem antiga (`texto.length > TETO_AULA_BYTES`, 90.000 < 200.000)
    // enquanto o corpo de verdade já tinha 270.000 bytes.
    const textoGrande = "あ".repeat(90_000);
    const fetchComTextoGrande: typeof fetch = (async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: textoGrande } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;

    const resultado = await chamarOllama({
      meta: { title: "Título", channel: null },
      transcricao: "a".repeat(300),
      apiKey: "chave-de-teste-nao-real",
      fetchImpl: fetchComTextoGrande,
    });

    assert.equal(resultado.ok, true);
    if (!resultado.ok) return;
    const bytes = new TextEncoder().encode(resultado.aula);
    assert.ok(bytes.length <= TETO_AULA_BYTES, `deveria caber em ${TETO_AULA_BYTES} bytes (deu ${bytes.length})`);
    // Nenhum caractere partido: o texto só tem "あ" inteiros, nada de lixo.
    assert.ok(/^あ*$/.test(resultado.aula), "só deveria sobrar uma sequência de あ inteiros");
  });
});
