/**
 * `launcher/registrar-host.sh` — registra o host de native messaging por navegador (ADR 0003).
 * Roda o script de verdade com `HOME` num diretório temporário: nada aqui toca os
 * NativeMessagingHosts reais da pessoa. Cobre: só navegadores que existem, JSON válido com
 * caminho absoluto, idempotência, `--remover` só do arquivo próprio, nunca inventar ID,
 * e a derivação do ID a partir do campo `key` conferida por um cálculo independente.
 */
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const REGISTRAR = path.join(RAIZ, "launcher", "registrar-host.sh");
const ARQUIVO = "com.ideiabusiness.bruto.json";
const ID_VALIDO = "abcdefghijklmnopabcdefghijklmnop";

const ehMac = process.platform === "darwin";
/** Pasta de dados de cada navegador, relativa ao HOME, como o registrador as enumera. */
const NAVEGADORES: Record<string, string> = ehMac
  ? {
      chrome: "Library/Application Support/Google/Chrome",
      chromium: "Library/Application Support/Chromium",
      edge: "Library/Application Support/Microsoft Edge",
      brave: "Library/Application Support/BraveSoftware/Brave-Browser",
    }
  : {
      chrome: ".config/google-chrome",
      chromium: ".config/chromium",
      edge: ".config/microsoft-edge",
      brave: ".config/BraveSoftware/Brave-Browser",
    };

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "bruto-registrar-"));
});
afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

function criarNavegadores(...quais: string[]): void {
  for (const q of quais) fs.mkdirSync(path.join(home, NAVEGADORES[q]), { recursive: true });
}
const manifestoDe = (q: string) => path.join(home, NAVEGADORES[q], "NativeMessagingHosts", ARQUIVO);

function rodar(args: string[], extra: { env?: Record<string, string>; script?: string } = {}) {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, ...extra.env };
  delete env.BRUTO_EXTENSAO_ID;
  Object.assign(env, extra.env);
  return spawnSync("bash", [extra.script ?? REGISTRAR, ...args], { env, encoding: "utf8" });
}

