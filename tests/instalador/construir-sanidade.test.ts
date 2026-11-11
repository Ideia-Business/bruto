/**
 * `scripts/instalador-macos/construir.sh` — classe S: NADA da máquina de
 * build sai no pacote (segredo, configuração local, ferramenta de build).
 *
 * Achado P1 da 2ª rodada (Codex): quando o checkout tem `.env` ou
 * `.env.production`, o builder standalone do Next os COPIA para
 * `.next/standalone` — e o `cp -R` disso para dentro do Bruto.app mandaria
 * as chaves de API do construtor no .app/.dmg público. Confirmado no
 * artefato real (dist/Bruto.app): além disso, o app montado levava a
 * `dist/` INTEIRA da máquina (140 MB, com um segundo binário `node` dentro),
 * `src/`, `tests/`, `scripts/` e caminhos absolutos `/Users/…` assados pelo
 * Next em `server.js` e `required-server-files.json`.
 *
 * Prova sem build de verdade: monta-se um Bruto.app FALSO com a sujeira
 * que o standalone pode trazer — um `.env` FALSO (valor de MENTIRA), mais
 * `.git`, `dist/`, um segundo binário `node` e um caminho absoluto
 * `/Users/` em `*.json` — e rodam-se direto as funções do script:
 * `sanitizar_app` (a remoção, ANTES de assinar) e
 * `provar_sanidade_do_pacote` (a prova, com falha alta). A sujeira some do
 * pacote; com a remoção "desligada" (só a prova roda), o build falha.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CONSTRUIR = path.join(RAIZ, "scripts", "instalador-macos", "construir.sh");

// Valor de MENTIRA (exigência do briefing): nenhum `.env` real é lido aqui.
const ENV_FALSO = "CHAVE_DE_TESTE=nao-e-segredo";

// A LISTA PERMITIDA do app montado (contrato, "Layout"): fora dela, nada
// entra. Espelha LISTA_PERMITIDA_APP do construir.sh.
const LISTA_PERMITIDA = [
  "server.js",
  "package.json",
  "node_modules",
  ".next",
  "public",
  "drizzle",
  ".env.example",
];

let tmp: string;
let appb: string; // …/Bruto.app
let app: string; // …/Bruto.app/Contents/Resources/app

function bashTrecho(trecho: string): { rc: number | null; saida: string } {
  const r = spawnSync("/bin/bash", ["-c", trecho], { encoding: "utf8" });
  return { rc: r.status, saida: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/** O app LIMPO: só o que a lista permitida admite, mais o esqueleto do bundle. */
