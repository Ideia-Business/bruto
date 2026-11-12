/**
 * r4/P2 — download e transcrição do modelo Whisper usam o MESMO cache do
 * Hugging Face.
 *
 * O bug: `baixarModeloWhisper` (ferramentas.ts) roda via `rodarInstalacao`,
 * que herda o ambiente INTEIRO do servidor — inclusive `HF_HOME`/
 * `HF_HUB_CACHE`/`XDG_CACHE_HOME`, se definidas. A transcrição (transcribe.ts)
 * roda com `ambienteMinimo()`, que TIRA essas três. Com qualquer delas
 * definida, a instalação baixa o modelo num cache, grava a marca de "pronto",
 * e a transcrição procura noutro: o 1º vídeo baixa ~1,6 GB de novo (ou falha
 * sem rede).
 *
 * A prova: o MESMO dublê de Python do venv (`$UV_TOOL_DIR/mlx-whisper/bin/
 * python`) atende os DOIS momentos — o download antecipado (`instalarWhisper`)
 * e a transcrição mlx (`transcreverAudio`) — e registra, de cada execução, as
 * variáveis de cache do HF que recebeu. A invariante: TODAS as execuções
 * refletem exatamente a decisão de cache do ambiente do teste — nenhuma
 * diferença entre os dois processos, e `HF_TOKEN` (credencial) nunca chega.
 */
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** As três variáveis que decidem onde o Python põe/lê o cache do HF. */
const VARS_CACHE = ["HF_HOME", "HF_HUB_CACHE", "XDG_CACHE_HOME"] as const;

// ── Ambiente ANTES do import: `transcribe.ts` calcula o diretório de cache
// de transcrição a partir de DATA_ROOT na CARGA do módulo (padrão dos testes
// vizinhos — se isto ficasse no before(), o módulo nasceria apontando para o
// ~/.bruto real). ────────────────────────────────────────────────────────────
const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "bruto-r4-cache-hf-"));
const ferramentas = path.join(raiz, "ferramentas");
const binDir = path.join(ferramentas, "bin");
const dataRoot = path.join(raiz, "dados");
const uvToolDir = path.join(ferramentas, "uv", "tools");
const registroUv = path.join(raiz, "uv-chamadas.txt");
const registroPython = path.join(raiz, "python-env.txt");
const audioFake = path.join(raiz, "audio.mp4");

const VARS = [
  "BRUTO_EMPACOTADO",
  "BRUTO_UV",
  "BRUTO_FFMPEG",
  "BRUTO_FERRAMENTAS",
  "BRUTO_DATA_ROOT",
  "BRUTO_WHISPER_MODEL",
  "UV_TOOL_DIR",
  "UV_TOOL_BIN_DIR",
  "UV_CACHE_DIR",
  "UV_PYTHON_INSTALL_DIR",
  ...VARS_CACHE,
  "HF_TOKEN",
] as const;
const salvas: Record<string, string | undefined> = {};
for (const v of VARS) salvas[v] = process.env[v];

process.env.BRUTO_EMPACOTADO = "1";
process.env.BRUTO_FERRAMENTAS = ferramentas;
process.env.BRUTO_DATA_ROOT = dataRoot;
process.env.UV_TOOL_DIR = uvToolDir;
process.env.UV_TOOL_BIN_DIR = binDir;
process.env.UV_CACHE_DIR = path.join(ferramentas, "uv", "cache");
process.env.UV_PYTHON_INSTALL_DIR = path.join(ferramentas, "uv", "python");
delete process.env.BRUTO_WHISPER_MODEL; // o padrão (large-v3-turbo) é o testado
// O teste manda nas variáveis de cache — o que a MÁQUINA que o roda tiver
// definido (um HF_HOME de dev, por exemplo) não pode vazar para a asserção.
for (const v of [...VARS_CACHE, "HF_TOKEN"]) delete process.env[v];

/**
 * O Python dublê do venv: registra as variáveis de cache do HF que recebeu
 * (um bloco `---chamada` por execução) e "transcreve" uma linha. Atende as
 * três formas de chamada — download (`-c <código>`), sonda (`-` + stdin) e
 * transcrição (`- <wav> <repo> <lang>` + stdin) — porque ignora argv/stdin.
 */
const PYTHON_DUBLE = `#!/bin/sh
{
  printf '%s\\n' '---chamada'
  env | grep -E '^(HF_HOME|HF_HUB_CACHE|XDG_CACHE_HOME|HF_TOKEN)=' | sort
} >> "${registroPython}"
echo texto-transcrito-pelo-duble
exit 0
`;