describe("registrar-host.sh", () => {
  test("escreve só nos navegadores que existem, com JSON válido, caminho absoluto e a origem da extensão", () => {
    criarNavegadores("chrome", "edge");
    const r = rodar(["--extensao-id", ID_VALIDO]);
    assert.equal(r.status, 0, r.stderr);

    assert.ok(fs.existsSync(manifestoDe("chrome")));
    assert.ok(fs.existsSync(manifestoDe("edge")));
    assert.equal(fs.existsSync(path.dirname(path.join(home, NAVEGADORES.chromium))) && fs.existsSync(path.join(home, NAVEGADORES.chromium)), false, "não cria a árvore de navegador ausente");
    assert.equal(fs.existsSync(path.join(home, NAVEGADORES.brave)), false);

    const m = JSON.parse(fs.readFileSync(manifestoDe("chrome"), "utf8"));
    assert.equal(m.name, "com.ideiabusiness.bruto");
    assert.equal(m.type, "stdio");
    assert.deepEqual(m.allowed_origins, [`chrome-extension://${ID_VALIDO}/`]);
    assert.ok(path.isAbsolute(m.path));
    assert.equal(m.path, path.join(RAIZ, "launcher", "host-nativo.sh"));
    assert.ok(fs.existsSync(m.path), "o manifesto aponta para um arquivo que não existe");
    fs.accessSync(m.path, fs.constants.X_OK);
  });

  test("é idempotente: a segunda rodada deixa os bytes iguais", () => {
    criarNavegadores("chrome");
    rodar(["--extensao-id", ID_VALIDO]);
    const antes = fs.readFileSync(manifestoDe("chrome"));
    const r = rodar(["--extensao-id", ID_VALIDO]);
    assert.equal(r.status, 0);
    assert.ok(antes.equals(fs.readFileSync(manifestoDe("chrome"))));
  });

  test("--remover apaga só o arquivo próprio e deixa o vizinho intacto", () => {
    criarNavegadores("chrome", "brave");
    rodar(["--extensao-id", ID_VALIDO]);
    const vizinho = path.join(path.dirname(manifestoDe("chrome")), "outro.host.json");
    fs.writeFileSync(vizinho, '{"name":"outro"}');

    const r = rodar(["--remover"]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.existsSync(manifestoDe("chrome")), false);
    assert.equal(fs.existsSync(manifestoDe("brave")), false);
    assert.equal(fs.readFileSync(vizinho, "utf8"), '{"name":"outro"}', "o --remover levou um arquivo que não era dele");
  });

  test("--remover sem nada registrado não falha", () => {
    criarNavegadores("chrome");
    assert.equal(rodar(["--remover"]).status, 0);
  });

  test("sem ID conhecido: não escreve nada, avisa e sai 0 (a instalação não pode falhar por isso)", () => {
    criarNavegadores("chrome");
    const r = rodar([]);
    assert.equal(r.status, 0);
    assert.equal(fs.existsSync(manifestoDe("chrome")), false);
    assert.match(r.stdout + r.stderr, /ID da extensão desconhecido/);
  });

  test("ID inválido (aspas, tamanho errado, letras fora de a-p) nunca entra no manifesto", () => {
    criarNavegadores("chrome");
    for (const ruim of ['abc"x', "abc", ID_VALIDO + "q", ID_VALIDO.slice(1) + "z", "../../etc/passwd"]) {
      const r = rodar(["--extensao-id", ruim]);
      assert.equal(r.status, 0);
      assert.equal(fs.existsSync(manifestoDe("chrome")), false, `aceitou o ID ${JSON.stringify(ruim)}`);
    }
  });

  test("BRUTO_EXTENSAO_ID no ambiente vale como --extensao-id", () => {
    criarNavegadores("chrome");
    const r = rodar([], { env: { BRUTO_EXTENSAO_ID: ID_VALIDO } });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(fs.readFileSync(manifestoDe("chrome"), "utf8")).allowed_origins, [`chrome-extension://${ID_VALIDO}/`]);
  });

  test("opção desconhecida é recusada com exit 1 (não é silêncio)", () => {
    assert.equal(rodar(["--nao-existe"]).status, 1);
  });

  test("deriva o ID do campo `key` do manifest, igual ao cálculo independente do Chrome", () => {
    criarNavegadores("chrome");
    const { publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    const der = publicKey.export({ type: "spki", format: "der" });
    const esperado = crypto
      .createHash("sha256")
      .update(der)
      .digest("hex")
      .slice(0, 32)
      .replace(/[0-9a-f]/g, (c) => String.fromCharCode("a".charCodeAt(0) + parseInt(c, 16)));

    // Raiz falsa: o script resolve a pasta do Bruto a partir do próprio caminho.
    const raizFalsa = fs.mkdtempSync(path.join(os.tmpdir(), "bruto-raiz-"));
    try {
      fs.mkdirSync(path.join(raizFalsa, "launcher"));
      fs.mkdirSync(path.join(raizFalsa, "extension"));
      fs.copyFileSync(REGISTRAR, path.join(raizFalsa, "launcher", "registrar-host.sh"));
      fs.writeFileSync(path.join(raizFalsa, "extension", "manifest.json"), JSON.stringify({ name: "x", key: der.toString("base64") }));

      const r = rodar([], { script: path.join(raizFalsa, "launcher", "registrar-host.sh") });
      assert.equal(r.status, 0, r.stderr);
      const m = JSON.parse(fs.readFileSync(manifestoDe("chrome"), "utf8"));
      assert.deepEqual(m.allowed_origins, [`chrome-extension://${esperado}/`]);
      assert.equal(m.path, path.join(raizFalsa, "launcher", "host-nativo.sh"));
    } finally {
      fs.rmSync(raizFalsa, { recursive: true, force: true });
    }
  });
});

