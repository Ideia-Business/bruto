/**
 * Testes do corte de transcrição do modo grátis (`cortarTranscricao`).
 *
 * ORIGEM: achado do Codex (26/09/2026) em `extension/src/lib/gratis.ts` — o
 * corte cortava só por CARACTERES (120.000), mas o servidor recusa o CORPO
 * inteiro acima de 200 KB (`servidor/CONTRATO.md`). Texto em CJK ou cheio de
 * emoji tem até 3-4 bytes por caractere em UTF-8: 100.000 caracteres CJK
 * viram ~300 KB e tomam 413, mesmo sem passar do limite de caracteres. O
 * corte por bytes precisa acontecer SEMPRE, e nunca no meio de um par
 * surrogate (emoji), senão o servidor recebe um code unit órfão.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

import {
  cortarTranscricao,
  bytesDoCorpo,
  verCotaGratis,
  SERVIDOR_GRATIS,
  LIMITE_TRANSCRICAO_CARACTERES,
  ALVO_BYTES_CORPO,
} from "../../extension/src/lib/gratis";

const INSTALACAO = "0f1e2d3c-4b5a-4978-8765-1234567890ab"; // formato de UUID v4, tamanho real
const TITULO = "Título de vídeo qualquer, de tamanho comum";
const CANAL = "Um canal qualquer";

function ehValido(texto: string): void {
  // `JSON.stringify` de um code unit surrogate órfão produz `\\udXXX` — que é
  // sinal de que o corte partiu um par ao meio. Nenhuma metade órfã pode
  // sobreviver ao corte.
  for (let i = 0; i < texto.length; i++) {
    const c = texto.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      assert.ok(
        i + 1 < texto.length && texto.charCodeAt(i + 1) >= 0xdc00 && texto.charCodeAt(i + 1) <= 0xdfff,
        `code unit ${i} é metade alta de um par surrogate sem a metade baixa em seguida`,
      );
    }
    if (c >= 0xdc00 && c <= 0xdfff) {
      assert.ok(
        i > 0 && texto.charCodeAt(i - 1) >= 0xd800 && texto.charCodeAt(i - 1) <= 0xdbff,
        `code unit ${i} é metade baixa de um par surrogate sem a metade alta antes`,
      );
    }
  }
}

describe("cortarTranscricao — texto ASCII", () => {
  test("texto curto passa intacto, sem corte", () => {
    const texto = "a".repeat(1000);
    const r = cortarTranscricao(INSTALACAO, TITULO, CANAL, texto);
    assert.equal(r.transcricao, texto);
    assert.equal(r.corte, null);
  });

  test("texto ASCII de exatamente 120.000 caracteres não é cortado", () => {
    const texto = "a".repeat(LIMITE_TRANSCRICAO_CARACTERES);
    const r = cortarTranscricao(INSTALACAO, TITULO, CANAL, texto);
    assert.equal(r.corte, null);
    assert.equal(r.transcricao.length, LIMITE_TRANSCRICAO_CARACTERES);
  });

  test("texto ASCII acima de 120.000 caracteres é cortado no limite de CARACTERES", () => {
    const texto = "a".repeat(200_000);
    const r = cortarTranscricao(INSTALACAO, TITULO, CANAL, texto);
    assert.equal(r.corte, "caracteres", "ASCII nunca estoura bytes antes de estourar caracteres");
    assert.equal(r.transcricao.length, LIMITE_TRANSCRICAO_CARACTERES);
    assert.ok(
      bytesDoCorpo(INSTALACAO, TITULO, CANAL, r.transcricao) <= ALVO_BYTES_CORPO,
      "corpo final tem de caber no orçamento de bytes",
    );
  });
});

describe("cortarTranscricao — texto CJK (o achado do Codex)", () => {
  test("100.000 caracteres CJK ultrapassam 200 KB e são cortados por BYTES, não só por caracteres", () => {
    // Caractere chinês comum, 3 bytes em UTF-8 — 100.000 deles são ~300 KB,
    // bem abaixo do limite de 120.000 CARACTERES mas bem acima do de BYTES.
    const texto = "漢".repeat(100_000);
    assert.ok(texto.length <= LIMITE_TRANSCRICAO_CARACTERES, "o teste tem de ficar sob o limite de caracteres");

    const r = cortarTranscricao(INSTALACAO, TITULO, CANAL, texto);
    assert.equal(
      r.corte,
      "bytes",
      "tinha de cortar por BYTES (não 'caracteres') mesmo sem passar do limite de caracteres",
    );
    assert.ok(r.transcricao.length < texto.length, "o corte reduziu o texto");
    const bytes = bytesDoCorpo(INSTALACAO, TITULO, CANAL, r.transcricao);
    assert.ok(bytes <= ALVO_BYTES_CORPO, `corpo final (${bytes} bytes) tem de caber no orçamento`);
    // Regressão do defeito original: o corte por caracteres sozinho teria
    // deixado os 100.000 caracteres intactos (dentro do limite de 120.000) e
    // o corpo serializado passaria bem de 200 KB.
    assert.ok(
      bytesDoCorpo(INSTALACAO, TITULO, CANAL, texto) > 200 * 1024,
      "pré-condição do teste: o texto original tem de estourar o teto do contrato",
    );
  });

  test("texto CJK que já cabe no orçamento de bytes não é cortado", () => {
    const texto = "漢".repeat(1000); // ~3 KB, longe do teto
    const r = cortarTranscricao(INSTALACAO, TITULO, CANAL, texto);
    assert.equal(r.corte, null);
    assert.equal(r.transcricao, texto);
  });
});

describe("cortarTranscricao — emoji na fronteira do corte", () => {
  test("emoji (par surrogate) exatamente na fronteira do corte por CARACTERES nunca fica pela metade", () => {
    // Emoji fora do plano básico ocupa DOIS code units em UTF-16. Posiciona
    // um logo em cima do limite de 120.000 caracteres — o ponto exato onde um
    // `.slice()` ingênuo partiria o par ao meio.
    const antes = "a".repeat(LIMITE_TRANSCRICAO_CARACTERES - 1);
    const texto = antes + "😀" + "b".repeat(1000); // 😀 ocupa os code units 119999 e 120000
    const r = cortarTranscricao(INSTALACAO, TITULO, CANAL, texto);
    ehValido(r.transcricao);
    // O par não coube inteiro dentro do limite de caracteres (precisaria de
    // 120.001 code units) — o corte tem de excluí-lo por inteiro, nunca só a
    // metade alta.
    assert.equal(r.transcricao, antes, "o par incompleto foi descartado por inteiro, não partido");
    // Texto minúsculo (bem abaixo de 190.000 bytes) — o corte foi só por
    // CARACTERES, nunca por bytes.
    assert.equal(r.corte, "caracteres");
  });

  test("texto cheio de emoji (pares surrogate) que precisa de corte por bytes nunca parte um par", () => {
    // 🎓 tem 4 bytes em UTF-8 e 2 code units em UTF-16 — repetir o bastante
    // para estourar o orçamento de bytes bem antes do limite de caracteres.
    const emoji = "🎓";
    const repeticoes = 60_000; // 120.000 code units, dentro do limite de caracteres
    const texto = emoji.repeat(repeticoes);
    assert.ok(texto.length <= LIMITE_TRANSCRICAO_CARACTERES);
    assert.ok(bytesDoCorpo(INSTALACAO, TITULO, CANAL, texto) > 200 * 1024, "pré-condição: estoura bytes");

    const r = cortarTranscricao(INSTALACAO, TITULO, CANAL, texto);
    assert.equal(r.corte, "bytes");
    ehValido(r.transcricao);
    assert.ok(
      bytesDoCorpo(INSTALACAO, TITULO, CANAL, r.transcricao) <= ALVO_BYTES_CORPO,
      "corpo final tem de caber no orçamento de bytes",
    );
    // Cada emoji é um par completo — o texto cortado tem de ser um número
    // inteiro de emojis, nunca sobrar um code unit solto no fim.
    assert.equal(r.transcricao.length % 2, 0, "número de code units tem de ser par (só pares completos)");
  });
});

describe("bytesDoCorpo — mede o corpo, não a transcrição isolada", () => {
  test("bate com o tamanho real do JSON serializado", () => {
    const esperado = new TextEncoder().encode(
      JSON.stringify({ instalacao: INSTALACAO, titulo: TITULO, canal: CANAL, transcricao: "abc" }),
    ).length;
    assert.equal(bytesDoCorpo(INSTALACAO, TITULO, CANAL, "abc"), esperado);
  });

  test("canal nulo entra no cálculo (JSON.stringify grava `null`, não some)", () => {
    const comCanal = bytesDoCorpo(INSTALACAO, TITULO, CANAL, "abc");
    const semCanal = bytesDoCorpo(INSTALACAO, TITULO, null, "abc");
    assert.notEqual(comCanal, semCanal);
  });
});

/**
 * `verCotaGratis` — o UUID vai no CABEÇALHO, nunca na query string.
 *
 * ORIGEM: achado do Grok (26/09/2026) — a versão anterior mandava
 * `?instalacao=<uuid>` na URL, e query string vai para o access log da
 * Vercel (sem o TTL de 36h do Redis). O contrato (`servidor/CONTRATO.md`)
 * passou a exigir `X-Bruto-Instalacao` no cabeçalho e a RECUSAR a query
 * string. O duplo abaixo é um servidor HTTP de verdade — a dúvida é se o
 * `fetch` de fato manda o cabeçalho e de fato NÃO manda a query, e isso só
 * se prova contra o caminho inteiro, não com um mock de `fetch`.
 */
