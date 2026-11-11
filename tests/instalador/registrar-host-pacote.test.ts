/**
 * `scripts/instalador-macos/construir.sh` — layout do host de native messaging
 * no pacote (achado P2 da 1ª rodada do Codex): o registrar-host.sh calcula a
 * raiz como o PAI da própria pasta. Colado direto em Resources/, ele registra
 * `Contents/launcher/host-nativo.sh` — caminho que NÃO existe; o certo é
 * `Contents/Resources/launcher/host-nativo.sh`.
 *
 * Prova (classe H): o construir.sh monta o layout pela função
 * `montar_host_do_pacote` (a mesma que o build usa), roda o registrador DE
 * VERDADE (o delegador que o lançador chama, com HOME falso e ID de teste) e
 * confere que o `path` do manifesto gerado existe, é absoluto, canônico (sem
 * "..") e executável. Depois roda `provar_host_do_pacote` — a mesma prova H
 * do fim do build.
 */
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CONSTRUIR = path.join(RAIZ, "scripts", "instalador-macos", "construir.sh");
const REGISTRADOR_REPO = path.join(RAIZ, "launcher", "registrar-host.sh");
const WRAPPER_PACOTE = path.join(RAIZ, "scripts", "instalador-macos", "host-nativo.sh");
// 32 letras a-p: formato válido de ID de extensão do Chrome.
const ID_TESTE = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

let tmp: string;
let recursos: string; // <tmp>/Meus Apps/Bruto.app/Contents/Resources
let homeFalso: string;
let homeDireto: string;
let rascunho: string;

function bashTrecho(trecho: string): { rc: number | null; saida: string } {
  const r = spawnSync("/bin/bash", ["-c", trecho], { encoding: "utf8" });
  return { rc: r.status, saida: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

const manifestDe = (home: string): string =>
  path.join(home, "Library", "Application Support", "Google", "Chrome", "NativeMessagingHosts", "com.ideiabusiness.bruto.json");

interface Manifesto {
  name: string;
  path: string;
  type: string;
  allowed_origins: string[];
}

function lerManifesto(home: string): Manifesto {
  return JSON.parse(fs.readFileSync(manifestDe(home), "utf8")) as Manifesto;
}

/** Cria um HOME falso com Chrome "instalado" (o registrador só escreve onde o
 * navegador já existe) e roda o registrador dado com um ID de teste. */
function registrarCom(binario: string, home: string): { rc: number | null; saida: string } {
  fs.mkdirSync(path.join(home, "Library", "Application Support", "Google", "Chrome"), { recursive: true });
  return bashTrecho(`HOME="${home}" BRUTO_EXTENSAO_ID="${ID_TESTE}" bash "${binario}"`);
}

/** Cria um Contents/MacOS/Bruto executável (o build real copia o lançador
 * antes de montar o host; a prova H confere esse caminho). */
function comLancador(recursosDir: string): void {
  const alvo = path.join(recursosDir, "..", "MacOS", "Bruto");
  fs.mkdirSync(path.dirname(alvo), { recursive: true });
  fs.writeFileSync(alvo, "#!/bin/bash\nexit 0\n", { mode: 0o755 });
}

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bruto-registrar-"));
  // Caminho com espaço: o path do manifesto tem de sair bem formado mesmo assim.
  recursos = path.join(tmp, "Meus Apps", "Bruto.app", "Contents", "Resources");
  fs.mkdirSync(recursos, { recursive: true });
  comLancador(recursos);
  homeFalso = path.join(tmp, "home");
  homeDireto = path.join(tmp, "home-direto");
  rascunho = path.join(tmp, "rascunho");
});

describe("registrar-host.sh no layout do PACOTE (classe H)", () => {
  test("montar_host_do_pacote monta o layout; o registrador do pacote gera manifesto cujo path EXISTE", () => {
    const monta = bashTrecho(`source "${CONSTRUIR}" && montar_host_do_pacote "${recursos}"`);
    assert.equal(monta.rc, 0, monta.saida);
    // o lançador chama Resources/registrar-host.sh (contrato, item 7): é ele que se prova
    const r = registrarCom(path.join(recursos, "registrar-host.sh"), homeFalso);
    assert.equal(r.rc, 0, r.saida);
    assert.ok(fs.existsSync(manifestDe(homeFalso)), "o manifest não foi gerado");
    const p = lerManifesto(homeFalso).path;
    assert.ok(path.isAbsolute(p), `path não é absoluto: ${p}`);
    assert.ok(!p.includes(".."), `path não é canônico: ${p}`);
    assert.ok(fs.existsSync(p), `path não existe no pacote montado: ${p}`);
    fs.accessSync(p, fs.constants.X_OK);
    assert.equal(p, path.join(recursos, "launcher", "host-nativo.sh"));
  });

  test("provar_host_do_pacote (a prova H do fim do build) aprova o layout montado", () => {
    const r = bashTrecho(`source "${CONSTRUIR}" && provar_host_do_pacote "${recursos}" "${rascunho}"`);
    assert.equal(r.rc, 0, r.saida);
  });

  test("a prova H tem dentes: layout sem launcher/host-nativo.sh é reprovado", () => {
    const recursosQuebrado = path.join(tmp, "Quebrado.app", "Contents", "Resources");
    fs.mkdirSync(recursosQuebrado, { recursive: true });
    comLancador(recursosQuebrado);
    const monta = bashTrecho(`source "${CONSTRUIR}" && montar_host_do_pacote "${recursosQuebrado}"`);
    assert.equal(monta.rc, 0, monta.saida);
    fs.rmSync(path.join(recursosQuebrado, "launcher", "host-nativo.sh"));
    const r = bashTrecho(`source "${CONSTRUIR}" && provar_host_do_pacote "${recursosQuebrado}" "${rascunho}"`);
    assert.notEqual(r.rc, 0, "a prova do build devia reprovar caminho inexistente");
    assert.match(r.saida, /host-nativo|manifesto|caminho/);
  });

  test("documentação da armadilha: o registrador colado DIRETO em Resources gera path inexistente", () => {
    // O arranjo antigo do construir.sh: registrar-host.sh direto em Resources.
    // A raiz que ele calcula é Contents — o path gerado não existe. É por isso
    // que ele vive em launcher/ com um delegador em Resources.
    const recursosDireto = path.join(tmp, "direto", "Bruto.app", "Contents", "Resources");
    fs.mkdirSync(path.join(recursosDireto, "launcher"), { recursive: true });
    fs.copyFileSync(REGISTRADOR_REPO, path.join(recursosDireto, "registrar-host.sh"));
    fs.copyFileSync(WRAPPER_PACOTE, path.join(recursosDireto, "launcher", "host-nativo.sh"));
    fs.chmodSync(path.join(recursosDireto, "launcher", "host-nativo.sh"), 0o755);
    const r = registrarCom(path.join(recursosDireto, "registrar-host.sh"), homeDireto);
    assert.equal(r.rc, 0, r.saida);
    const p = lerManifesto(homeDireto).path;
    assert.ok(!fs.existsSync(p), `o path gerado (${p}) não devia existir neste arranjo`);
    assert.notEqual(p, path.join(recursosDireto, "launcher", "host-nativo.sh"));
  });
});