describe("registrar-host.sh — Linux e XDG_CONFIG_HOME", () => {
  /** `uname` falso na frente do PATH: faz o script seguir o ramo Linux também no macOS. */
  function comLinuxFalso(): string {
    const bin = path.join(home, "bin-falso");
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, "uname"), '#!/bin/sh\necho Linux\n', { mode: 0o755 });
    return bin;
  }
  const rodarLinux = (args: string[], env: Record<string, string> = {}) =>
    rodar(args, { env: { PATH: `${comLinuxFalso()}${path.delimiter}${process.env.PATH ?? ""}`, ...env } });

  test("com XDG_CONFIG_HOME absoluto, registra ali e não em ~/.config", () => {
    const xdg = path.join(home, "xdg");
    fs.mkdirSync(path.join(xdg, "google-chrome"), { recursive: true });
    fs.mkdirSync(path.join(home, ".config", "chromium"), { recursive: true }); // existe, mas não é o XDG
    const r = rodarLinux(["--extensao-id", ID_VALIDO], { XDG_CONFIG_HOME: xdg });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(fs.existsSync(path.join(xdg, "google-chrome", "NativeMessagingHosts", ARQUIVO)));
    assert.equal(fs.existsSync(path.join(home, ".config", "chromium", "NativeMessagingHosts", ARQUIVO)), false);
  });

  test("sem XDG_CONFIG_HOME, ou com valor relativo/vazio, cai em ~/.config", () => {
    fs.mkdirSync(path.join(home, ".config", "google-chrome"), { recursive: true });
    for (const xdg of ["", "relativo/xdg"]) {
      const r = rodarLinux(["--extensao-id", ID_VALIDO], { XDG_CONFIG_HOME: xdg });
      assert.equal(r.status, 0, r.stderr);
      assert.ok(fs.existsSync(path.join(home, ".config", "google-chrome", "NativeMessagingHosts", ARQUIVO)), `XDG=${JSON.stringify(xdg)}`);
      rodarLinux(["--remover"], { XDG_CONFIG_HOME: xdg });
    }
  });

  test("--remover também respeita XDG_CONFIG_HOME", () => {
    const xdg = path.join(home, "xdg");
    fs.mkdirSync(path.join(xdg, "microsoft-edge"), { recursive: true });
    rodarLinux(["--extensao-id", ID_VALIDO], { XDG_CONFIG_HOME: xdg });
    const alvo = path.join(xdg, "microsoft-edge", "NativeMessagingHosts", ARQUIVO);
    assert.ok(fs.existsSync(alvo));
    assert.equal(rodarLinux(["--remover"], { XDG_CONFIG_HOME: xdg }).status, 0);
    assert.equal(fs.existsSync(alvo), false);
  });
});

describe("instalar.sh — passo do host", () => {
  test("--help lista --sem-host e o script tem sintaxe válida", () => {
    const ajuda = spawnSync("bash", [path.join(RAIZ, "install", "instalar.sh"), "--help"], { encoding: "utf8" });
    assert.equal(ajuda.status, 0);
    assert.match(ajuda.stdout, /--sem-host/);
    assert.equal(spawnSync("bash", ["-n", path.join(RAIZ, "install", "instalar.sh")]).status, 0);
    assert.equal(spawnSync("bash", ["-n", REGISTRAR]).status, 0);
  });

  test("o passo do host vem depois do atalho e a falha dele é só aviso", () => {
    const t = fs.readFileSync(path.join(RAIZ, "install", "instalar.sh"), "utf8");
    const iAtalho = t.indexOf("Atalho (Bruto.app)");
    const iHost = t.indexOf("registrar-host.sh");
    assert.ok(iAtalho > 0 && iHost > iAtalho, "o registro tem de vir depois do atalho");
    const trecho = t.slice(iHost - 300, iHost + 500);
    assert.match(trecho, /SEM_HOST/, "o passo precisa respeitar --sem-host");
    assert.doesNotMatch(trecho.slice(trecho.indexOf("registrar-host.sh")), /falha\s+"/, "falha do registro não pode abortar a instalação");
  });
});
