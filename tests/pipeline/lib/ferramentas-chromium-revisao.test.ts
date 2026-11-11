/**
 * Marca do Chromium amarrada à REVISÃO exigida pelo Playwright instalado
 * (achado P2 da 1ª rodada de revisão): depois de uma atualização do app que
 * troca a revisão do Chromium que o Playwright pede, a marca sem versão
 * continuava fazendo `garantirChromium` pular a instalação — e o
 * `chromium.launch()` quebrava por exigir a revisão nova.
 *
 * A revisão exigida é lida do `browsers.json` do `playwright-core`, resolvido
 * a partir da CLI do contrato (`BRUTO_PLAYWRIGHT_CLI`) — nos testes, um
 * pacote falso em `app/node_modules/playwright-core/`.
 *
 * Provas:
 *  - revisão exigida 1228, marca com 1227 → CHAMA o instalador;
 *  - marca com a mesma revisão (1228) → não chama;
 *  - marca antiga SEM revisão (texto ISO, formato gravado em d8ae8a2) →
 *    trata como desatualizada e reinstala;
 *  - depois de instalar, a marca gravada carrega a revisão exigida.
 */
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REVISAO_EXIGIDA = "1228";
const NOME_MARCA = ".bruto-chromium-headless-shell-instalado";

let raiz: string;
let browsersPath: string;
let registroNode: string;
let nodeDuble: string;
let playwrightCli: string;

let salvas: Record<string, string | undefined>;
const VARS = [
  "BRUTO_EMPACOTADO",
  "BRUTO_NODE",
  "BRUTO_PLAYWRIGHT_CLI",
  "PLAYWRIGHT_BROWSERS_PATH",
] as const;

function escreverNodeDuble(destino: string): void {
  fs.writeFileSync(
    destino,
    `#!/bin/sh
printf '%s\\n' "$*" >> "${registroNode}"
exit 0
`,
    { mode: 0o755 },
  );
}

function chamadasNode(): string[] {
  try {
    return fs.readFileSync(registroNode, "utf8").split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

function caminhoMarca(): string {
  return path.join(browsersPath, NOME_MARCA);
}

function escreverMarca(conteudo: string): void {
  fs.writeFileSync(caminhoMarca(), conteudo);
}

let ferramentas: typeof import("@/pipeline/lib/ferramentas");

before(async () => {
  raiz = fs.mkdtempSync(path.join(os.tmpdir(), "bruto-chromium-revisao-"));
  browsersPath = path.join(raiz, "ms-playwright");
  fs.mkdirSync(browsersPath, { recursive: true });
  registroNode = path.join(raiz, "node-chamadas.txt");

  // A CLI falsa do contrato e o playwright-core falso que ela resolve:
  // o app lê a revisão exigida do browsers.json DESTE pacote.
  playwrightCli = path.join(raiz, "app", "node_modules", "playwright", "cli.js");
  fs.mkdirSync(path.dirname(playwrightCli), { recursive: true });
  fs.writeFileSync(playwrightCli, "// duble da cli do playwright\n");

  const coreDir = path.join(raiz, "app", "node_modules", "playwright-core");
  fs.mkdirSync(coreDir, { recursive: true });
  fs.writeFileSync(
    path.join(coreDir, "package.json"),
    JSON.stringify({ name: "playwright-core", version: "1.61.1" }),
  );
  fs.writeFileSync(
    path.join(coreDir, "browsers.json"),
    JSON.stringify({
      browsers: [
        { name: "chromium", revision: REVISAO_EXIGIDA },
        { name: "chromium-headless-shell", revision: REVISAO_EXIGIDA },
      ],
    }),
  );

  nodeDuble = path.join(raiz, "node-duble");
  escreverNodeDuble(nodeDuble);

  salvas = {};
  for (const v of VARS) salvas[v] = process.env[v];

  process.env.BRUTO_EMPACOTADO = "1";
  process.env.BRUTO_NODE = nodeDuble;
  process.env.BRUTO_PLAYWRIGHT_CLI = playwrightCli;
  process.env.PLAYWRIGHT_BROWSERS_PATH = browsersPath;

  ferramentas = await import("@/pipeline/lib/ferramentas");
});

after(() => {
  for (const v of VARS) {
    if (salvas[v] === undefined) delete process.env[v];
    else process.env[v] = salvas[v]!;
  }
  fs.rmSync(raiz, { recursive: true, force: true });
});

beforeEach(() => {
  fs.rmSync(registroNode, { force: true });
  fs.rmSync(caminhoMarca(), { force: true });
  ferramentas.__rearmarParaTestes();
});

describe("garantirChromium — marca amarrada à revisão exigida", () => {
  test("app atualizado (exige 1228) com marca da revisão anterior (1227): reinstala", async () => {
    escreverMarca(JSON.stringify({ revisao: "1227", gravadoEm: "2026-10-01T00:00:00.000Z" }));
    await ferramentas.garantirChromium();
    assert.deepEqual(chamadasNode(), [`${playwrightCli} install chromium-headless-shell`]);
  });

  test("marca com a MESMA revisão exigida (1228): não instala nada", async () => {
    escreverMarca(JSON.stringify({ revisao: REVISAO_EXIGIDA, gravadoEm: "2026-11-01T00:00:00.000Z" }));
    await ferramentas.garantirChromium();
    assert.deepEqual(chamadasNode(), []);
  });

  test("marca antiga sem revisão (texto ISO, formato de d8ae8a2): reinstala", async () => {
    escreverMarca("2026-11-10T12:00:00.000Z");
    await ferramentas.garantirChromium();
    assert.deepEqual(chamadasNode(), [`${playwrightCli} install chromium-headless-shell`]);
  });

  test("depois de instalar, a marca gravada carrega a revisão exigida", async () => {
    await ferramentas.garantirChromium();
    const marca = JSON.parse(fs.readFileSync(caminhoMarca(), "utf8")) as { revisao?: string };
    assert.equal(marca.revisao, REVISAO_EXIGIDA);
  });
});
