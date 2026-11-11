/**
 * `launcher/host-nativo.mjs` com `BRUTO_LANCADOR` (definido pelo host-nativo.sh
 * do PACOTE): o host passa a rodar o lançador do Bruto.app em vez do serve.sh —
 * mesmo argv fixo e `BRUTO_SEM_JANELA=1`. O caminho só é aceito se for
 * ABSOLUTO e terminar em `…/Bruto.app/Contents/MacOS/Bruto`: o host nunca vira
 * executor de comando arbitrário. Sem a variável, serve.sh como sempre
 * (INVARIANTE P2). Bundle falso + serve.sh falso, como nos testes existentes.
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
const PASTA_LAUNCHER = path.join(RAIZ, "launcher");

let tmp: string;
let launcher: string; // cópia do launcher/ com serve.sh falso
let appFalso: string; // …/Bruto.app com o lançador falso
let lancadorFalso: string;
let porta: number;
let marcaLancador: string;
let marcaServe: string;
let envLancador: string;
let pidLancador: string;
let pidServe: string;

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

interface Retorno {
  codigo: number | null;
  resposta: Record<string, unknown> | null;
}

function falar(entrada: Buffer, env: Record<string, string>): Promise<Retorno> {
  return new Promise((resolve, reject) => {
    const filho = spawn("/bin/bash", [path.join(launcher, "host-nativo.sh")], {
      env: { ...process.env, BRUTO_PORT: String(porta), ...env },
      stdio: ["pipe", "pipe", "ignore"],
    });
    const partes: Buffer[] = [];
    filho.stdout.on("data", (d: Buffer) => partes.push(d));
    filho.on("error", reject);
    const guarda = setTimeout(() => {
      filho.kill("SIGKILL");
      reject(new Error("o host não respondeu em 45 s"));
    }, 45_000);
    filho.on("close", (codigo) => {
      clearTimeout(guarda);
      const stdout = Buffer.concat(partes);
      let resposta: Record<string, unknown> | null = null;
      if (stdout.length >= 4) {
        const n = stdout.readUInt32LE(0);
        if (stdout.length === 4 + n) resposta = JSON.parse(stdout.subarray(4).toString("utf8"));
      }
      resolve({ codigo, resposta });
    });
    filho.stdin.write(entrada);
    filho.stdin.end();
  });
}

const msg = (obj: unknown): Buffer => {
  const corpo = Buffer.from(JSON.stringify(obj), "utf8");
  const cab = Buffer.alloc(4);
  cab.writeUInt32LE(corpo.length, 0);
  return Buffer.concat([cab, corpo]);
};

function matarPidDe(arquivo: string): void {
  try {
    const pid = Number(fs.readFileSync(arquivo, "utf8").trim());
    if (pid > 0) process.kill(pid, "SIGKILL");
  } catch {
    /* já morreu ou nunca subiu */
  }
}

const existe = (arquivo: string): boolean => fs.existsSync(arquivo);

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bruto-host-lancador-"));
  launcher = path.join(tmp, "launcher");
  fs.mkdirSync(launcher);
  for (const f of ["host-nativo.sh", "host-nativo.mjs", "_node.sh"]) {
    fs.copyFileSync(path.join(PASTA_LAUNCHER, f), path.join(launcher, f));
  }
  fs.chmodSync(path.join(launcher, "host-nativo.sh"), 0o755);

  porta = await portaLivre();
  marcaLancador = path.join(tmp, "lancador-marcas");
  marcaServe = path.join(tmp, "serve-marcas");
  envLancador = path.join(tmp, "lancador.env");
  pidLancador = path.join(tmp, "lancador.pid");
  pidServe = path.join(tmp, "serve.pid");

  // serve.sh falso (modo clone): grava marca e sobe HTTP mínimo.
  fs.writeFileSync(
    path.join(launcher, "serve.sh"),
    `#!/bin/bash
printf 'serve\\n' >> "$MARCA_SERVE"
nohup node -e "require('http').createServer((q,s)=>s.end('ok')).listen(Number(process.env.BRUTO_PORT),'127.0.0.1')" >/dev/null 2>&1 &
echo $! > "$PID_SERVE"
exit 0
`,
    { mode: 0o755 },
  );

  // Bruto.app falso: o lançador "do pacote" grava o ambiente que recebeu e
  // sobe HTTP mínimo — o suficiente para o host ver a porta responder.
  appFalso = path.join(tmp, "app", "Bruto.app");
  lancadorFalso = path.join(appFalso, "Contents", "MacOS", "Bruto");
  fs.mkdirSync(path.dirname(lancadorFalso), { recursive: true });
  fs.writeFileSync(
    lancadorFalso,
    `#!/bin/bash
printf 'lancador\\n' >> "$MARCA_LANCADOR"
printf 'SEM_JANELA=%s\\n' "\${BRUTO_SEM_JANELA:-}" > "$ENV_LANCADOR"
printf 'argv:%s\\n' "$#" >> "$ENV_LANCADOR"
nohup node -e "require('http').createServer((q,s)=>s.end('ok')).listen(Number(process.env.BRUTO_PORT),'127.0.0.1')" >/dev/null 2>&1 &
echo $! > "$PID_LANCADOR"
exit 0
`,
    { mode: 0o755 },
  );
});

