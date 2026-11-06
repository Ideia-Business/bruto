/**
 * `ligar` com o launcher DEMORADO (cold start / rebuild depois de atualizar): o host tem de
 * esperar a vida do serve.sh em vez de desistir num prazo fixo curto. Achado do Codex de
 * 05/11/2026: o host parava de esperar em 30 s, mas o serve.sh pode rodar `npm run build` e
 * ainda aguardar ~40 s o servidor — a resposta era `falha-ao-ligar` enquanto o launcher seguia
 * e funcionava. Arquivo próprio para rodar em paralelo aos demais (leva ~35 s de relógio).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PASTA_LAUNCHER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "launcher");
const ATRASO_S = 33; // acima dos 30 s do prazo antigo

let tmp: string;
let launcher: string;
let porta: number;
let pidFile: string;

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

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bruto-host-lento-"));
  launcher = path.join(tmp, "launcher");
  fs.mkdirSync(launcher);
  for (const f of ["host-nativo.sh", "host-nativo.mjs", "_node.sh"]) {
    fs.copyFileSync(path.join(PASTA_LAUNCHER, f), path.join(launcher, f));
  }
  fs.chmodSync(path.join(launcher, "host-nativo.sh"), 0o755);
  pidFile = path.join(tmp, "servidor.pid");
  porta = await portaLivre();
  // serve.sh falso LENTO: simula o build, só então sobe o servidor, e sai 0 como o real.
  fs.writeFileSync(
    path.join(launcher, "serve.sh"),
    `#!/bin/bash
sleep ${ATRASO_S}
nohup node -e "require('http').createServer((q,s)=>s.end('ok')).listen(Number(process.env.BRUTO_PORT),'127.0.0.1')" >/dev/null 2>&1 &
echo $! > "$BRUTO_TESTE_PID"
sleep 1
exit 0
`,
    { mode: 0o755 },
  );
});

after(() => {
  try {
    const pid = Number(fs.readFileSync(pidFile, "utf8").trim());
    if (pid > 0) process.kill(pid, "SIGKILL");
  } catch {
    /* nunca subiu */
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

test(`ligar espera um launcher que leva ${ATRASO_S} s (mais que o prazo fixo antigo de 30 s) e responde iniciado=true`, { timeout: 120_000 }, async () => {
  const quadro = (() => {
    const corpo = Buffer.from('{"cmd":"ligar"}');
    const cab = Buffer.alloc(4);
    cab.writeUInt32LE(corpo.length, 0);
    return Buffer.concat([cab, corpo]);
  })();

  const saida = await new Promise<Buffer>((resolve, reject) => {
    const filho = spawn("/bin/bash", [path.join(launcher, "host-nativo.sh")], {
      env: { ...process.env, BRUTO_PORT: String(porta), BRUTO_TESTE_PID: pidFile },
      stdio: ["pipe", "pipe", "ignore"],
    });
    const partes: Buffer[] = [];
    filho.stdout.on("data", (d: Buffer) => partes.push(d));
    filho.on("error", reject);
    filho.on("close", () => resolve(Buffer.concat(partes)));
    filho.stdin.write(quadro);
    filho.stdin.end();
  });

  const resposta = JSON.parse(saida.subarray(4).toString("utf8"));
  assert.deepEqual(resposta, { ok: true, cmd: "ligar", rodando: true, iniciado: true, url: `http://127.0.0.1:${porta}` });
});
