/**
 * Testes do handler `POST /api/aula` (e do preflight `OPTIONS`) por INJEÇÃO de
 * dependências (`tratarAula`, `servidor/api/aula.ts`) — mesmo padrão de
 * `fetchImpl` já usado em `servidor/lib/ollama.ts`. Nenhum teste aqui fala com
 * Redis nem com o Ollama de verdade: o `Contador` é a versão em memória de
 * `tests/servidor/limites.test.ts`, e o `fetch` do Ollama é um duplo local.
 * Contrato normativo: `servidor/CONTRATO.md`.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { tratarAula, OPTIONS, type DependenciasAula } from "../../servidor/api/aula";
import type { Contador, Limites } from "../../servidor/lib/limites";

// --- o duplo do contador (mesmo contrato de tests/servidor/limites.test.ts) --

class ContadorFake implements Contador {
  mapa = new Map<string, number>();
  async incr(chave: string): Promise<number> {
    const atual = (this.mapa.get(chave) ?? 0) + 1;
    this.mapa.set(chave, atual);
    return atual;
  }
  async decr(chave: string): Promise<void> {
    const atual = Math.max(0, (this.mapa.get(chave) ?? 0) - 1);
    this.mapa.set(chave, atual);
  }
  async get(chave: string): Promise<number> {
    return this.mapa.get(chave) ?? 0;
  }
}

/**
 * Mesmo contrato, mas `incr` LANÇA quando a chave bate no predicado — simula
 * o Redis caindo no meio da reserva de uma requisição (achado P2 da revisão
 * cross-vendor de 25/09/2026: `verificarLimite` tem de desfazer o que já
 * aplicou e relançar, e o handler tem de responder 503, nunca 429).
 */
class ContadorComFalha extends ContadorFake {
  constructor(private readonly falhaEm: (chave: string) => boolean) {
    super();
  }
  async incr(chave: string): Promise<number> {
    if (this.falhaEm(chave)) throw new Error("Redis indisponível (simulado no teste)");
    return super.incr(chave);
  }
}

// --- o duplo do Ollama --------------------------------------------------------

