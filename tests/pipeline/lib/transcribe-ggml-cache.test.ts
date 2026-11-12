/**
 * A troca do modelo padrão (base → large-v3-turbo, 12/11/2026) vista de dentro
 * de uma transcrição real, no backend whisper.cpp — o único em que o padrão
 * novo poderia QUEBRAR quem já transcreve: o app procura `ggml-<MODELO>.bin`
 * no disco, e quem só tem `ggml-base.bin` passaria a falhar.
 *
 * Prova ponta a ponta, em modo pacote com dublês (nada real roda):
 *
 *   1. sem `BRUTO_WHISPER_MODEL` e sem ggml do padrão, a transcrição usa o
 *      melhor ggml presente (aqui: base) e FUNCIONA;
 *   2. o binário whisper-cli recebe `-m <caminho do ggml base>` (não do
 *      padrão novo);
 *   3. o cache de transcrição é chaveado pelo modelo EFETIVAMENTE usado —
 *      uma transcrição feita com o ggml base nunca pode ser servida como se
 *      tivesse saído do large-v3-turbo (e vice-versa);
 *   4. a segunda transcrição do mesmo áudio sai do cache (o backend roda 1×).
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ── Ambiente ANTES do import: `transcribe.ts` calcula CACHE_DIR a partir de
// DATA_ROOT na CARGA do módulo (constantes de `paths.ts`). Se isto ficasse no
// `before()`, a importação aconteceria antes — e o cache nasceria apontando
// para o ~/.bruto real. ──────────────────────────────────────────────────────
const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "bruto-ggml-cache-"));
const ferramentas = path.join(raiz, "ferramentas");
const dataRoot = path.join(raiz, "dados");
const home = path.join(raiz, "home");
const cacheDir = path.join(dataRoot, "transcripts");

const salvas: Record<string, string | undefined> = {};
const VARS = [
  "BRUTO_EMPACOTADO",
  "BRUTO_FFMPEG",
  "BRUTO_UV",
  "BRUTO_FERRAMENTAS",
  "BRUTO_DATA_ROOT",
  "BRUTO_WHISPER_MODEL",
  "UV_TOOL_DIR",
  "UV_TOOL_BIN_DIR",
  "HOME",
] as const;

for (const v of VARS) salvas[v] = process.env[v];

process.env.BRUTO_EMPACOTADO = "1";
process.env.BRUTO_FERRAMENTAS = ferramentas;
process.env.BRUTO_DATA_ROOT = dataRoot;
delete process.env.BRUTO_WHISPER_MODEL; // o padrão (large-v3-turbo) é o testado
// Sem mlx (venv inexistente) e sem whisper CLI: o backend é o whisper.cpp.
process.env.BRUTO_UV = path.join(raiz, "uv-duble-ausente");
process.env.UV_TOOL_DIR = path.join(ferramentas, "uv", "tools");
process.env.UV_TOOL_BIN_DIR = path.join(ferramentas, "bin");
// HOME falso com APENAS o ggml-base.bin: a situação de quem transcrevia com o
// padrão antigo e não tem o modelo novo.
process.env.HOME = home;

const registroWhisperCpp = path.join(raiz, "whisper-cpp-chamadas.txt");
const ffmpegDuble = path.join(raiz, "ffmpeg-duble");

let transcreverAudio: typeof import("@/pipeline/lib/transcribe").transcreverAudio;

before(async () => {
  const binDir = path.join(ferramentas, "bin");
  fs.mkdirSync(binDir, { recursive: true });

  // Dublê do ffmpeg "extrai" um wav com conteúdo (o destino é o último arg).
  fs.writeFileSync(
    ffmpegDuble,
    `#!/bin/sh\nfor last; do :; done\nprintf 'wav-falso' > "$last"\nexit 0\n`,
    { mode: 0o755 },
  );
  process.env.BRUTO_FFMPEG = ffmpegDuble;

  // Dublê do whisper-cli: registra os args e devolve uma "transcrição" que
  // nomeia o modelo recebido em -m — é assim que o teste SABE qual ggml rodou.
  fs.writeFileSync(
    path.join(binDir, "whisper-cli"),
    `#!/bin/sh
printf '%s\\n' "$*" >> "${registroWhisperCpp}"
modelo=""
prev=""
for a in "$@"; do
  if [ "$prev" = "-m" ]; then modelo="$a"; fi
  prev="$a"
done
printf 'texto transcrito com %s' "$modelo"
exit 0
`,
    { mode: 0o755 },
  );

  // O único ggml no disco: base (não o padrão novo large-v3-turbo).
  fs.mkdirSync(path.join(home, ".cache", "whisper"), { recursive: true });
  fs.writeFileSync(path.join(home, ".cache", "whisper", "ggml-base.bin"), "ggml-ficticio-base");

  ({ transcreverAudio } = await import("@/pipeline/lib/transcribe"));
});

after(() => {
  for (const v of VARS) {
    if (salvas[v] === undefined) delete process.env[v];
    else process.env[v] = salvas[v];
  }
  fs.rmSync(raiz, { recursive: true, force: true });
});

/** O hash que `sha256Arquivo` produz: sha256(conteúdo + "\\0" + tempero). */
function hashEsperado(conteudo: string, tempero: string): string {
  return crypto
    .createHash("sha256")
    .update(Buffer.from(conteudo, "utf8"))
    .update(`\0${tempero}`)
    .digest("hex");
}

const GGML_BASE = path.join(home, ".cache", "whisper", "ggml-base.bin");

describe("whisper.cpp com o padrão large-v3-turbo — quem só tem ggml-base segue transcrevendo", () => {
  test("transcreve com o melhor ggml presente e o binário recebe esse caminho em -m", async () => {
    const audio = path.join(raiz, "audio-origem.m4a");
    fs.writeFileSync(audio, "audio-falso-1");

    const texto = await transcreverAudio(audio, "pt");
    assert.equal(texto, `texto transcrito com ${GGML_BASE}`);

    const chamadas = fs.readFileSync(registroWhisperCpp, "utf8").trim().split("\n");
    assert.match(chamadas[0], new RegExp(`-m ${GGML_BASE.replaceAll("/", "\\/")} `));
  });

  test("o cache é chaveado pelo modelo EFETIVO (o ggml base), não pelo padrão", async () => {
    const arquivos = fs.readdirSync(cacheDir);
    assert.equal(arquivos.length, 1, `esperava 1 arquivo de cache, veio: ${arquivos.join(", ")}`);

    const audio = path.join(raiz, "audio-origem.m4a");
    const conteudo = fs.readFileSync(audio, "utf8");
    const chaveBase = hashEsperado(conteudo, `${GGML_BASE}:pt`);
    const chaveTurbo = hashEsperado(conteudo, "large-v3-turbo:pt");

    assert.equal(arquivos[0], `${chaveBase}.txt`, "a chave do cache deve usar o modelo efetivo (ggml base)");
    assert.equal(fs.existsSync(path.join(cacheDir, `${chaveTurbo}.txt`)), false, "não pode existir chave pelo modelo que não rodou");
  });

  test("o mesmo áudio de novo sai do cache (o whisper-cli não roda outra vez)", async () => {
    const audio = path.join(raiz, "audio-origem.m4a");
    const antes = fs.readFileSync(registroWhisperCpp, "utf8").trim().split("\n").length;

    const texto = await transcreverAudio(audio, "pt");
    assert.equal(texto, `texto transcrito com ${GGML_BASE}`);
    assert.equal(
      fs.readFileSync(registroWhisperCpp, "utf8").trim().split("\n").length,
      antes,
      "o backend rodou de novo — o cache não serviu",
    );
  });
});
