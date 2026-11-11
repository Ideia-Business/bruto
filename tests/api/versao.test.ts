/**
 * GET /api/versao — o contrato entre o app (W2) e o lançador (W1):
 *   200 {"app":"bruto","versao":<version do package.json>,"origem":"pacote"|"clone"}
 *
 * É leitura pública local (sem a guarda de chamada de cliente): o lançador
 * bate nesta rota antes de decidir se sobe o servidor.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const VERSAO_DO_PACKAGE = (JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
) as { version: string }).version;

let salvaEmpacotado: string | undefined;

let GET: typeof import("@/app/api/versao/route").GET;

before(async () => {
  salvaEmpacotado = process.env.BRUTO_EMPACOTADO;
  ({ GET } = await import("@/app/api/versao/route"));
});

after(() => {
  if (salvaEmpacotado === undefined) delete process.env.BRUTO_EMPACOTADO;
  else process.env.BRUTO_EMPACOTADO = salvaEmpacotado;
});

describe("GET /api/versao", () => {
  test("modo clone (sem BRUTO_EMPACOTADO): origem 'clone', versão do package.json", async () => {
    delete process.env.BRUTO_EMPACOTADO;
    const res = await GET();
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { app: "bruto", versao: VERSAO_DO_PACKAGE, origem: "clone" });
  });

  test("modo pacote (BRUTO_EMPACOTADO=1): origem 'pacote'", async () => {
    process.env.BRUTO_EMPACOTADO = "1";
    const res = await GET();
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { app: "bruto", versao: VERSAO_DO_PACKAGE, origem: "pacote" });
  });
});
