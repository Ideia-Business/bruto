/**
 * `launcher/host-nativo.sh` + `.mjs` — o host de Chrome native messaging (ADR 0003).
 * Fala o protocolo enquadrado (4 bytes LE + JSON) de verdade, por processo, contra uma
 * cópia do launcher com um `serve.sh` FALSO (um servidor HTTP mínimo): nada aqui toca o
 * app real da pessoa nem a porta 3000. Cobre: os dois comandos, os códigos de erro, o
 * limite de tamanho, stdout só com o protocolo, `BRUTO_SEM_JANELA=1` e o servidor que
 * sobrevive ao fim do host.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PASTA_LAUNCHER = path.join(RAIZ, "launcher");

let tmp: string;
let launcher: string;
let porta: number;
let pidFile: string;
let envFile: string;

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

function servidorNoAr(): Promise<boolean> {
  return new Promise((resolve) => {
    const c = net.connect({ host: "127.0.0.1", port: porta }, () => {
      c.destroy();
      resolve(true);
    });
    c.on("error", () => resolve(false));
  });
}

function enquadrar(corpo: Buffer, tamanhoDeclarado = corpo.length): Buffer {
  const cab = Buffer.alloc(4);
  cab.writeUInt32LE(tamanhoDeclarado, 0);
  return Buffer.concat([cab, corpo]);
}

interface Retorno {
  codigo: number | null;
  stdout: Buffer;
  resposta: Record<string, unknown> | null;
}

/** Roda o host como o Chrome roda: stdin recebe a mensagem e FICA ABERTO se `fecharStdin` for false. */
function falar(entrada: Buffer, opcoes: { fecharStdin?: boolean } = {}): Promise<Retorno> {
  const { fecharStdin = true } = opcoes;
  return new Promise((resolve, reject) => {
    const filho = spawn("/bin/bash", [path.join(launcher, "host-nativo.sh")], {
      env: { ...process.env, BRUTO_PORT: String(porta), BRUTO_TESTE_PID: pidFile, BRUTO_TESTE_ENV: envFile },
      stdio: ["pipe", "pipe", "pipe"],
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
      resolve({ codigo, stdout, resposta });
    });
    filho.stdin.write(entrada);
    if (fecharStdin) filho.stdin.end();
  });
}

const msg = (obj: unknown) => enquadrar(Buffer.from(JSON.stringify(obj), "utf8"));

function matarServidorDeTeste(): void {
  try {
    const pid = Number(fs.readFileSync(pidFile, "utf8").trim());
    if (pid > 0) process.kill(pid, "SIGKILL");
  } catch {
    /* já morreu, ou nunca subiu */
  }
}

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bruto-host-"));
  launcher = path.join(tmp, "launcher");
  fs.mkdirSync(launcher);
  for (const f of ["host-nativo.sh", "host-nativo.mjs", "_node.sh"]) {
    fs.copyFileSync(path.join(PASTA_LAUNCHER, f), path.join(launcher, f));
  }
  fs.chmodSync(path.join(launcher, "host-nativo.sh"), 0o755);
  pidFile = path.join(tmp, "servidor.pid");
  envFile = path.join(tmp, "serve.env");
  porta = await portaLivre();
  // serve.sh falso: grava o ambiente que recebeu, sobe um HTTP mínimo em segundo plano e sai 0.
  fs.writeFileSync(
    path.join(launcher, "serve.sh"),
    `#!/bin/bash
printf 'SEM_JANELA=%s\\n' "\${BRUTO_SEM_JANELA:-}" > "$BRUTO_TESTE_ENV"
nohup node -e "require('http').createServer((q,s)=>s.end('ok')).listen(Number(process.env.BRUTO_PORT),'127.0.0.1')" >/dev/null 2>&1 &
echo $! > "$BRUTO_TESTE_PID"
exit 0
`,
    { mode: 0o755 },
  );
});

