/**
 * `scripts/instalador-macos/construir.sh` — classe T: assinar não tira
 * capacidade do binário.
 *
 * Achado P1 da 2ª rodada (Codex): com BRUTO_DEVELOPER_ID, o script ligava o
 * hardened runtime e re-assinava o Node do pacote SEM as entitlements
 * dele. O binário oficial pinado (node-v26.13.0-darwin-arm64) traz
 * entitlements de memória executável — sem elas o V8 não aloca memória e o
 * Node assinado não roda.
 *
 * Prova sem build de verdade, com `codesign` e `file` FALSOS no PATH: a
 * função `assinar_app` chama codesign com `--entitlements` apontando o
 * ARQUIVO VERSIONADO `entitlements-node.plist` SÓ para Resources/node
 * (ffmpeg, ffprobe, uv e `*.node` ficam sem), e
 * `provar_assinatura_do_pacote` confere DEPOIS de assinar, com
 * `codesign -d --entitlements`, que as chaves do Node oficial continuam
 * presentes — e que o node do pacote RODA (`node -e 'console.log(1)'`).
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PASTA = path.join(RAIZ, "scripts", "instalador-macos");
const CONSTRUIR = path.join(PASTA, "construir.sh");
const ENTITLEMENTS = path.join(PASTA, "entitlements-node.plist");

// As entitlements do binário oficial pinado, lidas com
// `codesign -d --entitlements -` no artefato real
// (dist/build/node-v26.13.0-darwin-arm64/bin/node).
const CHAVES_OFICIAIS = [
  "com.apple.security.cs.allow-dyld-environment-variables",
  "com.apple.security.cs.allow-jit",
  "com.apple.security.cs.allow-unsigned-executable-memory",
  "com.apple.security.cs.disable-executable-page-protection",
  "com.apple.security.cs.disable-library-validation",
  "com.apple.security.get-task-allow",
];

let tmp: string;
let appb: string; // …/Bruto.app
let recursos: string; // …/Bruto.app/Contents/Resources
let bin: string; // codesign/file falsos
let log: string; // o que o codesign falso recebeu

function bashTrecho(trecho: string): { rc: number | null; saida: string } {
  const r = spawnSync("/bin/bash", ["-c", trecho], { encoding: "utf8" });
  return { rc: r.status, saida: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/** O app FALSO: node + bin/ffmpeg,ffprobe,uv + um *.node de addon nativo. */
function montarApp(): void {
  fs.rmSync(appb, { recursive: true, force: true });
  fs.mkdirSync(path.join(recursos, "bin"), { recursive: true });
  fs.mkdirSync(path.join(recursos, "app", "node_modules", "better-sqlite3", "prebuilds"), { recursive: true });
  fs.mkdirSync(path.join(appb, "Contents", "MacOS"), { recursive: true });
  fs.writeFileSync(path.join(recursos, "node"), "#!/bin/bash\nexit 0\n", { mode: 0o755 });
  for (const nome of ["ffmpeg", "ffprobe", "uv"]) {
    fs.writeFileSync(path.join(recursos, "bin", nome), "#!/bin/bash\nexit 0\n", { mode: 0o755 });
  }
  fs.writeFileSync(path.join(recursos, "app", "node_modules", "better-sqlite3", "prebuilds", "darwin-arm64.node"), "binario-de-addon\n");
  fs.writeFileSync(path.join(appb, "Contents", "MacOS", "Bruto"), "#!/bin/bash\nexit 0\n", { mode: 0o755 });
  fs.writeFileSync(log, "");
}

const lerLinhas = (): string[] =>
  fs
    .readFileSync(log, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "");

