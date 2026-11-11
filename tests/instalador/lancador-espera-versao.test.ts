/**
 * `scripts/instalador-macos/Bruto` — item 5 do contrato, sem a muleta: depois
 * de subir o PRÓPRIO servidor, o lançador espera `/api/versao` responder com
 * `origem=pacote`; se não vier em 60 s, FALHA com notificação e o caminho do
 * log — nunca abre janela para um servidor que não provou ser o do pacote
 * (remoção da decisão "sem /api/versao, mas a porta responde — seguindo",
 * achado da 1ª rodada do Codex).
 *
 * Cenário: porta LIVRE no início, servidor falso que passa a responder HTTP
 * (porta viva) mas NUNCA responde /api/versao. O teste dura ~60 s — é o prazo
 * real do contrato que se está provando.
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
let appFalso: string;
let recursos: string;
let porta: number;
let arqCurlViva: string;
let marcaNode: string;
let marcaOpen: string;
let marcaOsa: string;

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

const linhasDe = (arquivo: string): string[] => {
  try {
    return fs.readFileSync(arquivo, "utf8").split("\n").filter((l) => l.trim() !== "");
  } catch {
    return [];
  }
};

interface Retorno {
  rc: number | null;
  stdout: string;
}

/** Roda o lançador do bundle falso. Guarda de 100 s: o prazo do contrato é 60 s. */
function rodarLancador(extra: Record<string, string> = {}): Promise<Retorno> {
  return new Promise((resolve, reject) => {
    const filho = spawn(path.join(appFalso, "Contents/MacOS/Bruto"), [], {
      env: {
        HOME: home,
        PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
        NODE_ENV: "test",
        BRUTO_DATA_ROOT: dados,
        BRUTO_PORT: String(porta),
        CURL_VIVA: arqCurlViva,
        NODE_MARCA: marcaNode,
        OPEN_MARCA: marcaOpen,
        OSA_MARCA: marcaOsa,
        ...extra,
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
      reject(new Error(`o lançador não saiu em 100 s. Saída até aqui: ${saida}`));
    }, 100_000);
    filho.on("error", (e) => {
      clearTimeout(guarda);
      reject(e);
    });
    filho.on("close", (codigo) => {
      clearTimeout(guarda);
      resolve({ rc: codigo, stdout: saida });
    });
  });
}

async function matarLinhasDoNode(): Promise<void> {
  for (const linha of linhasDe(marcaNode)) {
    const pids = linha.split(" ").map(Number);
    for (const alvo of pids) {
      if (alvo > 0) {
        try {
          process.kill(alvo, "SIGTERM");
        } catch {
          /* já morreu */
        }
      }
    }
  }
  await new Promise((r) => setTimeout(r, 200));
}

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bruto-espera-"));
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

  fs.copyFileSync(path.join(PASTA_INSTALADOR, "Bruto"), path.join(appFalso, "Contents/MacOS/Bruto"));
  fs.chmodSync(path.join(appFalso, "Contents/MacOS/Bruto"), 0o755);
  fs.writeFileSync(
    path.join(appFalso, "Contents/Info.plist"),
    fs.readFileSync(path.join(PASTA_INSTALADOR, "Info.plist"), "utf8").replace(/@VERSAO@/g, VERSAO_PLIST),
  );

  arqCurlViva = path.join(tmp, "curl-viva");
  marcaNode = path.join(tmp, "node-marcas");
  marcaOpen = path.join(tmp, "open-marcas");
  marcaOsa = path.join(tmp, "osa-marcas");

  // curl falso: /api/versao NUNCA responde (sem arquivo de cenário); as
  // outras URLs respondem a partir do momento em que o arquivo CURL_VIVA
  // existe (é o "servidor no ar" que não prova nada).
  fs.writeFileSync(
    path.join(recursos, "bin", "curl"),
    `#!/bin/bash
case "$*" in
  */api/versao*) exit 22 ;;
esac
if [ -e "$CURL_VIVA" ]; then printf 'ok'; exit 0; fi
exit 7
`,
    { mode: 0o755 },
  );
  fs.writeFileSync(
    path.join(recursos, "bin", "open"),
    `#!/bin/bash
printf 'open %s\\n' "$*" >> "$OPEN_MARCA"
exit 0
`,
    { mode: 0o755 },
  );
  fs.writeFileSync(
    path.join(recursos, "bin", "osascript"),
    `#!/bin/bash
printf 'osascript %s\\n' "$*" >> "$OSA_MARCA"
exit 0
`,
    { mode: 0o755 },
  );
  // node falso: o "servidor do pacote". Ao subir, a porta passa a responder
  // (CURL_VIVA aparece) — mas /api/versao continua calado para sempre.
  fs.writeFileSync(
    path.join(recursos, "node"),
    `#!/bin/bash
if [ "\${1:-}" != "server.js" ]; then exit 1; fi
printf 'viva' > "$CURL_VIVA"
trap 'kill "\$FILHO" 2>/dev/null; exit 0' TERM INT
sleep 600 &
FILHO=$!
printf '%s %s\\n' "\$\$" "\$FILHO" >> "\$NODE_MARCA"
wait "\$FILHO"
`,
    { mode: 0o755 },
  );
  fs.writeFileSync(path.join(recursos, "registrar-host.sh"), "#!/bin/bash\nexit 0\n", { mode: 0o755 });
  // host já "registrado": este teste é só do item 5.
  fs.writeFileSync(path.join(dados, ".host-pacote-registrado"), "1");
});

after(async () => {
  await matarLinhasDoNode();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("item 5 — sem /api/versao com origem=pacote não há janela", () => {
  test("porta responde HTTP mas nunca /api/versao: falha, notifica com o log e NÃO abre janela", async () => {
    for (const m of [marcaNode, marcaOpen, marcaOsa]) fs.rmSync(m, { force: true });
    fs.rmSync(arqCurlViva, { force: true });
    fs.rmSync(path.join(dados, "servidor.pid"), { force: true });

    const r = await rodarLancador();

    assert.notEqual(r.rc, 0, "sem a prova /api/versao=origem pacote, o lançador tem de falhar");
    assert.equal(linhasDe(marcaOpen).length, 0, "nunca abre janela para servidor que não provou ser o do pacote");
    assert.ok(linhasDe(marcaNode).length >= 1, "o lançador devia ter subido o próprio servidor antes de desistir");
    const osa = linhasDe(marcaOsa).join("\n");
    assert.ok(osa.includes("display notification"), `devia notificar a falha — osa: ${osa}`);
    assert.ok(osa.includes(path.join(dados, "logs", "servidor.log")), `a notificação cita o caminho do log — osa: ${osa}`);
    const log = fs.readFileSync(path.join(dados, "logs", "servidor.log"), "utf8");
    assert.match(log, /60 s/, "o log registra o estouro do prazo");
  });
});
