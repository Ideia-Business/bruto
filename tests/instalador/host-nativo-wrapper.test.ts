/**
 * `scripts/instalador-macos/host-nativo.sh` — o wrapper do host de native
 * messaging DENTRO do pacote, nas DUAS variantes de layout (Resources/ e
 * Resources/launcher/). Roda o wrapper de verdade de dentro de um Bruto.app
 * falso montado em pasta temporária cujo caminho tem ESPAÇO ("Meus Apps") e
 * cujo realpath físico difere do lógico (/var → /private/var no macOS).
 *
 * O que se prova: o wrapper exporta BRUTO_LANCADOR CANÔNICO (absoluto, sem
 * "..", apontando para …/Bruto.app/Contents/MacOS/Bruto) e o host-nativo.mjs
 * de verdade ACEITA o valor — a checagem de sufixo literal do mjs rejeita
 * caminho com "/../" (lancador-invalido), então o wrapper é quem tem de
 * entregar o caminho resolvido (achado P2 da 1ª rodada do Codex).
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
const PACOTE = path.join(RAIZ, "scripts", "instalador-macos");
const LAUNCHER = path.join(RAIZ, "launcher");

let tmp: string;
let appFalso: string; // <tmp>/Meus Apps/Bruto.app — caminho COM espaço
let recursos: string; // …/Bruto.app/Contents/Resources
let porta: number;
let envLancador: string;
let pidLancador: string;

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
  stdout: string;
  resposta: Record<string, unknown> | null;
}

/** Roda uma variante do wrapper do pacote com uma mensagem do protocolo. */
function falar(wrapper: string, entrada: Buffer): Promise<Retorno> {
  return new Promise((resolve, reject) => {
    const filho = spawn("/bin/bash", [wrapper], {
      env: { ...process.env, BRUTO_PORT: String(porta), ENV_LANCADOR: envLancador, PID_LANCADOR: pidLancador },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const partes: Buffer[] = [];
    const erros: Buffer[] = [];
    filho.stdout.on("data", (d: Buffer) => partes.push(d));
    filho.stderr.on("data", (d: Buffer) => erros.push(d));
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
      resolve({ codigo, stdout: stdout.toString("utf8"), resposta });
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

/** Monta um Bruto.app falso na pasta dada: wrappers do pacote, node shim,
 * mjs de verdade e lançador falso que registra o ambiente que recebeu. */
function montarAppFalso(app: string): void {
  const rec = path.join(app, "Contents", "Resources");
  fs.mkdirSync(path.join(app, "Contents", "MacOS"), { recursive: true });
  fs.mkdirSync(path.join(rec, "launcher"), { recursive: true });
  fs.copyFileSync(path.join(LAUNCHER, "host-nativo.mjs"), path.join(rec, "host-nativo.mjs"));
  for (const destino of [path.join(rec, "host-nativo.sh"), path.join(rec, "launcher", "host-nativo.sh")]) {
    fs.copyFileSync(path.join(PACOTE, "host-nativo.sh"), destino);
    fs.chmodSync(destino, 0o755);
  }
  // node do "pacote": shim para o node real da máquina (o wrapper executa
  // Resources/node, nunca um node do PATH).
  fs.writeFileSync(path.join(rec, "node"), '#!/bin/bash\nexec node "$@"\n', { mode: 0o755 });
  // lançador falso: grava o BRUTO_LANCADOR que recebeu, argv, e sobe HTTP mínimo.
  fs.writeFileSync(
    path.join(app, "Contents", "MacOS", "Bruto"),
    `#!/bin/bash
printf 'BRUTO_LANCADOR=%s\\n' "\${BRUTO_LANCADOR:-}" >> "$ENV_LANCADOR"
printf 'argv:%s\\n' "$#" >> "$ENV_LANCADOR"
nohup node -e "require('http').createServer((q,s)=>s.end('ok')).listen(Number(process.env.BRUTO_PORT),'127.0.0.1')" >/dev/null 2>&1 &
echo $! > "$PID_LANCADOR"
exit 0
`,
    { mode: 0o755 },
  );
}

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bruto-wrapper-"));
  // Caminho com ESPAÇO de propósito: o sufixo literal e o spawn têm de
  // aturar. O realpath físico (/private/var/…) difere do lógico (/var/…).
  appFalso = path.join(tmp, "Meus Apps", "Bruto.app");
  recursos = path.join(appFalso, "Contents", "Resources");
  montarAppFalso(appFalso);
  porta = await portaLivre();
  envLancador = path.join(tmp, "lancador.env");
  pidLancador = path.join(tmp, "lancador.pid");
});

after(() => {
  matarPidDe(pidLancador);
  fs.rmSync(tmp, { recursive: true, force: true });
});

const VARIANTES = ["host-nativo.sh", "launcher/host-nativo.sh"]; // relativos a Resources/

describe("wrapper do pacote — as duas variantes exportam BRUTO_LANCADOR canônico", () => {
  for (const variante of VARIANTES) {
    test(`variante Resources/${variante}: caminho absoluto, sem "..", e o host-nativo.mjs ACEITA`, async () => {
      fs.rmSync(envLancador, { force: true });
      const r = await falar(path.join(recursos, ...variante.split("/")), msg({ cmd: "ligar" }));
      assert.equal(r.codigo, 0, `stderr/sys: ${r.stdout}`);
      assert.deepEqual(r.resposta, {
        ok: true,
        cmd: "ligar",
        rodando: true,
        iniciado: true,
        url: `http://127.0.0.1:${porta}`,
      });
      // o lançador do pacote rodou e gravou o BRUTO_LANCADOR que o wrapper exportou
      const env = fs.readFileSync(envLancador, "utf8");
      const esperado = path.join(appFalso, "Contents", "MacOS", "Bruto");
      const linha = env.split("\n").find((l) => l.startsWith("BRUTO_LANCADOR="));
      assert.equal(linha, `BRUTO_LANCADOR=${esperado}`, `exportado=${linha}`);
      const exportado = linha!.slice("BRUTO_LANCADOR=".length);
      assert.ok(path.isAbsolute(exportado), "o caminho exportado é absoluto");
      assert.ok(!exportado.includes(".."), "o caminho exportado é canônico (sem ..)");
      assert.ok(fs.existsSync(exportado), "o caminho exportado existe no pacote montado");
      fs.accessSync(exportado, fs.constants.X_OK);
      assert.match(env, /^argv:0$/m, "argv fixo: nenhum argumento");
      matarPidDe(pidLancador);
    });
  }

  test("lançador ausente no .app: o wrapper falha alto (stderr) sem sujar o stdout do protocolo", async () => {
    const appSemLancador = path.join(tmp, "Sem Lancer", "Bruto.app");
    montarAppFalso(appSemLancador);
    fs.rmSync(path.join(appSemLancador, "Contents", "MacOS", "Bruto"));
    fs.rmSync(envLancador, { force: true });
    const r = await falar(path.join(appSemLancador, "Contents", "Resources", "host-nativo.sh"), msg({ cmd: "ligar" }));
    assert.notEqual(r.codigo, 0, "sem lançador no pacote, o wrapper tem de falhar");
    assert.equal(r.stdout, "", "nada pode ir ao stdout: é o canal do protocolo");
    assert.ok(!fs.existsSync(envLancador), "o lançador inexistente não foi executado");
  });
});
