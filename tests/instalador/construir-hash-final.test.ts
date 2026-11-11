/**
 * `scripts/instalador-macos/construir.sh` — classe I: todo hash é calculado
 * sobre o artefato FINAL. Achado P2 da 1ª rodada do Codex: o `.sha256` era
 * gerado ANTES de `codesign`/`notarytool`/`stapler` modificarem o `.dmg` — o
 * hash publicado descrevia um artefato anterior.
 *
 * Prova: a etapa final do .dmg vive na função `finalizar_dmg` (a mesma que o
 * build usa). Com `codesign`/`xcrun` FALSOS que ALTERAM o arquivo, o .sha256
 * gerado tem de descrever o conteúdo DEPOIS das alterações — e o próprio
 * finalizar confere com `shasum -a 256 -c`.
 */
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CONSTRUIR = path.join(RAIZ, "scripts", "instalador-macos", "construir.sh");

const ORIGINAL = "dmg-falso-bytes";
const DEPOIS_DO_CODESIGN = ORIGINAL + "codigo-assinado";
const CONTEUDO_FINAL = DEPOIS_DO_CODESIGN + "notarizado" + "notarizado"; // notarytool + stapler

let tmp: string;
let bin: string; // codesign/xcrun falsos
let dmg: string;

const sha256De = (conteudo: string): string => crypto.createHash("sha256").update(conteudo).digest("hex");

function bashTrecho(trecho: string): { rc: number | null; saida: string } {
  const r = spawnSync("/bin/bash", ["-c", trecho], { encoding: "utf8" });
  return { rc: r.status, saida: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bruto-hash-"));
  dmg = path.join(tmp, "Bruto-9.9.9-arm64.dmg");
  bin = path.join(tmp, "bin");
  fs.mkdirSync(bin);
  // codesign falso: ALTERA o alvo (último argumento) — como o de verdade
  // modifica o arquivo ao assinar.
  fs.writeFileSync(
    path.join(bin, "codesign"),
    `#!/bin/bash
alvo=""
for a in "$@"; do alvo="$a"; done
printf 'codigo-assinado' >> "$alvo"
exit 0
`,
    { mode: 0o755 },
  );
  // xcrun falso: notarytool submit e stapler staple ALTERAM o .dmg (o alvo é
  // o argumento seguinte a submit/staple).
  fs.writeFileSync(
    path.join(bin, "xcrun"),
    `#!/bin/bash
prev=""
alvo=""
for a in "$@"; do
  case "$prev" in submit|staple) alvo="$a" ;; esac
  prev="$a"
done
[ -n "$alvo" ] && printf 'notarizado' >> "$alvo"
exit 0
`,
    { mode: 0o755 },
  );
});

describe("finalizar_dmg — o .sha256 descreve o artefato FINAL (classe I)", () => {
  test("com Developer ID + notarização: hash DEPOIS de codesign/notarytool/stapler alterarem o .dmg", () => {
    fs.writeFileSync(dmg, ORIGINAL);
    const r = bashTrecho(
      `source "${CONSTRUIR}" && PATH="${bin}:$PATH" BRUTO_DEVELOPER_ID="Developer ID: teste" BRUTO_NOTARY_PROFILE="perfil" finalizar_dmg "${dmg}"`,
    );
    assert.equal(r.rc, 0, r.saida);
    // as ferramentas falsas modificaram o arquivo — e o hash acompanhou
    const final = fs.readFileSync(dmg, "utf8");
    assert.equal(final, CONTEUDO_FINAL, "codesign/xcrun falsos deviam ter alterado o .dmg");
    const shaArq = fs.readFileSync(`${dmg}.sha256`, "utf8").trim();
    assert.match(shaArq, /^[0-9a-f]{64}  Bruto-9\.9\.9-arm64\.dmg$/, `formato: ${shaArq}`);
    assert.equal(shaArq.split("  ")[0], sha256De(CONTEUDO_FINAL), "hash do conteúdo FINAL");
    assert.notEqual(shaArq.split("  ")[0], sha256De(ORIGINAL), "hash do artefato ANTERIOR à assinatura");
    // conferência independente da que o finalizar faz internamente
    const confere = bashTrecho(`cd "${tmp}" && shasum -a 256 -c "Bruto-9.9.9-arm64.dmg.sha256"`);
    assert.equal(confere.rc, 0, confere.saida);
  });

  test("sem Developer ID: notarização pulada (e anunciada), hash do artefato como está", () => {
    fs.writeFileSync(dmg, ORIGINAL);
    fs.rmSync(`${dmg}.sha256`, { force: true });
    const r = bashTrecho(`source "${CONSTRUIR}" && PATH="${bin}:$PATH" finalizar_dmg "${dmg}"`);
    assert.equal(r.rc, 0, r.saida);
    assert.ok(r.saida.includes("puladas"), "o pulo tem de ser anunciado (decisão do dono)");
    const shaArq = fs.readFileSync(`${dmg}.sha256`, "utf8").trim();
    assert.equal(shaArq.split("  ")[0], sha256De(ORIGINAL));
    // nada foi "assinado" por engano
    assert.equal(fs.readFileSync(dmg, "utf8"), ORIGINAL);
  });
});