/** Resposta de sucesso no formato `chat/completions` que `ollama.ts` espera. */
function fetchOllamaOk(): typeof fetch {
  return (async () =>
    new Response(
      JSON.stringify({ choices: [{ message: { content: "# 🎓 Aula: Teste\n\nConteúdo da aula." } }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as typeof fetch;
}

/** O Ollama respondendo erro — é o caminho que precisa devolver a unidade. */
function fetchOllamaFalha(): typeof fetch {
  return (async () => new Response("erro upstream", { status: 500 })) as typeof fetch;
}

/**
 * O Ollama responde os CABEÇALHOS e trava no meio do CORPO — nunca fecha o
 * stream. Achado P2 (25/09/2026): o timeout de `chamarOllama` precisa cortar
 * esta leitura sozinho; se não cortasse, `tratarAula` nunca chegaria a
 * `devolverUnidade`, e a cota da pessoa ficaria presa por um travamento do
 * Ollama, não por uso dela.
 */
function fetchOllamaTravaNoCorpo(): typeof fetch {
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
      },
    });
    return new Response(corpo, { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

const LIMITES_PADRAO_TESTE: Limites = { diario: 3, rede: 100, geral: 100 };

function depsBase(overrides: Partial<DependenciasAula> = {}): DependenciasAula {
  return {
    contador: new ContadorFake(),
    chaveOllama: "chave-de-teste-nao-real",
    sal: "sal-de-teste",
    modelo: "modelo-de-teste",
    limites: LIMITES_PADRAO_TESTE,
    fetchImpl: fetchOllamaOk(),
    ...overrides,
  };
}

const UUID_A = "11111111-1111-4111-8111-111111111111";

function corpoValido(overrides: Record<string, unknown> = {}) {
  return {
    instalacao: UUID_A,
    titulo: "Como funciona X",
    canal: "Canal Y",
    transcricao: "a".repeat(300),
    ...overrides,
  };
}

/**
 * Pedido "de cliente conhecido" — content-type e X-Bruto-Cliente sempre
 * corretos. Os testes de 415 (cabeçalho errado/ausente) usam `pedidoCru`
 * diretamente, para não haver ambiguidade sobre o que foi omitido.
 */
function pedido(opts: { corpo: unknown; origem?: string }): Request {
  const headers = new Headers({
    "content-type": "application/json",
    "x-bruto-cliente": "extensao",
  });
  if (opts.origem) headers.set("origin", opts.origem);

  return new Request("https://bruto-gratis.vercel.app/api/aula", {
    method: "POST",
    headers,
    body: JSON.stringify(opts.corpo),
  });
}

/** Pedido sem NENHUM cabeçalho de cliente/tipo — para os testes de 415. */
function pedidoCru(corpo: unknown, headers: Record<string, string>): Request {
  return new Request("https://bruto-gratis.vercel.app/api/aula", {
    method: "POST",
    headers,
    body: JSON.stringify(corpo),
  });
}

// --- 200 e a cota decrescendo -------------------------------------------------

describe("POST /api/aula — caminho feliz", () => {
  test("corpo válido devolve 200 com a aula e a cota restante", async () => {
    const resp = await tratarAula(pedido({ corpo: corpoValido() }), depsBase());
    assert.equal(resp.status, 200);
    const json = await resp.json();
    assert.equal(typeof json.aula, "string");
    assert.ok(json.aula.length > 0);
    assert.equal(json.restantes, 2); // limite 3, consumiu 1
    assert.equal(json.limite, 3);
  });
});

// --- 415 -----------------------------------------------------------------

describe("POST /api/aula — 415", () => {
  test("sem X-Bruto-Cliente é recusado com 415", async () => {
    const req = pedidoCru(corpoValido(), { "content-type": "application/json" });
    const resp = await tratarAula(req, depsBase());
    assert.equal(resp.status, 415);
    const json = await resp.json();
    assert.equal(typeof json.erro, "string");
  });

  test("X-Bruto-Cliente com valor errado é recusado com 415", async () => {
    const req = pedidoCru(corpoValido(), {
      "content-type": "application/json",
      "x-bruto-cliente": "outra-coisa",
    });
    const resp = await tratarAula(req, depsBase());
    assert.equal(resp.status, 415);
  });

  test("sem Content-Type application/json é recusado com 415, mesmo com o cabeçalho do cliente certo", async () => {
    const req = pedidoCru(corpoValido(), { "x-bruto-cliente": "extensao" });
    const resp = await tratarAula(req, depsBase());
    assert.equal(resp.status, 415);
  });

  test("Content-Type text/plain (a fuga clássica do preflight) também é recusado", async () => {
    const req = pedidoCru(corpoValido(), {
      "content-type": "text/plain",
      "x-bruto-cliente": "extensao",
    });
    const resp = await tratarAula(req, depsBase());
    assert.equal(resp.status, 415);
  });
});

// --- 503 -----------------------------------------------------------------

describe("POST /api/aula — 503 sem configuração", () => {
  test("sem OLLAMA_API_KEY dá 503", async () => {
    const resp = await tratarAula(
      pedido({ corpo: corpoValido() }),
      depsBase({ chaveOllama: undefined }),
    );
    assert.equal(resp.status, 503);
  });

  test("sem Redis configurado (contador nulo) dá 503", async () => {
    const resp = await tratarAula(pedido({ corpo: corpoValido() }), depsBase({ contador: null }));
    assert.equal(resp.status, 503);
  });
});

// --- 400 e 413 -----------------------------------------------------------

describe("POST /api/aula — corpo inválido", () => {
  test("JSON quebrado dá 400", async () => {
    const headers = new Headers({ "content-type": "application/json", "x-bruto-cliente": "extensao" });
    const req = new Request("https://bruto-gratis.vercel.app/api/aula", {
      method: "POST",
      headers,
      body: "{ isso não é json",
    });
    const resp = await tratarAula(req, depsBase());
    assert.equal(resp.status, 400);
  });

  test("campo faltando dá 400 com a mensagem do contrato", async () => {
    const { titulo: _semTitulo, ...semTitulo } = corpoValido();
    const resp = await tratarAula(pedido({ corpo: semTitulo }), depsBase());
    assert.equal(resp.status, 400);
  });

  test("corpo acima de 200 KB dá 413, mesmo sem casar com o schema", async () => {
    // O teto de bytes é checado ANTES do parse — um corpo enorme e inválido
    // ainda assim tem de dar 413, não 400.
    const req = pedido({ corpo: { recheio: "x".repeat(250_000) } });
    const resp = await tratarAula(req, depsBase());
    assert.equal(resp.status, 413);
  });
});

// --- 429 e a devolução da unidade quando o Ollama falha -----------------------

describe("POST /api/aula — limite e devolução de unidade", () => {
  test("4ª chamada da mesma instalação dá 429 motivo instalacao (limite = 3)", async () => {
    const deps = depsBase();
    for (let i = 0; i < 3; i++) {
      const r = await tratarAula(pedido({ corpo: corpoValido() }), deps);
      assert.equal(r.status, 200);
    }
    const bloqueado = await tratarAula(pedido({ corpo: corpoValido() }), deps);
    assert.equal(bloqueado.status, 429);
    const json = await bloqueado.json();
    assert.equal(json.motivo, "instalacao");
    assert.equal(json.restantes, 0);
    assert.equal(json.limite, 3);
  });

  test("quando o Ollama falha, a unidade é devolvida — a cota não diminui", async () => {
    const deps = depsBase({ fetchImpl: fetchOllamaFalha() });

    const resp = await tratarAula(pedido({ corpo: corpoValido() }), deps);
    assert.equal(resp.status, 502);
    const json = await resp.json();
    assert.equal(typeof json.erro, "string");
    // A mensagem de erro nunca reproduz a transcrição nem a chave.
    assert.ok(!json.erro.includes("chave-de-teste-nao-real"));

    // A unidade voltou: a mesma instalação ainda tem o limite inteiro.
    const contadorFake = deps.contador as ContadorFake;
    // Não assume o formato exato da chave do dia (é UTC-3, não UTC) — em vez
    // disso soma tudo o que ficou para a instalação: tem de ser 0.
    let total = 0;
    for (const [k, v] of contadorFake.mapa) {
      if (k.includes(`instalacao:${UUID_A}:`)) total += v;
    }
    assert.equal(total, 0, "incr + decr da tentativa que falhou deve fechar em zero");
  });

  test("quando o Ollama trava no meio do corpo (timeout), a unidade também é devolvida — 502, não pendura", async () => {
    const deps = depsBase({ fetchImpl: fetchOllamaTravaNoCorpo(), timeoutMsOllama: 30 });

    const inicio = Date.now();
    const resp = await tratarAula(pedido({ corpo: corpoValido() }), deps);
    const duracaoMs = Date.now() - inicio;

    assert.equal(resp.status, 502);
    assert.ok(duracaoMs < 5_000, `deveria cortar pelo timeout, não pendurar (levou ${duracaoMs}ms)`);

    const contadorFake = deps.contador as ContadorFake;
    let total = 0;
    for (const [k, v] of contadorFake.mapa) {
      if (k.includes(`instalacao:${UUID_A}:`)) total += v;
    }
    assert.equal(total, 0, "o travamento do Ollama não pode deixar a unidade presa");
  });
});

describe("POST /api/aula — 503 quando o Contador (Redis) falha no meio da reserva", () => {
  test("incr da rede lança depois do incr da instalação: 503, nunca 429 — o pedido não foi recusado por limite", async () => {
    const contador = new ContadorComFalha((chave) => chave.includes(":rede:"));
    const deps = depsBase({ contador });

    const resp = await tratarAula(pedido({ corpo: corpoValido() }), deps);
    assert.equal(resp.status, 503);
    const json = await resp.json();
    assert.equal(typeof json.erro, "string");
    assert.equal(json.motivo, undefined, "503 de infraestrutura não carrega o formato do 429 (sem 'motivo')");

    // A unidade da instalação, incrementada antes da falha, foi desfeita.
    let total = 0;
    for (const [k, v] of contador.mapa) {
      if (k.includes(`instalacao:${UUID_A}:`)) total += v;
    }
    assert.equal(total, 0);
  });
});

// --- CORS -----------------------------------------------------------------

describe("CORS", () => {
  test("origem chrome-extension:// é ecoada no preflight", async () => {
    const req = new Request("https://bruto-gratis.vercel.app/api/aula", {
      method: "OPTIONS",
      headers: { origin: "chrome-extension://abcdefghijklmnop" },
    });
    const resp = await OPTIONS(req);
    assert.equal(resp.status, 204);
    assert.equal(resp.headers.get("access-control-allow-origin"), "chrome-extension://abcdefghijklmnop");
    assert.equal(resp.headers.get("access-control-allow-headers"), "content-type, x-bruto-cliente");
    assert.equal(resp.headers.get("access-control-allow-methods"), "GET, POST, OPTIONS");
  });

  test("qualquer origem https:// não recebe cabeçalho CORS nenhum", async () => {
    const req = new Request("https://bruto-gratis.vercel.app/api/aula", {
      method: "OPTIONS",
      headers: { origin: "https://um-site-qualquer.com" },
    });
    const resp = await OPTIONS(req);
    assert.equal(resp.status, 204);
    assert.equal(resp.headers.get("access-control-allow-origin"), null);
  });

  test("a resposta real (200) também ecoa a origem chrome-extension://, senão a extensão não lê o corpo", async () => {
    const req = pedido({ corpo: corpoValido(), origem: "chrome-extension://abcdefghijklmnop" });
    const resp = await tratarAula(req, depsBase());
    assert.equal(resp.headers.get("access-control-allow-origin"), "chrome-extension://abcdefghijklmnop");
  });

  test("a resposta real para origem https:// qualquer não carrega CORS", async () => {
    const req = pedido({ corpo: corpoValido(), origem: "https://um-site-qualquer.com" });
    const resp = await tratarAula(req, depsBase());
    assert.equal(resp.headers.get("access-control-allow-origin"), null);
  });
});