function montarApp(): void {
  fs.rmSync(appb, { recursive: true, force: true });
  fs.mkdirSync(path.join(app, "node_modules", "x"), { recursive: true });
  fs.mkdirSync(path.join(app, ".next", "static"), { recursive: true });
  fs.mkdirSync(path.join(app, "public"), { recursive: true });
  fs.mkdirSync(path.join(app, "drizzle"), { recursive: true });
  fs.mkdirSync(path.join(appb, "Contents", "MacOS"), { recursive: true });
  fs.mkdirSync(path.join(appb, "Contents", "Resources", "bin"), { recursive: true });
  fs.writeFileSync(path.join(app, "server.js"), "console.log('bruto')\n");
  fs.writeFileSync(path.join(app, "package.json"), JSON.stringify({ name: "bruto", version: "0.0.0" }));
  fs.writeFileSync(path.join(app, "node_modules", "x", "index.js"), "module.exports = 1;\n");
  fs.writeFileSync(path.join(appb, "Contents", "MacOS", "Bruto"), "#!/bin/bash\nexit 0\n", { mode: 0o755 });
  fs.writeFileSync(path.join(appb, "Contents", "Resources", "node"), "#!/bin/bash\nexit 0\n", { mode: 0o755 });
}

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bruto-sanidade-"));
  appb = path.join(tmp, "Bruto.app");
  app = path.join(appb, "Contents", "Resources", "app");
});

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("classe S — nada da máquina de build sai no pacote", () => {
  test("sanitizar_app remove .env* (menos .env.example) e o que está fora da lista permitida; a prova passa", () => {
    montarApp();
    // a sujeira que o standalone do Next traz do checkout:
    fs.writeFileSync(path.join(app, ".env"), `${ENV_FALSO}\n`);
    fs.writeFileSync(path.join(app, ".env.production"), `${ENV_FALSO}\n`);
    fs.writeFileSync(path.join(app, ".env.local"), `${ENV_FALSO}\n`);
    fs.writeFileSync(path.join(app, "node_modules", "x", ".env"), `${ENV_FALSO}\n`); // profundo
    fs.writeFileSync(path.join(app, ".env.example"), "CHAVE_DE_EXEMPLO=preencha\n"); // FICA
    fs.mkdirSync(path.join(app, ".git"));
    fs.writeFileSync(path.join(app, ".git", "config"), "[core]\n");
    fs.mkdirSync(path.join(app, "dist"));
    fs.writeFileSync(path.join(app, "dist", "sobra.txt"), "sobra do build da máquina\n");
    fs.writeFileSync(path.join(app, "README.md"), "sobra do checkout\n");

    const r = bashTrecho(`source "${CONSTRUIR}" && sanitizar_app "${appb}" && provar_sanidade_do_pacote "${appb}"`);
    assert.equal(r.rc, 0, r.saida);

    for (const sujo of [".env", ".env.production", ".env.local", "node_modules/x/.env", ".git", "dist", "README.md"]) {
      assert.equal(fs.existsSync(path.join(app, sujo)), false, `devia sair do pacote: ${sujo}`);
    }
    for (const fica of LISTA_PERMITIDA) {
      assert.equal(fs.existsSync(path.join(app, fica)), true, `devia ficar no pacote: ${fica}`);
    }
  });

  test("sanitizar_app neutraliza o caminho absoluto da máquina que o Next assa em server.js", () => {
    montarApp();
    // como o standalone real: outputFileTracingRoot/repoRoot assados no
    // server.js gerado, com a raiz do CHECKOUT de build (a variável RAIZ do
    // construir.sh resolve para este mesmo repositório no teste)
    const raizDeBuild = RAIZ;
    fs.writeFileSync(
      path.join(app, "server.js"),
      `process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = '{"outputFileTracingRoot":"${raizDeBuild}","repoRoot":"${raizDeBuild}"}'\n`,
    );
    fs.writeFileSync(
      path.join(app, ".next", "required-server-files.json"),
      JSON.stringify({ version: 1, config: { outputFileTracingRoot: raizDeBuild } }),
    );
    const r = bashTrecho(`source "${CONSTRUIR}" && sanitizar_app "${appb}" && provar_sanidade_do_pacote "${appb}"`);
    assert.equal(r.rc, 0, r.saida);
    const serverJs = fs.readFileSync(path.join(app, "server.js"), "utf8");
    assert.equal(serverJs.includes(raizDeBuild), false, "o caminho da máquina não pode sair no server.js");
    const required = fs.readFileSync(path.join(app, ".next", "required-server-files.json"), "utf8");
    assert.equal(required.includes(raizDeBuild), false, "o caminho da máquina não pode sair no required-server-files.json");
  });

  // "o build FALHA se a remoção for desligada": só a PROVA roda, sem sanitizar.
  const cenarios: Array<{ nome: string; assinatura: string; sujar: (a: string) => void }> = [
    {
      nome: "um .env FALSO no pacote (chave de mentira)",
      assinatura: ".env",
      sujar: (a) => fs.writeFileSync(path.join(a, ".env"), `${ENV_FALSO}\n`),
    },
    {
      nome: "um .env.production no pacote",
      assinatura: ".env.production",
      sujar: (a) => fs.writeFileSync(path.join(a, ".env.production"), `${ENV_FALSO}\n`),
    },
    {
      nome: "um .git dentro do pacote",
      assinatura: ".git",
      sujar: (a) => {
        fs.mkdirSync(path.join(a, ".git"));
        fs.writeFileSync(path.join(a, ".git", "config"), "[core]\n");
      },
    },
    {
      nome: "um diretório dist/ dentro de Resources/app",
      assinatura: "dist",
      sujar: (a) => {
        fs.mkdirSync(path.join(a, "dist"));
        fs.writeFileSync(path.join(a, "dist", "sobra.txt"), "x\n");
      },
    },
    {
      nome: "um segundo binário node além de Resources/node",
      assinatura: "node_modules/ferramenta/node",
      sujar: (a) => {
        fs.mkdirSync(path.join(a, "node_modules", "ferramenta"), { recursive: true });
        fs.writeFileSync(path.join(a, "node_modules", "ferramenta", "node"), "#!/bin/bash\n", { mode: 0o755 });
      },
    },
    {
      nome: "um caminho absoluto da máquina de build (/Users/) em package.json",
      assinatura: "package.json",
      sujar: (a) => fs.writeFileSync(path.join(a, "package.json"), JSON.stringify({ caminho: "/Users/fulano/dev/bruto" })),
    },
    {
      nome: "um caminho absoluto da máquina de build (/Users/) em server.js",
      assinatura: "server.js",
      sujar: (a) => fs.writeFileSync(path.join(a, "server.js"), `const raiz = "/Users/fulano/dev/bruto";\n`),
    },
  ];

  for (const cenario of cenarios) {
    test(`a prova falha alta com ${cenario.nome}`, () => {
      montarApp();
      cenario.sujar(app);
      const r = bashTrecho(`source "${CONSTRUIR}" && provar_sanidade_do_pacote "${appb}"`);
      assert.notEqual(r.rc, 0, "o build devia falhar — nada de publicar este pacote");
      assert.ok(r.saida.includes("✗"), `falha alta com ✗ e motivo: ${r.saida}`);
      const base = cenario.assinatura.split("/").pop() ?? "";
      assert.ok(r.saida.includes(base), `o motivo devia citar a sujeira (${base}): ${r.saida}`);
    });
  }
});
