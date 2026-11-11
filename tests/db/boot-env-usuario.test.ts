/**
 * Boot em modo pacote — o `.env` DA PESSOA é carregado no MESMO ponto da
 * migração (`instrumentation.ts`).
 *
 * Montagem: `BRUTO_DATA_ROOT` temporário com um `.env` contendo uma chave
 * conhecida (`ANTHROPIC_API_KEY=chave-falsa-de-teste`) e uma variável
 * desconhecida (`MALICIOSA=1`). Após `register()`: a conhecida está no
 * `process.env`, a desconhecida NÃO, e o log capturado não contém o valor.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CHAVE_FALSA = "chave-falsa-de-teste";

let raiz: string;
let dataRoot: string;

let salvas: Record<string, string | undefined>;
const VARS = [
  "BRUTO_EMPACOTADO",
  "BRUTO_DATA_ROOT",
  "NEXT_RUNTIME",
  "ANTHROPIC_API_KEY",
  "MALICIOSA",
] as const;

let register: typeof import("@/instrumentation").register;

before(async () => {
  raiz = fs.mkdtempSync(path.join(os.tmpdir(), "bruto-boot-env-"));
  dataRoot = path.join(raiz, "dados");
  fs.mkdirSync(dataRoot, { recursive: true });
  const envPath = path.join(dataRoot, ".env");
  fs.writeFileSync(envPath, `ANTHROPIC_API_KEY=${CHAVE_FALSA}\nMALICIOSA=1\n`);
  fs.chmodSync(envPath, 0o600);

  salvas = {};
  for (const v of VARS) {
    salvas[v] = process.env[v];
    delete process.env[v];
  }

  process.env.BRUTO_EMPACOTADO = "1";
  process.env.BRUTO_DATA_ROOT = dataRoot;
  process.env.NEXT_RUNTIME = "nodejs";

  ({ register } = await import("@/instrumentation"));
});

after(() => {
  for (const v of VARS) {
    if (salvas[v] === undefined) delete process.env[v];
    else process.env[v] = salvas[v]!;
  }
  fs.rmSync(raiz, { recursive: true, force: true });
});

describe("boot em modo pacote — .env da pessoa", () => {
  test("após o boot: chave conhecida no process.env, desconhecida fora, log sem valor", async () => {
    const linhas: string[] = [];
    const logOriginal = console.log;
    const warnOriginal = console.warn;
    console.log = (...args: unknown[]) => {
      linhas.push(args.map(String).join(" "));
    };
    console.warn = (...args: unknown[]) => {
      linhas.push(args.map(String).join(" "));
    };
    try {
      await register();
    } finally {
      console.log = logOriginal;
      console.warn = warnOriginal;
    }

    assert.equal(process.env.ANTHROPIC_API_KEY, CHAVE_FALSA, "o boot não carregou a chave");
    assert.equal(process.env.MALICIOSA, undefined, "variável desconhecida NÃO pode entrar");

    const log = linhas.join("\n");
    assert.match(log, /ANTHROPIC_API_KEY/, "o log diz QUAIS nomes foram carregados");
    assert.ok(!log.includes(CHAVE_FALSA), "o log NUNCA contém o valor da chave");
  });
});