after(() => {
  matarServidorDeTeste();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("host nativo — protocolo", () => {
  test("status com o servidor fora: rodando=false e URL da porta", async () => {
    const r = await falar(msg({ cmd: "status" }));
    assert.equal(r.codigo, 0);
    assert.deepEqual(r.resposta, { ok: true, cmd: "status", rodando: false, url: `http://127.0.0.1:${porta}` });
  });

  test("stdout só tem o quadro do protocolo: nenhum byte a mais (nem do wrapper, nem do _node.sh)", async () => {
    const r = await falar(msg({ cmd: "status" }));
    assert.ok(r.resposta, "stdout não é exatamente um quadro [4 bytes + JSON]");
    assert.equal(r.stdout.length, 4 + r.stdout.readUInt32LE(0));
  });

  test("comando desconhecido e variações hostis: comando-desconhecido, sem executar nada", async () => {
    const marca = path.join(tmp, "NAO-DEVE-EXISTIR");
    for (const entrada of [
      { cmd: "rm" },
      { cmd: `status; touch ${marca}` },
      { cmd: "STATUS" },
      { action: "start_server" },
      { cmd: ["status"] },
      {},
    ]) {
      const r = await falar(msg(entrada));
      assert.equal(r.codigo, 0);
      assert.deepEqual(r.resposta, { ok: false, erro: "comando-desconhecido" }, JSON.stringify(entrada));
    }
    assert.equal(fs.existsSync(marca), false, "a mensagem virou comando de shell");
  });

  test("campos extras na mensagem são ignorados, nunca usados", async () => {
    const r = await falar(msg({ cmd: "status", argv: "--evil", env: { BRUTO_PORT: "1" }, path: "/etc/passwd" }));
    assert.deepEqual(r.resposta, { ok: true, cmd: "status", rodando: false, url: `http://127.0.0.1:${porta}` });
  });

  test("mensagem inválida: JSON quebrado, não-objeto, vazio, cabeçalho curto", async () => {
    const casos: Buffer[] = [
      enquadrar(Buffer.from("{quebrado")),
      enquadrar(Buffer.from('["status"]')),
      enquadrar(Buffer.from("null")),
      Buffer.alloc(0),
      Buffer.from([1, 0]),
    ];
    for (const c of casos) {
      const r = await falar(c);
      assert.equal(r.codigo, 0);
      assert.deepEqual(r.resposta, { ok: false, erro: "mensagem-invalida" });
    }
  });

  test("tamanho declarado maior que o enviado (stdin fecha antes): mensagem-invalida", async () => {
    const corpo = Buffer.from('{"cmd":"status"}');
    const r = await falar(enquadrar(corpo, corpo.length + 50));
    assert.deepEqual(r.resposta, { ok: false, erro: "mensagem-invalida" });
  });

  test("mensagem acima de 1024 bytes é recusada", async () => {
    const grande = Buffer.from(JSON.stringify({ cmd: "status", lixo: "a".repeat(2000) }));
    const r = await falar(enquadrar(grande));
    assert.deepEqual(r.resposta, { ok: false, erro: "mensagem-invalida" });
  });

  test("responde e sai mesmo com o stdin ainda aberto (como o Chrome faz)", async () => {
    const r = await falar(msg({ cmd: "status" }), { fecharStdin: false });
    assert.equal(r.codigo, 0);
    assert.equal(r.resposta?.ok, true);
  });
});

describe("host nativo — ligar", () => {
  test("liga o servidor com BRUTO_SEM_JANELA=1; depois, já no ar, iniciado=false; e o servidor sobrevive ao host", async () => {
    assert.equal(await servidorNoAr(), false, "a porta de teste deveria começar livre");

    const primeira = await falar(msg({ cmd: "ligar" }));
    assert.equal(primeira.codigo, 0);
    assert.deepEqual(primeira.resposta, {
      ok: true,
      cmd: "ligar",
      rodando: true,
      iniciado: true,
      url: `http://127.0.0.1:${porta}`,
    });
    assert.equal(fs.readFileSync(envFile, "utf8").trim(), "SEM_JANELA=1", "o serve.sh tem de receber BRUTO_SEM_JANELA=1");

    // O host já saiu (exit 0 acima) e o servidor continua de pé: sessão própria.
    assert.equal(await servidorNoAr(), true, "o servidor morreu junto com o host");

    const segunda = await falar(msg({ cmd: "ligar" }));
    assert.equal(segunda.resposta?.iniciado, false);
    assert.equal(segunda.resposta?.rodando, true);

    const status = await falar(msg({ cmd: "status" }));
    assert.equal(status.resposta?.rodando, true);
  });

  test("serve.sh que sai com erro: falha-ao-ligar, sem esperar os 30 s", async () => {
    matarServidorDeTeste();
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(await servidorNoAr(), false);
    fs.writeFileSync(path.join(launcher, "serve.sh"), "#!/bin/bash\nexit 3\n", { mode: 0o755 });
    const inicio = Date.now();
    const r = await falar(msg({ cmd: "ligar" }));
    assert.deepEqual(r.resposta, { ok: false, erro: "falha-ao-ligar" });
    assert.ok(Date.now() - inicio < 15_000, "deveria falhar logo, não esgotar os 30 s");
  });
});

describe("serve.sh real — BRUTO_SEM_JANELA", () => {
  test("com a variável, sai antes do bloco que abre a janela; sem ela, o bloco continua lá", () => {
    const texto = fs.readFileSync(path.join(PASTA_LAUNCHER, "serve.sh"), "utf8");
    const iSaida = texto.indexOf('if [ -n "${BRUTO_SEM_JANELA:-}" ]; then exit 0; fi');
    const iJanela = texto.indexOf("# Abre em janela de app");
    assert.ok(iSaida > 0 && iJanela > 0, "marcadores não encontrados");
    assert.ok(iSaida < iJanela, "a saída antecipada tem de vir antes do bloco da janela");
    const sintaxe = spawnSync("bash", ["-n", path.join(PASTA_LAUNCHER, "serve.sh")]);
    assert.equal(sintaxe.status, 0);
  });
});
