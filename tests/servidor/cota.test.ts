/**
 * Testes do handler `GET /api/cota` (e do preflight `OPTIONS`). Achado do
 * Grok 4.7 (26/09/2026, 3ª rodada): `?instalacao=<uuid>` na query string entra
 * no access log da Vercel, que não expira em 36h como o Redis — a instalação
 * agora só é aceita pelo cabeçalho `X-Bruto-Instalacao`, e a query string com
 * `instalacao` é RECUSADA (400), não silenciosamente ignorada. Contrato
 * normativo: `servidor/CONTRATO.md`.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { tratarCota, OPTIONS, type DependenciasCota } from "../../servidor/api/cota";
import { cabecalhosCors } from "../../servidor/lib/cors";
import type { Contador } from "../../servidor/lib/limites";

const UUID_A = "11111111-1111-4111-8111-111111111111";

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

function depsBase(overrides: Partial<DependenciasCota> = {}): DependenciasCota {
  return {
    contador: new ContadorFake(),
    limiteDiario: 3,
    ...overrides,
  };
}

/** Pedido com a instalação no cabeçalho — o caminho correto, pós-correção. */
function pedidoComHeader(opts: { instalacao?: string; comXBrutoCliente?: boolean } = {}): Request {
  const headers = new Headers();
  if (opts.comXBrutoCliente !== false) headers.set("x-bruto-cliente", "extensao");
  if (opts.instalacao !== undefined) headers.set("x-bruto-instalacao", opts.instalacao);
  return new Request("https://bruto-gratis.vercel.app/api/cota", { method: "GET", headers });
}

/** Pedido com a instalação na QUERY STRING — o caminho que precisa ser recusado. */
function pedidoComQuery(instalacao: string): Request {
  const headers = new Headers({ "x-bruto-cliente": "extensao" });
  return new Request(
    `https://bruto-gratis.vercel.app/api/cota?instalacao=${encodeURIComponent(instalacao)}`,
    { method: "GET", headers },
  );
}

describe("GET /api/cota — caminho feliz (cabeçalho)", () => {
  test("instalação no cabeçalho X-Bruto-Instalacao devolve 200 com a cota", async () => {
    const resp = await tratarCota(pedidoComHeader({ instalacao: UUID_A }), depsBase());
    assert.equal(resp.status, 200);
    const json = await resp.json();
    assert.deepEqual(json, { restantes: 3, limite: 3 });
  });

  test("não consome nada — chamar duas vezes devolve o mesmo valor", async () => {
    const deps = depsBase();
    const r1 = await tratarCota(pedidoComHeader({ instalacao: UUID_A }), deps);
    const r2 = await tratarCota(pedidoComHeader({ instalacao: UUID_A }), deps);
    assert.deepEqual(await r1.json(), await r2.json());
  });
});

describe("GET /api/cota — a query string com 'instalacao' é recusada, nunca lida", () => {
  test("?instalacao=<uuid> dá 400, mesmo sendo um UUID v4 válido", async () => {
    const resp = await tratarCota(pedidoComQuery(UUID_A), depsBase());
    assert.equal(resp.status, 400);
    const json = await resp.json();
    assert.equal(typeof json.erro, "string");
  });

  test("query string com 'instalacao' vence mesmo se o cabeçalho X-Bruto-Instalacao também vier certo", async () => {
    // O ponto do achado é que a UUID NUNCA deve aparecer na query string — nem
    // como fallback aceito. Presença já é motivo de recusa.
    const headers = new Headers({ "x-bruto-cliente": "extensao", "x-bruto-instalacao": UUID_A });
    const req = new Request(
      `https://bruto-gratis.vercel.app/api/cota?instalacao=${UUID_A}`,
      { method: "GET", headers },
    );
    const resp = await tratarCota(req, depsBase());
    assert.equal(resp.status, 400);
  });
});

describe("GET /api/cota — validação do cabeçalho X-Bruto-Instalacao", () => {
  test("cabeçalho ausente dá 400", async () => {
    const resp = await tratarCota(pedidoComHeader(), depsBase());
    assert.equal(resp.status, 400);
  });

  test("cabeçalho que não é UUID v4 dá 400", async () => {
    const resp = await tratarCota(pedidoComHeader({ instalacao: "não-é-um-uuid" }), depsBase());
    assert.equal(resp.status, 400);
  });
});

describe("GET /api/cota — 415 e 503, iguais ao resto do servidor", () => {
  test("sem X-Bruto-Cliente dá 415", async () => {
    const resp = await tratarCota(
      pedidoComHeader({ instalacao: UUID_A, comXBrutoCliente: false }),
      depsBase(),
    );
    assert.equal(resp.status, 415);
  });

  test("sem Redis configurado dá 503", async () => {
    const resp = await tratarCota(
      pedidoComHeader({ instalacao: UUID_A }),
      depsBase({ contador: null }),
    );
    assert.equal(resp.status, 503);
  });
});

describe("OPTIONS /api/cota — preflight anuncia X-Bruto-Instalacao", () => {
  test("Access-Control-Allow-Headers inclui x-bruto-instalacao", async () => {
    const req = new Request("https://bruto-gratis.vercel.app/api/cota", {
      method: "OPTIONS",
      headers: { origin: "chrome-extension://abcdefghijklmnop" },
    });
    const resp = await OPTIONS(req);
    assert.equal(resp.status, 204);
    const permitidos = resp.headers.get("access-control-allow-headers") ?? "";
    assert.ok(permitidos.includes("x-bruto-instalacao"), `esperava x-bruto-instalacao em "${permitidos}"`);
  });

  test("cabecalhosCors (usado também por aula.ts) já reflete o novo cabeçalho", () => {
    const headers = cabecalhosCors("chrome-extension://abcdefghijklmnop");
    assert.ok(headers["access-control-allow-headers"]?.includes("x-bruto-instalacao"));
  });
});