describe("verCotaGratis — o UUID vai no cabeçalho, nunca na query string", () => {
  let responder: (req: http.IncomingMessage, res: http.ServerResponse) => void;
  let ultimaUrl = "";
  let ultimosCabecalhos: http.IncomingHttpHeaders = {};
  let fetchReal: typeof fetch;

  const servidor = http.createServer((req, res) => {
    ultimaUrl = req.url ?? "";
    ultimosCabecalhos = req.headers;
    responder(req, res);
  });

  // Storage em memória: só o suficiente para `idDaInstalacao` funcionar sem
  // um Chrome de verdade por trás.
  const memoriaStorage: Record<string, unknown> = { "bruto.instalacao": INSTALACAO };

  before(async () => {
    await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
    const porta = (servidor.address() as AddressInfo).port;

    (globalThis as { chrome?: unknown }).chrome = {
      storage: {
        local: {
          get: async (chaves: string[]) =>
            Object.fromEntries(chaves.map((c) => [c, memoriaStorage[c]])),
          set: async (itens: Record<string, unknown>) => {
            Object.assign(memoriaStorage, itens);
          },
        },
      },
    };

    fetchReal = globalThis.fetch;
    globalThis.fetch = ((entrada: string | URL | Request, init?: RequestInit) => {
      const url = String(typeof entrada === "object" && "url" in entrada ? entrada.url : entrada);
      const alvo = url.startsWith(SERVIDOR_GRATIS)
        ? url.replace(SERVIDOR_GRATIS, `http://127.0.0.1:${porta}`)
        : url;
      return fetchReal(alvo, init);
    }) as typeof fetch;
  });

  after(async () => {
    globalThis.fetch = fetchReal;
    delete (globalThis as { chrome?: unknown }).chrome;
    await new Promise<void>((r) => servidor.close(() => r()));
  });

  test("manda X-Bruto-Instalacao no cabeçalho, com o UUID exato", async () => {
    responder = (_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ restantes: 2, limite: 3 }));
    };
    const cota = await verCotaGratis();
    assert.deepEqual(cota, { restantes: 2, limite: 3 });
    assert.equal(ultimosCabecalhos["x-bruto-instalacao"], INSTALACAO);
  });

  test("a URL chamada NÃO carrega `instalacao=` na query string", async () => {
    responder = (_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ restantes: 1, limite: 3 }));
    };
    await verCotaGratis();
    assert.equal(ultimaUrl, "/api/cota", "sem `?instalacao=` nem qualquer outra query");
    assert.ok(!ultimaUrl.includes(INSTALACAO), "o UUID não pode aparecer na URL de jeito nenhum");
  });

  test("manda X-Bruto-Cliente também — a mesma tranca de sempre", async () => {
    responder = (_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ restantes: 3, limite: 3 }));
    };
    await verCotaGratis();
    assert.equal(ultimosCabecalhos["x-bruto-cliente"], "extensao");
  });

  test("400 do servidor (cabeçalho ausente/inválido) vira `null`, não exceção", async () => {
    responder = (_req, res) => {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ erro: "cabeçalho ausente" }));
    };
    assert.equal(await verCotaGratis(), null);
  });
});
