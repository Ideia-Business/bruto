/**
 * `scripts/instalador-macos/Bruto` — o lançador que vai em `Contents/MacOS/Bruto`
 * do pacote. Aqui ficam as decisões 2–4 do contrato e a primeira execução
 * (item 7), SEM build: monta-se um Bruto.app FALSO em pasta temporária com
 * `curl`, `open`, `osascript` e `node` FALSOS em `Contents/Resources/bin` e
 * `Contents/Resources/node` — o lançador põe `Resources/bin` na frente do PATH,
 * então os falsos vencem. Nada toca a porta 3000, o ~/.bruto real ou o app da
 * pessoa.
 *
 * INVARIANTE P3 (o lançador não mata o que não subiu) é o fio condutor: só o
 * processo cujo comando é `<Resources>/node … server.js` pode ser encerrado.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { ChildProcess, spawn } from "node:child_process";
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

// arquivos de cenário/marcas lidos pelos binários falsos
let arqCurlVersao: string;
let arqCurlViva: string;
let marcaNode: string;
let marcaOpen: string;
let marcaOsa: string;
let marcaReg: string;

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

const pidArquivo = (): number => {
  try {
    return Number(fs.readFileSync(path.join(dados, "servidor.pid"), "utf8").trim());
  } catch {
    return 0;
  }
};

const vivo = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

interface Retorno {
  rc: number | null;
  stdout: string;
}

/** Roda o lançador do bundle falso com o ambiente montado para o teste. */
function rodarLancador(extra: Record<string, string> = {}): Promise<Retorno> {
  return new Promise((resolve, reject) => {
    const filho = spawn(path.join(appFalso, "Contents/MacOS/Bruto"), [], {
      env: {
        HOME: home,
        PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
        NODE_ENV: "test",
        BRUTO_DATA_ROOT: dados,
        BRUTO_PORT: String(porta),
        CURL_VERSAO: arqCurlVersao,
        CURL_VIVA: arqCurlViva,
        NODE_MARCA: marcaNode,
        OPEN_MARCA: marcaOpen,
        OSA_MARCA: marcaOsa,
        REG_MARCA: marcaReg,
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
      reject(new Error(`o lançador não saiu em 30 s. Saída até aqui: ${saida}`));
    }, 30_000);
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

/** Sobe um "servidor antigo" com o MESMO formato que o pacote sobe (node falso). */
function subirServidorFalso(): ChildProcess {
  const filho = spawn("bash", [path.join(recursos, "node"), "server.js"], {
    env: { ...process.env, NODE_MARCA: marcaNode },
    stdio: "ignore",
  });
  filho.unref();
  return filho;
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Mata um processo falso gravado no marcaNode ("pid pidfilho" por linha). */
async function matarLinhasDoNode(): Promise<void> {
  for (const linha of linhasDe(marcaNode)) {
    const [pid, filho] = linha.split(" ").map(Number);
    for (const alvo of [pid, filho]) {
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

function prepararCenario(opcoes: { versaoJson?: string; portaViva?: boolean; semMarcaHost?: boolean }): void {
  if (opcoes.versaoJson === undefined) fs.rmSync(arqCurlVersao, { force: true });
  else fs.writeFileSync(arqCurlVersao, opcoes.versaoJson);
  fs.rmSync(arqCurlViva, { force: true });
  if (opcoes.portaViva) fs.writeFileSync(arqCurlViva, "1");
  for (const m of [marcaNode, marcaOpen, marcaOsa, marcaReg]) fs.rmSync(m, { force: true });
  fs.rmSync(path.join(dados, "servidor.pid"), { force: true });
  fs.rmSync(path.join(dados, ".host-pacote-registrado"), { force: true });
  if (!opcoes.semMarcaHost) {
    fs.writeFileSync(path.join(dados, ".host-pacote-registrado"), "1"); // já registrado
  }
}

const pidDeSleep = (): { pid: number; matar: () => void } => {
  const p = spawn("sleep", ["600"], { stdio: "ignore" });
  p.unref();
  return {
    pid: p.pid ?? 0,
    matar: () => {
      try {
        p.kill("SIGTERM");
      } catch {
        /* já saiu */
      }
    },
  };
};

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bruto-lancador-"));
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
  fs.mkdirSync(path.join(recursos, "launcher"), { recursive: true });

  // O lançador de verdade (cópia), o Info.plist com a versão de teste e os
  // binários falsos.
  fs.copyFileSync(path.join(PASTA_INSTALADOR, "Bruto"), path.join(appFalso, "Contents/MacOS/Bruto"));
  fs.chmodSync(path.join(appFalso, "Contents/MacOS/Bruto"), 0o755);
  fs.writeFileSync(
    path.join(appFalso, "Contents/Info.plist"),
    fs
      .readFileSync(path.join(PASTA_INSTALADOR, "Info.plist"), "utf8")
      .replace(/@VERSAO@/g, VERSAO_PLIST),
  );

  arqCurlVersao = path.join(tmp, "curl-versao.json");
  arqCurlViva = path.join(tmp, "curl-viva");
  marcaNode = path.join(tmp, "node-marcas");
  marcaOpen = path.join(tmp, "open-marcas");
  marcaOsa = path.join(tmp, "osa-marcas");
  marcaReg = path.join(tmp, "reg-marcas");

  // curl falso: /api/versao devolve o JSON do cenário (ou falha 22 se o
  // arquivo estiver vazio/ausente); qualquer outra URL só responde se a porta
  // "estiver viva" (arquivo presente).
  fs.writeFileSync(
    path.join(recursos, "bin", "curl"),
    `#!/bin/bash
args="$*"
case "$args" in
  */api/versao*)
    if [ -s "$CURL_VERSAO" ]; then cat "$CURL_VERSAO"; exit 0; fi
    exit 22 ;;
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
  // osascript falso: registra a chamada; diálogo devolve "Abrir mesmo assim".
  fs.writeFileSync(
    path.join(recursos, "bin", "osascript"),
    `#!/bin/bash
printf 'osascript %s\\n' "$*" >> "$OSA_MARCA"
case "$*" in
  *display\\ dialog*) printf 'button returned:Abrir mesmo assim\\n' ;;
esac
exit 0
`,
    { mode: 0o755 },
  );
  // node falso: "server.js" é o servidor do pacote — grava "pid pidfilho",
  // vive até TERM (aí mata o filho e sai). Qualquer outra chamada falha.
  fs.writeFileSync(
    path.join(recursos, "node"),
    `#!/bin/bash
if [ "\${1:-}" != "server.js" ]; then exit 1; fi
trap 'kill "\$FILHO" 2>/dev/null; exit 0' TERM INT
sleep 600 &
FILHO=$!
printf '%s %s\\n' "\$\$" "\$FILHO" >> "\$NODE_MARCA"
wait "\$FILHO"
`,
    { mode: 0o755 },
  );
  // registrar-host.sh falso (item 7): só registra que foi chamado.
  fs.writeFileSync(
    path.join(recursos, "registrar-host.sh"),
    `#!/bin/bash
printf 'registrou\\n' >> "$REG_MARCA"
exit 0
`,
    { mode: 0o755 },
  );
});

after(async () => {
  await matarLinhasDoNode();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("decisão 2 — porta com ESTE servidor desta versão: só a janela", () => {
  test("mesma versão: não sobe nem mata nada, só abre a janela", async () => {
    prepararCenario({
      versaoJson: JSON.stringify({ app: "bruto", versao: VERSAO_PLIST, origem: "pacote" }),
      portaViva: true,
    });
    const r = await rodarLancador();
    assert.equal(r.rc, 0, r.stdout);
    assert.equal(linhasDe(marcaNode).length, 0, "não devia subir servidor novo");
    assert.equal(pidArquivo(), 0, "não devia gravar servidor.pid");
    assert.equal(linhasDe(marcaOpen).length, 1, "devia abrir a janela exatamente uma vez");
    assert.ok(linhasDe(marcaOpen)[0].includes(`http://127.0.0.1:${porta}`), linhasDe(marcaOpen)[0]);
  });

  test("BRUTO_SEM_JANELA=1: não abre janela nenhuma", async () => {
    prepararCenario({
      versaoJson: JSON.stringify({ app: "bruto", versao: VERSAO_PLIST, origem: "pacote" }),
      portaViva: true,
    });
    const r = await rodarLancador({ BRUTO_SEM_JANELA: "1" });
    assert.equal(r.rc, 0, r.stdout);
    assert.equal(linhasDe(marcaOpen).length, 0);
    assert.equal(linhasDe(marcaNode).length, 0);
  });
});

describe("decisão 3 — outra versão do PACOTE na porta", () => {
  test("PID do arquivo é o servidor do pacote: encerra esse PID e sobe o novo", async () => {
    prepararCenario({
      versaoJson: JSON.stringify({ app: "bruto", versao: "9.9.9", origem: "pacote" }),
      portaViva: true,
    });
    const antigo = subirServidorFalso();
    const saiuAntigo = new Promise<void>((resolve) => antigo.once("exit", () => resolve()));
    await dormir(300); // deixa o falso gravar a marca
    assert.equal(linhasDe(marcaNode).length, 1, "o servidor antigo tem de estar no ar");
    const pidAntigo = Number(linhasDe(marcaNode)[0].split(" ")[0]);
    fs.writeFileSync(path.join(dados, "servidor.pid"), String(pidAntigo));

    try {
      const r = await rodarLancador();
      assert.equal(r.rc, 0, r.stdout);
      await Promise.race([saiuAntigo, dormir(5000)]);
      assert.equal(vivo(pidAntigo), false, "o servidor antigo devia ter sido encerrado");
      // um NOVO servidor subiu e virou o PID gravado
      assert.equal(linhasDe(marcaNode).length, 2, "devia subir um servidor novo");
      const pidNovo = Number(linhasDe(marcaNode)[1].split(" ")[0]);
      assert.equal(pidArquivo(), pidNovo, "servidor.pid devia apontar o servidor novo");
      assert.equal(linhasDe(marcaOpen).length, 1, "janela aberta uma vez");
    } finally {
      await matarLinhasDoNode();
    }
  });

  test("INVARIANTE P3: PID do arquivo é outro processo (sleep): NÃO mata, diálogo, não sobe nada", async () => {
    prepararCenario({
      versaoJson: JSON.stringify({ app: "bruto", versao: "9.9.9", origem: "pacote" }),
      portaViva: true,
    });
    const sono = pidDeSleep();
    fs.writeFileSync(path.join(dados, "servidor.pid"), String(sono.pid));

    try {
      const r = await rodarLancador();
      assert.equal(r.rc, 0, r.stdout);
      assert.ok(vivo(sono.pid), "processo que não é do pacote foi morto");
      assert.equal(linhasDe(marcaNode).length, 0, "não devia subir servidor");
      assert.equal(pidArquivo(), sono.pid, "não devia reescrever servidor.pid");
      assert.equal(linhasDe(marcaOsa).length, 1, "devia mostrar o diálogo");
      assert.ok(linhasDe(marcaOsa)[0].includes("display dialog"), linhasDe(marcaOsa)[0]);
      assert.ok(linhasDe(marcaOpen).length >= 0); // "Abrir mesmo assim" abre a janela do que está no ar
    } finally {
      sono.matar();
    }
  });
});

describe("decisão 4 — instalação antiga / clone na porta: NÃO mata nada", () => {
  test("porta responde sem /api/versao (instalação antiga): diálogo e o processo segue vivo", async () => {
    prepararCenario({ portaViva: true }); // /api/versao falha (arquivo ausente), raiz responde
    const sono = pidDeSleep();
    fs.writeFileSync(path.join(dados, "servidor.pid"), String(sono.pid));

    try {
      const r = await rodarLancador();
      assert.equal(r.rc, 0, r.stdout);
      assert.ok(vivo(sono.pid), "não devia matar processo nenhum");
      assert.equal(linhasDe(marcaNode).length, 0, "não devia subir servidor");
      assert.equal(linhasDe(marcaOsa).length, 1, "devia mostrar o diálogo");
      assert.ok(linhasDe(marcaOsa)[0].includes("Há outro Bruto aberto"), linhasDe(marcaOsa)[0]);
      assert.ok(linhasDe(marcaOpen).length >= 1, "“Abrir mesmo assim” devia abrir a janela");
    } finally {
      sono.matar();
    }
  });

  test("origem=clone (serve.sh do repo): mesma coisa — diálogo, nada morto", async () => {
    prepararCenario({
      versaoJson: JSON.stringify({ app: "bruto", versao: "0.2.0", origem: "clone" }),
      portaViva: true,
    });
    const r = await rodarLancador();
    assert.equal(r.rc, 0, r.stdout);
    assert.equal(linhasDe(marcaNode).length, 0);
    assert.equal(linhasDe(marcaOsa).length, 1);
  });

  test("BRUTO_SEM_JANELA=1 (host da extensão): sem diálogo e sai com erro — não dá para garantir o servidor", async () => {
    prepararCenario({ portaViva: true });
    const r = await rodarLancador({ BRUTO_SEM_JANELA: "1" });
    assert.notEqual(r.rc, 0, "porta ocupada por outra instalação é falha para o host");
    assert.equal(linhasDe(marcaOsa).length, 0, "host não mostra diálogo");
    assert.equal(linhasDe(marcaNode).length, 0);
  });
});

describe("primeira execução — registro do host nativo (item 7)", () => {
  test("primeira chamada roda o registrar-host.sh do pacote; a segunda não roda de novo", async () => {
    prepararCenario({
      versaoJson: JSON.stringify({ app: "bruto", versao: VERSAO_PLIST, origem: "pacote" }),
      portaViva: true,
      semMarcaHost: true,
    });
    const r1 = await rodarLancador();
    assert.equal(r1.rc, 0, r1.stdout);
    assert.equal(linhasDe(marcaReg).length, 1, "devia chamar o registrar-host.sh uma vez");
    assert.ok(fs.existsSync(path.join(dados, ".host-pacote-registrado")));

    const r2 = await rodarLancador();
    assert.equal(r2.rc, 0, r2.stdout);
    assert.equal(linhasDe(marcaReg).length, 1, "na segunda execução não registra de novo");
  });
});

describe("invariante P1 — o lançador não depende da máquina que construiu", () => {
  test("o script do lançador não cita /opt/homebrew nem /usr/local", () => {
    const texto = fs.readFileSync(path.join(appFalso, "Contents/MacOS/Bruto"), "utf8");
    assert.ok(!texto.includes("/opt/homebrew"), "lançador cita /opt/homebrew");
    assert.ok(!texto.includes("/usr/local"), "lançador cita /usr/local");
  });

  test("roda em ambiente ZERADO (env -i): só HOME/PATH/BRUTO_*", async () => {
    prepararCenario({
      versaoJson: JSON.stringify({ app: "bruto", versao: VERSAO_PLIST, origem: "pacote" }),
      portaViva: true,
    });
    const saida = await new Promise<string>((resolve, reject) => {
      const filho = spawn(
        "/usr/bin/env",
        [
          "-i",
          `HOME=${home}`,
          "PATH=/usr/bin:/bin:/usr/sbin:/sbin",
          `BRUTO_DATA_ROOT=${dados}`,
          `BRUTO_PORT=${porta}`,
          `CURL_VERSAO=${arqCurlVersao}`,
          `CURL_VIVA=${arqCurlViva}`,
          `NODE_MARCA=${marcaNode}`,
          `OPEN_MARCA=${marcaOpen}`,
          `OSA_MARCA=${marcaOsa}`,
          `REG_MARCA=${marcaReg}`,
          path.join(appFalso, "Contents/MacOS/Bruto"),
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      let t = "";
      filho.stdout.on("data", (d: Buffer) => (t += d.toString()));
      filho.stderr.on("data", (d: Buffer) => (t += d.toString()));
      const guarda = setTimeout(() => {
        filho.kill("SIGKILL");
        reject(new Error(`não saiu em 30 s: ${t}`));
      }, 30_000);
      filho.on("close", (codigo) => {
        clearTimeout(guarda);
        resolve(`rc=${codigo} ${t}`);
      });
    });
    assert.match(saida, /^rc=0/);
    assert.equal(linhasDe(marcaOpen).length, 1, "devia abrir a janela mesmo com env zerado");
  });
});
