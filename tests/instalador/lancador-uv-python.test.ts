/**
 * `scripts/instalador-macos/Bruto` (o lançador) — classe U: nenhuma
 * ferramenta do pacote usa o que a máquina tem por acaso — Python do
 * sistema incluso.
 *
 * Achado da orquestradora (ambiente zerado): o uv montava o yt-dlp com o
 * Python 3.9 de /usr/bin/python3 (das Command Line Tools) — instala um
 * yt-dlp velho que o YouTube recusa ("The page needs to be reloaded"); em
 * Mac sem CLT, /usr/bin/python3 ainda abre o diálogo "instalar ferramentas
 * de desenvolvedor". O lançador passa a exportar
 * UV_PYTHON_PREFERENCE=only-managed junto das outras UV_*.
 *
 * Prova: Bruto.app FALSO com node FALSO que despeja o ambiente que
 * recebeu ao subir o servidor — o processo do pacote tem de ver
 * UV_PYTHON_PREFERENCE=only-managed (e as demais UV_* do contrato). Nada
 * toca o ~/.bruto real nem a porta 3000 (porta livre sorteada).
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PASTA_INSTALADOR = path.join(RAIZ, "scripts", "instalador-macos");
const VERSAO_PLIST = "1.2.3";

let tmp: string;
let home: string;
let dados: string;
let appFalso: string; // …/Bruto.app
let recursos: string; // …/Bruto.app/Contents/Resources
let porta: number;
let arqCurlVersao: string; // JSON que o curl falso devolve em /api/versao
let envMarca: string; // ambiente que o node do pacote recebeu
let pidMarca: string; // pids dos servidores falsos (limpeza)

function portaLivre(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
    s.on("error", reject);
  });
}

function rodarLancador(): Promise<{ rc: number | null; saida: string }> {
  return new Promise((resolve, reject) => {
    const filho = spawn(path.join(appFalso, "Contents", "MacOS", "Bruto"), [], {
      env: {
        HOME: home,
        PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
        NODE_ENV: "test",
        BRUTO_DATA_ROOT: dados,
        BRUTO_PORT: String(porta),
        BRUTO_SEM_JANELA: "1",
        CURL_VERSAO: arqCurlVersao,
        NODE_ENV_MARCA: envMarca,
        NODE_PID_MARCA: pidMarca,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let saida = "";
    filho.stdout.on("data", (d: Buffer) => {
      saida += d.toString();
    });
    filho.stderr.on("data", (d: Buffer) => {
      saida += d.toString();
    });
    const guarda = setTimeout(() => {
      filho.kill("SIGKILL");
      reject(new Error(`o lançador não saiu em 30 s. Saída até aqui: ${saida}`));
    }, 30_000);
    filho.on("error", (e) => {
      clearTimeout(guarda);
      reject(e);
    });
    filho.on("close", (codigo) => {
      clearTimeout(guarda);
      resolve({ rc: codigo, saida });
    });
  });
}

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bruto-uv-"));
  home = path.join(tmp, "home");
  dados = path.join(tmp, "dados");
  fs.mkdirSync(home);
  fs.mkdirSync(dados);
  porta = await portaLivre();

  appFalso = path.join(tmp, "app", "Bruto.app");
  recursos = path.join(appFalso, "Contents", "Resources");
  fs.mkdirSync(path.join(appFalso, "Contents", "MacOS"), { recursive: true });
  fs.mkdirSync(path.join(recursos, "bin"), { recursive: true });
  fs.mkdirSync(path.join(recursos, "app"), { recursive: true });

  // O lançador de verdade (cópia) e o Info.plist com a versão de teste.
  fs.copyFileSync(path.join(PASTA_INSTALADOR, "Bruto"), path.join(appFalso, "Contents", "MacOS", "Bruto"));
  fs.chmodSync(path.join(appFalso, "Contents", "MacOS", "Bruto"), 0o755);
  fs.writeFileSync(
    path.join(appFalso, "Contents", "Info.plist"),
    fs.readFileSync(path.join(PASTA_INSTALADOR, "Info.plist"), "utf8").replace(/@VERSAO@/g, VERSAO_PLIST),
  );

  arqCurlVersao = path.join(tmp, "curl-versao.json");
  envMarca = path.join(tmp, "node-env.txt");
  pidMarca = path.join(tmp, "node-pids.txt");

  // curl falso: /api/versao só responde DEPOIS que o servidor do pacote
  // subiu (o node falso despeja o ambiente antes de dormir) — antes disso,
  // a porta está "livre" e o lançador sobe o servidor (fluxo 5).
  fs.writeFileSync(
    path.join(recursos, "bin", "curl"),
    `#!/bin/bash
case "$*" in
  */api/versao*)
    if [ -s "$CURL_VERSAO" ] && [ -s "$NODE_ENV_MARCA" ]; then cat "$CURL_VERSAO"; exit 0; fi
    exit 22 ;;
esac
exit 7
`,
    { mode: 0o755 },
  );
  // node falso: ao virar o servidor do pacote, despeja o ambiente UV_* que
  // recebeu (é isto que a prova lê) e vive até TERM.
  fs.writeFileSync(
    path.join(recursos, "node"),
    `#!/bin/bash
if [ "\${1:-}" != "server.js" ]; then exit 1; fi
printenv | grep '^UV_' | sort > "$NODE_ENV_MARCA"
printf '%s\\n' "$$" >> "$NODE_PID_MARCA"
trap 'exit 0' TERM INT
sleep 600
`,
    { mode: 0o755 },
  );
});

after(async () => {
  for (const linha of fs.readFileSync(pidMarca, "utf8").split("\n").filter(Boolean)) {
    const pid = Number(linha);
    if (pid > 0) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        /* já morreu */
      }
    }
  }
  await new Promise((r) => setTimeout(r, 200));
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("classe U — nenhuma ferramenta do pacote usa o que a máquina tem por acaso", () => {
  test("o servidor do pacote sobe com UV_PYTHON_PREFERENCE=only-managed (e as demais UV_*)", async () => {
    fs.writeFileSync(arqCurlVersao, JSON.stringify({ app: "bruto", versao: VERSAO_PLIST, origem: "pacote" }));
    fs.rmSync(envMarca, { force: true });
    fs.rmSync(pidMarca, { force: true });
    fs.writeFileSync(path.join(dados, ".host-pacote-registrado"), "1"); // host já registrado

    const r = await rodarLancador();
    assert.equal(r.rc, 0, r.saida);
    const env = fs.readFileSync(envMarca, "utf8");
    assert.ok(
      env.includes("UV_PYTHON_PREFERENCE=only-managed"),
      `o servidor do pacote devia ver UV_PYTHON_PREFERENCE=only-managed — o que ele viu:\n${env}`,
    );
    for (const nome of ["UV_TOOL_DIR=", "UV_TOOL_BIN_DIR=", "UV_PYTHON_INSTALL_DIR=", "UV_CACHE_DIR="]) {
      assert.ok(env.includes(nome), `o contrato segue valendo: ${nome} devia estar no ambiente — o que ele viu:\n${env}`);
    }
  });
});
