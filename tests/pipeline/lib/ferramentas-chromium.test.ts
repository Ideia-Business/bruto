/**
 * Chromium sob demanda (modo pacote): antes de `chromium.launch`, se o
 * headless shell não está em `PLAYWRIGHT_BROWSERS_PATH`, o app o instala com
 * `"$BRUTO_NODE" "$BRUTO_PLAYWRIGHT_CLI" install chromium-headless-shell`.
 *
 * Provas:
 *  - ausente → instala UMA vez (promessa compartilhada entre chamadas
 *    concorrentes — F3), com o node e a CLI do contrato;
 *  - presente → não instala nada;
 *  - falha/timeout → erro legível, nunca job preso;
 *  - modo clone (controle F2): não instala nada, não spawna nada.
 */
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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

/**
 * O dublê do node grava os argumentos e, ao receber `install
 * chromium-headless-shell`, "instala": cria o marcador que o Playwright cria
 * de verdade (pasta chromium_headless_shell-<rev> no PLAYWRIGHT_BROWSERS_PATH).
 * Com BRUTO_NODE_FALHA=1, sai com erro.
 */
function escreverNodeDuble(destino: string): void {
  fs.writeFileSync(
    destino,
    `#!/bin/sh
printf '%s\\n' "$*" >> "${registroNode}"
if [ -n "$BRUTO_NODE_FALHA" ]; then echo "network unreachable" >&2; exit 1; fi
if [ "$2" = "install" ] && [ "$3" = "chromium-headless-shell" ]; then
  mkdir -p "$PLAYWRIGHT_BROWSERS_PATH/chromium_headless_shell-9999/chrome-headless-shell-mac-arm64"
fi
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

before(() => {
  raiz = fs.mkdtempSync(path.join(os.tmpdir(), "bruto-f1-chromium-"));
  browsersPath = path.join(raiz, "ms-playwright");
  fs.mkdirSync(browsersPath, { recursive: true });
  registroNode = path.join(raiz, "node-chamadas.txt");
  playwrightCli = path.join(raiz, "app", "node_modules", "playwright", "cli.js");
  fs.mkdirSync(path.dirname(playwrightCli), { recursive: true });
  fs.writeFileSync(playwrightCli, "// duble da cli do playwright\n");

  nodeDuble = path.join(raiz, "node-duble");
  escreverNodeDuble(nodeDuble);

  salvas = {};
  for (const v of VARS) salvas[v] = process.env[v];

  process.env.BRUTO_EMPACOTADO = "1";
  process.env.BRUTO_NODE = nodeDuble;
  process.env.BRUTO_PLAYWRIGHT_CLI = playwrightCli;
  process.env.PLAYWRIGHT_BROWSERS_PATH = browsersPath;
});

after(() => {
  for (const v of VARS) {
    if (salvas[v] === undefined) delete process.env[v];
    else process.env[v] = salvas[v]!;
  }
  fs.rmSync(raiz, { recursive: true, force: true });
});

const ferramentas = await import("@/pipeline/lib/ferramentas");

beforeEach(() => {
  fs.rmSync(registroNode, { force: true });
  fs.rmSync(path.join(browsersPath, "chromium_headless_shell-9999"), {
    recursive: true,
    force: true,
  });
  delete process.env.BRUTO_NODE_FALHA;
  ferramentas.__rearmarParaTestes();
});

describe("garantirChromium — modo pacote", () => {
  test("ausente: instala com o node e a CLI do contrato, uma vez", async () => {
    await ferramentas.garantirChromium();
    assert.deepEqual(chamadasNode(), [`${playwrightCli} install chromium-headless-shell`]);
  });

  test("duas chamadas concorrentes: UMA instalação (F3)", async () => {
    await Promise.all([ferramentas.garantirChromium(), ferramentas.garantirChromium()]);
    assert.equal(chamadasNode().length, 1);
  });

  test("já presente no PLAYWRIGHT_BROWSERS_PATH: não instala nada", async () => {
    fs.mkdirSync(
      path.join(browsersPath, "chromium_headless_shell-9999", "chrome-headless-shell-mac-arm64"),
      { recursive: true },
    );
    await ferramentas.garantirChromium();
    assert.deepEqual(chamadasNode(), []);
  });

  test("falha de instalação vira erro legível", async () => {
    process.env.BRUTO_NODE_FALHA = "1";
    await assert.rejects(
      () => ferramentas.garantirChromium(),
      /Não foi possível preparar o navegador interno \(Chromium\)/,
    );
    // E não fica cacheada no fracasso: a próxima tentativa roda de novo.
    delete process.env.BRUTO_NODE_FALHA;
    await ferramentas.garantirChromium();
    assert.equal(chamadasNode().length, 1);
  });

  test("instalação demorada tem teto de tempo (F3)", async () => {
    const nodeLento = path.join(raiz, "node-lento");
    fs.writeFileSync(nodeLento, "#!/bin/sh\nsleep 600\n", { mode: 0o755 });
    process.env.BRUTO_NODE = nodeLento;
    try {
      const inicio = Date.now();
      await assert.rejects(
        () => ferramentas.garantirChromium({ timeoutMs: 300 }),
        /Chromium|tempo|timeout/i,
      );
      assert.ok(Date.now() - inicio < 10_000, "o teto de tempo não segurou");
    } finally {
      process.env.BRUTO_NODE = nodeDuble;
    }
  });
});

describe("garantirChromium — modo clone (controle F2)", () => {
  test("não instala nada, mesmo sem navegador no path", async () => {
    const empacotado = process.env.BRUTO_EMPACOTADO;
    delete process.env.BRUTO_EMPACOTADO;
    try {
      await ferramentas.garantirChromium();
    } finally {
      process.env.BRUTO_EMPACOTADO = empacotado;
    }
    assert.deepEqual(chamadasNode(), []);
  });
});