const linhaDe = (fim: string): string | undefined => lerLinhas().find((l) => l.trim().endsWith(fim));

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bruto-ents-"));
  appb = path.join(tmp, "Bruto.app");
  recursos = path.join(appb, "Contents", "Resources");
  bin = path.join(tmp, "bin");
  log = path.join(tmp, "codesign-chamadas.log");
  fs.mkdirSync(bin);
  // file falso: para o loop de assinatura, tudo é Mach-O (o alvo do teste
  // são arquivos de texto).
  fs.writeFileSync(
    path.join(bin, "file"),
    '#!/bin/bash\necho "Mach-O 64-bit executable arm64"\n',
    { mode: 0o755 },
  );
  // codesign falso: registra cada chamada; ao assinar com --entitlements X,
  // grava X ao lado do alvo (o `-d` de depois responde com o que foi
  // assinado — como o codesign real); sem --entitlements, o alvo fica
  // registrado como assinado SEM entitlements.
  fs.writeFileSync(
    path.join(bin, "codesign"),
    `#!/bin/bash
modo=""
pegou=0
ents=""
alvo=""
for a in "$@"; do
  if [ "$pegou" = "1" ]; then ents="$a"; pegou=0; continue; fi
  [ "$a" = "--entitlements" ] && pegou=1
  [ "$a" = "-d" ] && modo="display"
  case "$a" in -*) ;; *) alvo="$a" ;; esac
done
if [ "$modo" = "display" ]; then
  [ -f "$alvo.bruto-ents" ] && cat "$alvo.bruto-ents"
  exit 0
fi
printf '%s\\n' "$*" >> "\${CODESIGN_LOG:-/dev/null}"
if [ -n "$ents" ]; then cp "$ents" "$alvo.bruto-ents"; else rm -f "$alvo.bruto-ents"; fi
exit 0
`,
    { mode: 0o755 },
  );
});

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("classe T — assinar não tira capacidade do binário", () => {
  test("entitlements-node.plist (versionado) carrega as entitlements do Node oficial", () => {
    const plist = fs.readFileSync(ENTITLEMENTS, "utf8");
    for (const chave of CHAVES_OFICIAIS) {
      assert.ok(plist.includes(chave), `o plist versionado devia ter ${chave}`);
    }
  });

  test("com BRUTO_DEVELOPER_ID: SÓ o node sai com --entitlements; ffmpeg/ffprobe/uv/*.node sem", () => {
    montarApp();
    const r = bashTrecho(
      `source "${CONSTRUIR}" && PATH="${bin}:$PATH" CODESIGN_LOG="${log}" BRUTO_DEVELOPER_ID="Developer ID: teste" assinar_app "${appb}"`,
    );
    assert.equal(r.rc, 0, r.saida);
    const linhaNode = linhaDe(path.join(recursos, "node"));
    assert.ok(linhaNode, `o node devia ser assinado — chamadas: ${lerLinhas().join(" | ")}`);
    assert.ok(linhaNode?.includes("--entitlements"), "o node precisa das entitlements dele");
    assert.ok(linhaNode?.includes(ENTITLEMENTS), `a chamada aponta o arquivo versionado: ${ENTITLEMENTS}`);
    assert.ok(linhaNode?.includes("runtime"), "hardened runtime ligado (é o caso perigoso)");
    for (const outro of [
      "bin/ffmpeg",
      "bin/ffprobe",
      "bin/uv",
      "app/node_modules/better-sqlite3/prebuilds/darwin-arm64.node",
    ]) {
      const linha = linhaDe(path.join(recursos, outro));
      assert.ok(linha, `devia assinar ${outro}`);
      assert.ok(!linha?.includes("--entitlements"), `${outro} sem entitlements desnecessárias`);
    }
    const linhas = lerLinhas();
    assert.ok(linhas.length > 0, "o bundle também é assinado");
    assert.ok(linhas[linhas.length - 1].trim().endsWith("Bruto.app"), "o bundle é assinado por último");
  });

  test("depois de assinar: a prova confere as entitlements (codesign -d) e que o node roda", () => {
    montarApp();
    const r = bashTrecho(
      `source "${CONSTRUIR}" && PATH="${bin}:$PATH" CODESIGN_LOG="${log}" BRUTO_DEVELOPER_ID="Developer ID: teste" assinar_app "${appb}" && ` +
        `PATH="${bin}:$PATH" CODESIGN_LOG="${log}" BRUTO_DEVELOPER_ID="Developer ID: teste" provar_assinatura_do_pacote "${appb}"`,
    );
    assert.equal(r.rc, 0, r.saida);
    assert.ok(r.saida.includes("entitlements"), `a prova anuncia a conferência: ${r.saida}`);
  });

  test("o bug da 2ª rodada (hardened runtime SEM entitlements): a prova falha alta", () => {
    montarApp();
    const nodeFalso = path.join(recursos, "node");
    const r = bashTrecho(
      `source "${CONSTRUIR}" && PATH="${bin}:$PATH" CODESIGN_LOG="${log}" BRUTO_DEVELOPER_ID="Developer ID: teste" ` +
        `codesign --force --options runtime --timestamp --sign "Developer ID: teste" "${nodeFalso}" && ` +
        `PATH="${bin}:$PATH" CODESIGN_LOG="${log}" BRUTO_DEVELOPER_ID="Developer ID: teste" provar_assinatura_do_pacote "${appb}"`,
    );
    assert.notEqual(r.rc, 0, "assinado sem entitlements: o build devia falhar aqui");
    assert.ok(r.saida.includes("entitlement"), `o motivo devia citar a entitlement perdida: ${r.saida}`);
    assert.ok(r.saida.includes("✗"), "falha alta, com ✗");
  });

  test("ad-hoc (sem BRUTO_DEVELOPER_ID): sem entitlements e sem hardened runtime — e a prova passa", () => {
    montarApp();
    const r = bashTrecho(
      `source "${CONSTRUIR}" && PATH="${bin}:$PATH" CODESIGN_LOG="${log}" assinar_app "${appb}" && PATH="${bin}:$PATH" CODESIGN_LOG="${log}" provar_assinatura_do_pacote "${appb}"`,
    );
    assert.equal(r.rc, 0, r.saida);
    const linhaNode = linhaDe(path.join(recursos, "node"));
    assert.ok(linhaNode, "o node foi assinado");
    assert.ok(!linhaNode?.includes("--entitlements"), "ad-hoc não leva entitlements");
    assert.ok(!linhaNode?.includes("runtime"), "ad-hoc não liga hardened runtime");
  });
});
