/**
 * INVARIANTE F1 (prova da transcrição): em modo pacote, `ffmpeg` e o backend
 * Whisper NUNCA saem do PATH — resolvem por caminho absoluto a partir das
 * variáveis do contrato (`BRUTO_FFMPEG`, `$BRUTO_FERRAMENTAS/bin`).
 *
 * Montagem: `ffmpeg`/`whisper` FALSOS no PATH gravam "fui chamado" se
 * executados; dublês funcionais (`ffmpeg` que "extrai" o wav, `whisper` CLI
 * que "transcreve") ficam onde o contrato manda. A transcrição tem de sair
 * pelos dublês, com os falsos intactos.
 *
 * E o caminho de erro: sem backend nenhum instalado, a mensagem em modo
 * pacote diz como instalar (Configurações), não manda rodar instalador de
 * clone.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let raiz: string;
let ferramentas: string;
let binDir: string;
let dataRoot: string;
let pathFalso: string;
let registroPathFalso: string;

let salvas: Record<string, string | undefined>;
const VARS = [
  "BRUTO_EMPACOTADO",
  "BRUTO_FFMPEG",
  "BRUTO_UV",
  "BRUTO_FERRAMENTAS",
  "BRUTO_DATA_ROOT",
  "UV_TOOL_DIR",
  "UV_TOOL_BIN_DIR",
  "PATH",
] as const;

function pathFalsoFoiChamado(): boolean {
  try {
    return fs.readFileSync(registroPathFalso, "utf8").length > 0;
  } catch {
    return false;
  }
}

before(() => {
  raiz = fs.mkdtempSync(path.join(os.tmpdir(), "bruto-f1-transcribe-"));
  ferramentas = path.join(raiz, "ferramentas");
  binDir = path.join(ferramentas, "bin");
  dataRoot = path.join(raiz, "dados");
  fs.mkdirSync(binDir, { recursive: true });

  registroPathFalso = path.join(raiz, "falso-chamado.txt");
  pathFalso = path.join(raiz, "path-falso");
  fs.mkdirSync(pathFalso);
  for (const nome of ["ffmpeg", "ffprobe", "whisper", "python3"]) {
    fs.writeFileSync(
      path.join(pathFalso, nome),
      `#!/bin/sh\necho "FUI CHAMADO: ${nome}" >> "${registroPathFalso}"\nexit 1\n`,
      { mode: 0o755 },
    );
  }

  // Dublê do ffmpeg "extrai" um wav com conteúdo (o destino é o último arg).
  const ffmpegDuble = path.join(raiz, "ffmpeg-duble");
  fs.writeFileSync(
    ffmpegDuble,
    `#!/bin/sh\nfor last; do :; done\nprintf 'wav-falso' > "$last"\nexit 0\n`,
    { mode: 0o755 },
  );

  // Dublê do whisper CLI (instalado pelo uv em $BRUTO_FERRAMENTAS/bin):
  // escreve <stem>.txt no --output_dir, como a CLI de verdade.
  fs.writeFileSync(
    path.join(binDir, "whisper"),
    `#!/bin/sh
out=""
prev=""
for a in "$@"; do
  if [ "$prev" = "--output_dir" ]; then out="$a"; fi
  prev="$a"
done
printf 'texto transcrito pelo duble' > "$out/audio.txt"
exit 0
`,
    { mode: 0o755 },
  );

  salvas = {};
  for (const v of VARS) salvas[v] = process.env[v];

  process.env.BRUTO_EMPACOTADO = "1";
  process.env.BRUTO_FFMPEG = ffmpegDuble;
  process.env.BRUTO_UV = path.join(raiz, "uv-duble-ausente");
  process.env.BRUTO_FERRAMENTAS = ferramentas;
  process.env.BRUTO_DATA_ROOT = dataRoot;
  // Sem mlx instalado (UV_TOOL_DIR vazio): o backend detectado é o whisper CLI.
  process.env.UV_TOOL_DIR = path.join(ferramentas, "uv", "tools");
  process.env.UV_TOOL_BIN_DIR = binDir;
  process.env.PATH = `${pathFalso}${path.delimiter}/usr/bin${path.delimiter}/bin`;
});

after(() => {
  for (const v of VARS) {
    if (salvas[v] === undefined) delete process.env[v];
    else process.env[v] = salvas[v]!;
  }
  fs.rmSync(raiz, { recursive: true, force: true });
});

const { transcreverAudio, detectarBackend, mensagemSemBackend } = await import(
  "@/pipeline/lib/transcribe"
);

describe("F1 — transcrição em modo pacote não toca ferramenta do PATH", () => {
  test("o backend detectado é o whisper de $BRUTO_FERRAMENTAS/bin", async () => {
    assert.equal(await detectarBackend(), "whisper");
    assert.equal(pathFalsoFoiChamado(), false);
  });

  test("transcreverAudio extrai com BRUTO_FFMPEG e transcreve com o whisper do pacote", async () => {
    const audio = path.join(raiz, "audio-origem.m4a");
    fs.writeFileSync(audio, "audio-falso");
    const texto = await transcreverAudio(audio, "pt");
    assert.equal(texto, "texto transcrito pelo duble");
    assert.equal(pathFalsoFoiChamado(), false, "um binário falso do PATH foi executado");
  });
});

describe("primeiro uso do Whisper — o caminho mínimo de pedido", () => {
  test("sem backend, a mensagem diz como instalar (Configurações), não fala de instalador de clone", () => {
    const mensagem = mensagemSemBackend();
    assert.match(mensagem, /Configurações/i);
    assert.doesNotMatch(mensagem, /--sem-whisper/);
  });
});