let instalarWhisper: typeof import("@/pipeline/lib/ferramentas").instalarWhisper;
let whisperInstalado: typeof import("@/pipeline/lib/ferramentas").whisperInstalado;
let __rearmarParaTestes: typeof import("@/pipeline/lib/ferramentas").__rearmarParaTestes;
let transcreverAudio: typeof import("@/pipeline/lib/transcribe").transcreverAudio;
let rearmarDeteccao: typeof import("@/pipeline/lib/transcribe").rearmarDeteccao;

before(async () => {
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(audioFake, "audio-fake-r4");

  // O uv dublê "instala" criando o venv com o Python dublê dentro — é assim
  // que o app resolve o interpretador do mlx-whisper no modo pacote.
  const uvDuble = path.join(raiz, "uv-duble");
  fs.writeFileSync(
    uvDuble,
    `#!/bin/sh
printf '%s\\n' "$*" >> "${registroUv}"
case "$*" in
  *"mlx-whisper"*)
    mkdir -p "$UV_TOOL_DIR/mlx-whisper/bin"
    cat > "$UV_TOOL_DIR/mlx-whisper/bin/python" <<'EOF_PY'
${PYTHON_DUBLE}EOF_PY
    chmod +x "$UV_TOOL_DIR/mlx-whisper/bin/python"
    ;;
esac
exit 0
`,
    { mode: 0o755 },
  );
  process.env.BRUTO_UV = uvDuble;

  // O ffmpeg dublê "extrai" um wav com conteúdo (o destino é o último arg).
  const ffmpegDuble = path.join(raiz, "ffmpeg-duble");
  fs.writeFileSync(
    ffmpegDuble,
    `#!/bin/sh\nfor last; do :; done\nprintf 'wav-falso' > "$last"\nexit 0\n`,
    { mode: 0o755 },
  );
  process.env.BRUTO_FFMPEG = ffmpegDuble;

  ({
    instalarWhisper,
    whisperInstalado,
    __rearmarParaTestes,
  } = await import("@/pipeline/lib/ferramentas"));
  ({ transcreverAudio, rearmarDeteccao } = await import("@/pipeline/lib/transcribe"));
});

after(() => {
  for (const v of VARS) {
    if (salvas[v] === undefined) delete process.env[v];
    else process.env[v] = salvas[v]!;
  }
  fs.rmSync(raiz, { recursive: true, force: true });
});

/** Apaga marcas de "modelo baixado" e o cache de transcrição do cenário. */
function limparEstadoEntreCenarios(): void {
  for (const nome of fs.readdirSync(ferramentas)) {
    if (nome.startsWith("whisper-modelo-")) {
      fs.rmSync(path.join(ferramentas, nome), { force: true });
    }
  }
  fs.rmSync(registroUv, { force: true });
  fs.rmSync(registroPython, { force: true });
  // Sem isto, a 2ª transcrição do MESMO wav sairia do cache e nem chamaria
  // o Python — e o teste deixaria de medir o ambiente da transcrição.
  fs.rmSync(path.join(dataRoot, "transcripts"), { recursive: true, force: true });
}

beforeEach(() => {
  limparEstadoEntreCenarios();
});

/**
 * Roda o cenário completo — instalação (download antecipado do modelo) E
 * transcrição — com as variáveis de cache dadas no ambiente, e devolve os
 * blocos de variáveis registrados por CADA execução do Python do venv.
 */
async function rodarCenario(vars: Record<string, string>): Promise<string[][]> {
  for (const v of VARS_CACHE) delete process.env[v];
  delete process.env.HF_TOKEN;
  for (const [nome, valor] of Object.entries(vars)) process.env[nome] = valor;
  try {
    __rearmarParaTestes();
    await instalarWhisper();
    // A sonda memoizada precisaria rodar de novo só se o venv sumisse; rearmar
    // mesmo assim uniformiza os cenários: sempre sonda + transcrição.
    rearmarDeteccao();
    const texto = await transcreverAudio(audioFake, "");
    assert.equal(texto, "texto-transcrito-pelo-duble");
    return blocosDoRegistro();
  } finally {
    for (const nome of Object.keys(vars)) delete process.env[nome];
  }
}

/** O registro do Python dublê, em blocos (um por execução do processo). */
function blocosDoRegistro(): string[][] {
  let linhas: string[];
  try {
    linhas = fs.readFileSync(registroPython, "utf8").split("\n").filter(Boolean);
  } catch {
    return [];
  }
  const blocos: string[][] = [];
  for (const linha of linhas) {
    if (linha === "---chamada") blocos.push([]);
    else if (blocos.length > 0) blocos[blocos.length - 1].push(linha);
  }
  return blocos;
}

