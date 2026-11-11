/**
 * `scripts/instalador-macos/construir.sh` — o que dá para provar sem build: o
 * download de binário pinado com conferência de SHA-256 (INVARIANTE P4: hash
 * errado → para, apaga o baixado, nada é montado). Chama `baixar_pinado` num
 * bash filho com um `curl` FALSO no PATH: nenhum teste aqui usa rede.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CONSTRUIR = path.join(RAIZ, "scripts", "instalador-macos", "construir.sh");

const CONTEUDO_FIXO = "bytes-fixos-do-binario-pinado-0123456789";

let tmp: string;
let bin: string;
let fixture: string;
let marcaCurl: string;

const sha256De = (arquivo: string): string =>
  crypto.createHash("sha256").update(fs.readFileSync(arquivo)).digest("hex");

function bashTrecho(trecho: string): { rc: number | null; saida: string } {
  const r = spawnSync("/bin/bash", ["-c", trecho], { encoding: "utf8" });
  return { rc: r.status, saida: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/** Roda baixar_pinado com o curl falso no PATH; devolve o rc e o que imprimiu. */
function baixar(url: string, sha: string, alvo: string): { rc: number | null; saida: string } {
  return bashTrecho(
    `source "${CONSTRUIR}" && CURL_FIXTURE="${fixture}" CURL_MARCA="${marcaCurl}" PATH="${bin}:$PATH" ` +
      `baixar_pinado "${url}" "${sha}" "${alvo}"`,
  );
}

const chamadasDoCurl = (): number => {
  try {
    return fs.readFileSync(marcaCurl, "utf8").trim().split("\n").filter(Boolean).length;
  } catch {
    return 0;
  }
};

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bruto-binarios-"));
  bin = path.join(tmp, "bin");
  fs.mkdirSync(bin);
  fixture = path.join(tmp, "fixture.bin");
  fs.writeFileSync(fixture, CONTEUDO_FIXO);
  marcaCurl = path.join(tmp, "curl-marcas");
  // curl falso: registra que foi chamado e copia o fixture para o argumento
  // seguinte a -o (o "download").
  fs.writeFileSync(
    path.join(bin, "curl"),
    `#!/bin/bash
echo chamou >> "$CURL_MARCA"
prev=""
for a in "$@"; do
  if [ "$prev" = "-o" ]; then cp "$CURL_FIXTURE" "$a"; fi
  prev="$a"
done
exit 0
`,
    { mode: 0o755 },
  );
});

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("baixar_pinado — hash conferido antes de qualquer coisa", () => {
  test("hash errado: falha, apaga o baixado e não deixa resto no cache", () => {
    const alvo = path.join(tmp, "cache", "x.tar.gz");
    const r = baixar("https://exemplo.invalid/x.tar.gz", "deadbeef", alvo);
    assert.notEqual(r.rc, 0, "hash errado tem de reprovar");
    assert.equal(fs.existsSync(alvo), false, "arquivo publicado no cache");
    assert.equal(fs.existsSync(`${alvo}.tmp`), false, "resto do download não foi apagado");
    assert.equal(fs.readdirSync(path.dirname(alvo)).length, 0, "cache deveria continuar vazio");
  });

  test("hash certo: publica no cache com o conteúdo baixado", () => {
    const alvo = path.join(tmp, "cache", "ok.tar.gz");
    const antes = chamadasDoCurl();
    const r = baixar("https://exemplo.invalid/ok.tar.gz", sha256De(fixture), alvo);
    assert.equal(r.rc, 0, r.saida);
    assert.equal(fs.existsSync(alvo), true);
    assert.equal(fs.readFileSync(alvo, "utf8"), CONTEUDO_FIXO);
    assert.equal(chamadasDoCurl(), antes + 1, "devia chamar o curl exatamente uma vez");
  });

  test("segunda chamada aproveita o cache: curl não é chamado de novo", () => {
    const alvo = path.join(tmp, "cache", "cache.tar.gz");
    const sha = sha256De(fixture);
    assert.equal(baixar("https://exemplo.invalid/cache.tar.gz", sha, alvo).rc, 0);
    const antes = chamadasDoCurl();
    assert.equal(baixar("https://exemplo.invalid/cache.tar.gz", sha, alvo).rc, 0);
    assert.equal(chamadasDoCurl(), antes, "curl foi chamado de novo com o cache válido");
  });

  test("cache corrompido (hash não confere): baixa de novo e corrige", () => {
    const alvo = path.join(tmp, "cache", "corrompido.tar.gz");
    const sha = sha256De(fixture);
    assert.equal(baixar("https://exemplo.invalid/corrompido.tar.gz", sha, alvo).rc, 0);
    fs.writeFileSync(alvo, "bytes-trocados");
    assert.equal(baixar("https://exemplo.invalid/corrompido.tar.gz", sha, alvo).rc, 0);
    assert.equal(fs.readFileSync(alvo, "utf8"), CONTEUDO_FIXO);
  });
});
