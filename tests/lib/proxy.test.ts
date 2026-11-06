/**
 * `src/proxy.ts` — a checagem de Host que cobre TODO `/api/*`, inclusive os GETs
 * (achado de segurança de 05/11/2026: DNS rebinding lia a biblioteca pelos GETs).
 * Controle nos dois sentidos: Host da própria máquina passa; Host de domínio
 * alheio (o que o atacante controla) é recusado com 403.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { proxy, config } from "@/proxy";

function pedido(host: string | null, caminho = "/api/videos/concluidos") {
  const headers = new Headers();
  if (host !== null) headers.set("host", host);
  return new NextRequest(`http://127.0.0.1:3000${caminho}`, { headers });
}

describe("proxy de /api/*", () => {
  test("deixa passar os Hosts da própria máquina", () => {
    for (const host of ["127.0.0.1:3000", "localhost:3000", "localhost", "[::1]:3000", "LOCALHOST:3999"]) {
      const r = proxy(pedido(host));
      assert.notEqual(r.status, 403, `${host} é local e deve passar`);
      assert.equal(r.headers.get("x-middleware-next"), "1", `${host} deve seguir adiante`);
    }
  });

  test("recusa com 403 um Host de domínio alheio apontado para 127.0.0.1 (DNS rebinding)", async () => {
    for (const host of ["atacante.example", "atacante.example:3000", "127.0.0.1.atacante.example", "192.168.0.10:3000", ""]) {
      const r = proxy(pedido(host));
      assert.equal(r.status, 403, `${host || "(Host vazio)"} não é local e deve ser recusado`);
      const corpo = (await r.json()) as { error: string };
      assert.match(corpo.error, /máquina local/);
    }
  });

  test("recusa o pedido sem cabeçalho Host", () => {
    assert.equal(proxy(pedido(null)).status, 403);
  });

  test("cobre /api/* e nada além (a interface e os estáticos seguem livres)", () => {
    assert.equal(config.matcher, "/api/:path*");
  });
});