describe("r4 — download e transcrição: MESMO ambiente de cache do HF", () => {
  test("com HF_HOME definido, TODOS os processos Python recebem HF_HOME", async () => {
    const hfHome = path.join(raiz, "cache-a");
    const blocos = await rodarCenario({ HF_HOME: hfHome });
    // Download do modelo + sonda do backend + transcrição = 3 execuções.
    assert.equal(
      blocos.length,
      3,
      `esperava download+sonda+transcrição (3 execuções do Python), veio ${blocos.length}: ${JSON.stringify(blocos)}`,
    );
    for (const [i, bloco] of blocos.entries()) {
      assert.deepEqual(
        bloco,
        [`HF_HOME=${hfHome}`],
        `a execução #${i} do Python (i=0 download, i=1 sonda, i=2 transcrição) recebeu o cache errado`,
      );
    }
  });

  test("com XDG_CACHE_HOME definido, idem — cada variável conta", async () => {
    const xdg = path.join(raiz, "cache-xdg");
    const blocos = await rodarCenario({ XDG_CACHE_HOME: xdg });
    assert.equal(blocos.length, 3);
    for (const bloco of blocos) assert.deepEqual(bloco, [`XDG_CACHE_HOME=${xdg}`]);
  });

  test("com HF_HOME e HF_HUB_CACHE juntas, as duas chegam a todos", async () => {
    const hfHome = path.join(raiz, "cache-b");
    const hub = path.join(hfHome, "hub");
    const blocos = await rodarCenario({ HF_HOME: hfHome, HF_HUB_CACHE: hub });
    assert.equal(blocos.length, 3);
    for (const bloco of blocos) {
      assert.deepEqual(bloco, [`HF_HOME=${hfHome}`, `HF_HUB_CACHE=${hub}`]);
    }
  });

  test("sem nenhuma definida, nenhum processo as recebe (default nos dois lados)", async () => {
    const blocos = await rodarCenario({});
    assert.equal(blocos.length, 3);
    for (const bloco of blocos) assert.deepEqual(bloco, []);
  });

  test("HF_TOKEN no ambiente não chega à TRANSCRIÇÃO — só caminho de cache passa", async () => {
    const hfHome = path.join(raiz, "cache-c");
    const blocos = await rodarCenario({ HF_HOME: hfHome, HF_TOKEN: "hf-segredo-do-teste" });
    assert.equal(blocos.length, 3);
    const [download, ...transcricao] = blocos;
    // A transcrição (sonda + mlx) é onde o stderr vira `jobs.error_message`:
    // lá, credencial NUNCA — só o caminho de cache, que não é segredo.
    assert.deepEqual(
      transcricao,
      [[`HF_HOME=${hfHome}`], [`HF_HOME=${hfHome}`]],
      "a credencial do HF vazou para o processo de transcrição",
    );
    // O download herda o servidor inteiro (é a opção (a): precisa do ambiente
    // de rede — proxies, CAs — e o stderr dele é DESCARTADO por
    // instalarWhisper, nunca persistido). O que o repasse explícito lhe
    // garante é o cache — não mais que isso:
    assert.ok(
      download.includes(`HF_HOME=${hfHome}`),
      "o download recebe a variável de cache repassada",
    );
  });
});

describe("r4 — a marca de prontidão é coerente com o cache (mesmo repo, mesmo cache)", () => {
  test("trocar HF_HOME depois de instalado derruba a prontidão (o modelo ficou no cache velho)", async () => {
    const cacheA = path.join(raiz, "marca-a");
    const cacheB = path.join(raiz, "marca-b");

    process.env.HF_HOME = cacheA;
    __rearmarParaTestes();
    await instalarWhisper();
    assert.equal(whisperInstalado(), true, "instalado com HF_HOME=cacheA deve estar pronto");

    // A marca não pode ficar "pronta" para um cache que o modelo não está:
    // a transcrição procuraria em cacheB e baixaria de novo (o bug r4, em
    // câmera lenta — só que por troca de variável no lançador).
    process.env.HF_HOME = cacheB;
    assert.equal(
      whisperInstalado(),
      false,
      "mudou o cache (HF_HOME) → a marca de um cache outro não vale prontidão",
    );

    // E reinstalar baixa de VERDADE de novo (o registro prova a 2ª execução).
    fs.rmSync(registroPython, { force: true });
    __rearmarParaTestes();
    await instalarWhisper();
    assert.equal(whisperInstalado(), true, "reinstalado no cache novo, pronto de novo");
    assert.equal(blocosDoRegistro().length, 1, "a reinstalação refaz o download no cache novo");
    delete process.env.HF_HOME;
  });
});