after(() => {
  matarPidDe(pidLancador);
  matarPidDe(pidServe);
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("host nativo — BRUTO_LANCADOR (modo pacote)", () => {
  test("com BRUTO_LANCADOR: roda o lançador do pacote (nunca o serve.sh), com BRUTO_SEM_JANELA=1 e sem argumentos", async () => {
    const r = await falar(msg({ cmd: "ligar" }), {
      BRUTO_LANCADOR: lancadorFalso,
      MARCA_LANCADOR: marcaLancador,
      ENV_LANCADOR: envLancador,
      PID_LANCADOR: pidLancador,
      MARCA_SERVE: marcaServe,
      PID_SERVE: pidServe,
    });
    assert.equal(r.codigo, 0);
    assert.deepEqual(r.resposta, { ok: true, cmd: "ligar", rodando: true, iniciado: true, url: `http://127.0.0.1:${porta}` });
    assert.ok(existe(marcaLancador), "o lançador do pacote não foi chamado");
    assert.ok(!existe(marcaServe), "o serve.sh não devia ser chamado no modo pacote");
    const env = fs.readFileSync(envLancador, "utf8");
    assert.match(env, /^SEM_JANELA=1$/m);
    assert.match(env, /^argv:0$/m, "o argv tem de ser fixo: nenhum argumento");
    matarPidDe(pidLancador);
  });

  test("com BRUTO_LANCADOR, servidor já no ar: rodando=true, iniciado=false, nada executado", async () => {
    // sobe um servidor de verdade na porta e limpa as marcas do teste anterior
    const filho = spawn(
      "node",
      ["-e", "require('http').createServer((q,s)=>s.end('ok')).listen(Number(process.env.PORTA),'127.0.0.1')"],
      { env: { ...process.env, PORTA: String(porta) }, stdio: "ignore" },
    );
    filho.unref();
    await new Promise((r) => setTimeout(r, 400));
    fs.rmSync(marcaLancador, { force: true });
    fs.rmSync(marcaServe, { force: true });
    const r = await falar(msg({ cmd: "ligar" }), {
      BRUTO_LANCADOR: lancadorFalso,
      MARCA_LANCADOR: marcaLancador,
      MARCA_SERVE: marcaServe,
    });
    assert.equal(r.codigo, 0);
    assert.equal(r.resposta?.iniciado, false);
    assert.equal(r.resposta?.rodando, true);
    assert.ok(!existe(marcaLancador), "não devia executar o lançador de novo");
    assert.ok(!existe(marcaServe));
    try {
      process.kill(filho.pid!, "SIGKILL");
    } catch {
      /* já saiu */
    }
  });

  test("BRUTO_LANCADOR=/bin/bash (absoluto, sufixo errado): lancador-invalido e NADA é executado", async () => {
    const r = await falar(msg({ cmd: "ligar" }), {
      BRUTO_LANCADOR: "/bin/bash",
      MARCA_LANCADOR: marcaLancador,
      MARCA_SERVE: marcaServe,
    });
    assert.equal(r.codigo, 0);
    assert.deepEqual(r.resposta, { ok: false, erro: "lancador-invalido" });
    assert.ok(!existe(marcaLancador));
    assert.ok(!existe(marcaServe));
  });

  test("BRUTO_LANCADOR relativo: lancador-invalido, nada executado", async () => {
    const r = await falar(msg({ cmd: "ligar" }), {
      BRUTO_LANCADOR: "../app/Bruto.app/Contents/MacOS/Bruto",
      MARCA_LANCADOR: marcaLancador,
    });
    assert.deepEqual(r.resposta, { ok: false, erro: "lancador-invalido" });
    assert.ok(!existe(marcaLancador));
  });

  test("BRUTO_LANCADOR com o formato certo mas arquivo ausente: falha-ao-ligar, sem execução estranha", async () => {
    const r = await falar(msg({ cmd: "ligar" }), {
      BRUTO_LANCADOR: path.join(tmp, "nao-existe", "Bruto.app", "Contents", "MacOS", "Bruto"),
      MARCA_LANCADOR: marcaLancador,
    });
    assert.equal(r.codigo, 0);
    assert.deepEqual(r.resposta, { ok: false, erro: "falha-ao-ligar" });
  });
});

describe("host nativo — sem BRUTO_LANCADOR (modo clone, INVARIANTE P2)", () => {
  test("com a variável ausente: serve.sh, como sempre", async () => {
    const r = await falar(msg({ cmd: "ligar" }), {
      MARCA_SERVE: marcaServe,
      PID_SERVE: pidServe,
      MARCA_LANCADOR: marcaLancador,
    });
    assert.equal(r.codigo, 0);
    assert.deepEqual(r.resposta, { ok: true, cmd: "ligar", rodando: true, iniciado: true, url: `http://127.0.0.1:${porta}` });
    assert.ok(existe(marcaServe), "o serve.sh devia ser chamado");
    assert.ok(!existe(marcaLancador), "o lançador do pacote não devia ser chamado");
    matarPidDe(pidServe);
  });
});
