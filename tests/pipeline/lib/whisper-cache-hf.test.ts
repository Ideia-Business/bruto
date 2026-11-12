/**
 * r4+r5/P2 — o download do modelo Whisper roda com EXATAMENTE o ambiente da
 * transcrição.
 *
 * O bug r4: `baixarModeloWhisper` (ferramentas.ts) rodava via
 * `rodarInstalacao`, que herda o ambiente INTEIRO do servidor — inclusive
 * `HF_HOME`/`HF_HUB_CACHE`/`XDG_CACHE_HOME`, se definidas. A transcrição
 * (transcribe.ts) roda com `ambienteMinimo()`, que TIRA essas variáveis. Com
 * qualquer delas definida, a instalação baixava o modelo num cache, gravava a
 * marca de "pronto", e a transcrição procurava noutro: o 1º vídeo baixava
 * ~1,6 GB de novo (ou falhava sem rede).
 *
 * O bug r5 (mesma família): `HUGGINGFACE_HUB_CACHE` — a variável ANTIGA que
 * o `huggingface_hub` ainda honra (constants.py da 2.0.0: `HF_HUB_CACHE` >
 * `HUGGINGFACE_HUB_CACHE` > `HF_HOME/hub` > `XDG_CACHE_HOME/huggingface/hub`
 * > `~/.cache/huggingface/hub`) — chegava ao download POR HERANÇA e não
 * chegava à transcrição: o mesmo defeito, pela variável esquecida. A lista
 * fechada da r4 só fechava o que conhecia; a herança aberta garantia que
 * qualquer variável de cache desconhecida voltasse a trair.
 *
 * O fechamento pela CLASSE (r5): o download roda com EXATAMENTE o ambiente
 * da transcrição — montado pela MESMA função (`ambienteMinimo()`, que já
 * embute a allowlist de cache pela função única `ambienteCacheModelo`).
 * Nada herdado do servidor além do que a transcrição também recebe. A prova:
 * o cenário completo (instalação + transcrição) roda com CADA variável de
 * cache e com uma variável qualquer do servidor (`QUALQUER_COISA=1`) no ar —
 * e exige que o `env` de TODAS as execuções do Python (download antecipado,
 * sonda do backend e transcrição) seja IGUAL chave por chave, com o cache
 * esperado, e que `QUALQUER_COISA` (e `HF_TOKEN`) não cheguem a nenhuma.
 */
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * As variáveis que decidem onde o Python põe/lê o cache do HF — incluindo a
 * `HUGGINGFACE_HUB_CACHE`, a antiga que o huggingface_hub ainda honra (r5).
 */
const VARS_CACHE = ["HF_HOME", "HF_HUB_CACHE", "HUGGINGFACE_HUB_CACHE", "XDG_CACHE_HOME"] as const;

// ── Ambiente ANTES do import: `transcribe.ts` calcula o diretório de cache
// de transcrição a partir de DATA_ROOT na CARGA do módulo (padrão dos testes
// vizinhos — se isto ficasse no before(), o módulo nasceria apontando para o
// ~/.bruto real). ────────────────────────────────────────────────────────────
const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "bruto-r5-cache-hf-"));
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
  // A "variável qualquer do servidor" da r5: um poluente que não é cache nem
  // credencial — o download não pode recebê-la só porque o servidor a tem.
  "QUALQUER_COISA",
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
for (const v of [...VARS_CACHE, "HF_TOKEN", "QUALQUER_COISA"]) delete process.env[v];

/**
 * O Python dublê do venv: registra o ambiente COMPLETO que recebeu (um bloco
 * `---chamada` por execução, `env | sort`) e "transcreve" uma linha. Atende as
 * três formas de chamada — download (`-c <código>`), sonda (`-` + stdin) e
 * transcrição (`- <wav> <repo> <lang>` + stdin) — porque ignora argv/stdin.
 * O env inteiro (não só o cache) é o que prova a r5: download e transcrição
 * IGUAIS chave por chave, não só nas chaves que a lista conhece.
 */
const PYTHON_DUBLE = `#!/bin/sh
{
  printf '%s\\n' '---chamada'
  env | sort
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
  fs.writeFileSync(audioFake, "audio-fake-r5");

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
 * transcrição — com as variáveis de cache dadas no ambiente, SEMPRE com a
 * `QUALQUER_COISA=1` do servidor no ar, e devolve os blocos de ambiente
 * registrados por CADA execução do Python do venv.
 */
async function rodarCenario(
  vars: Record<string, string>,
  opts: { hfToken?: boolean } = {},
): Promise<string[][]> {
  for (const v of VARS_CACHE) delete process.env[v];
  delete process.env.HF_TOKEN;
  process.env.QUALQUER_COISA = "1";
  for (const [nome, valor] of Object.entries(vars)) process.env[nome] = valor;
  if (opts.hfToken) process.env.HF_TOKEN = "hf-segredo-do-teste";
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
    delete process.env.QUALQUER_COISA;
    delete process.env.HF_TOKEN;
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

/** As linhas de variável de CACHE do HF de um bloco de ambiente registrado. */
const LINHA_CACHE = /^(HF_HOME|HF_HUB_CACHE|HUGGINGFACE_HUB_CACHE|XDG_CACHE_HOME)=/;

function soCache(bloco: string[]): string[] {
  return bloco.filter((linha) => LINHA_CACHE.test(linha));
}

function temVar(bloco: string[], chave: string): boolean {
  return bloco.some((linha) => linha.startsWith(`${chave}=`));
}

/**
 * A invariante da r5/CLASS: download (i=0), sonda (i=1) e transcrição (i=2)
 * rodam com o MESMO ambiente, chave por chave — e nenhum deles recebe a
 * variável qualquer do servidor nem a credencial do HF.
 */
function exigirMesmoAmbiente(blocos: string[][], cenario: string): void {
  assert.equal(
    blocos.length,
    3,
    `${cenario}: esperava download+sonda+transcrição (3 execuções do Python), veio ${blocos.length}: ${JSON.stringify(blocos)}`,
  );
  const [download, sonda, transcricao] = blocos;
  assert.deepEqual(
    download,
    transcricao,
    `${cenario}: o env do download DIFERE do env da transcrição — chaves só no download: ${JSON.stringify(
      download.filter((l) => !transcricao.includes(l)),
    )}`,
  );
  assert.deepEqual(
    sonda,
    transcricao,
    `${cenario}: o env da sonda difere do env da transcrição`,
  );
  blocos.forEach((bloco, i) => {
    const papel = i === 0 ? "download" : i === 1 ? "sonda" : "transcrição";
    assert.ok(
      !temVar(bloco, "QUALQUER_COISA"),
      `${cenario}: QUALQUER_COISA (variável qualquer do servidor) chegou à execução de ${papel}`,
    );
    assert.ok(!temVar(bloco, "HF_TOKEN"), `${cenario}: HF_TOKEN chegou à execução de ${papel}`);
  });
}

describe("r5 — download e transcrição: EXATAMENTE o mesmo ambiente", () => {
  // Cada variável de cache, SOZINHA no ar: as três execuções têm de vê-la —
  // inclusive a `HUGGINGFACE_HUB_CACHE`, a antiga que a r4 não conhecia.
  for (const variavel of VARS_CACHE) {
    test(`com ${variavel} definida, TODAS as execuções do Python a recebem (e o env é o mesmo)`, async () => {
      const valor = path.join(raiz, `cache-${variavel.toLowerCase()}`);
      const blocos = await rodarCenario({ [variavel]: valor });
      exigirMesmoAmbiente(blocos, variavel);
      for (const [i, bloco] of blocos.entries()) {
        assert.deepEqual(
          soCache(bloco),
          [`${variavel}=${valor}`],
          `a execução #${i} do Python (i=0 download, i=1 sonda, i=2 transcrição) recebeu o cache errado`,
        );
      }
    });
  }

  test("com HF_HOME e HF_HUB_CACHE juntas, as duas chegam a todos (na ordem do HF, quem manda é o Python)", async () => {
    const hfHome = path.join(raiz, "cache-b");
    const hub = path.join(hfHome, "hub");
    const blocos = await rodarCenario({ HF_HOME: hfHome, HF_HUB_CACHE: hub });
    exigirMesmoAmbiente(blocos, "HF_HOME+HF_HUB_CACHE");
    for (const bloco of blocos) {
      assert.deepEqual(soCache(bloco), [`HF_HOME=${hfHome}`, `HF_HUB_CACHE=${hub}`]);
    }
  });

  test("sem nenhuma definida, nenhum processo as recebe (default nos dois lados)", async () => {
    const blocos = await rodarCenario({});
    exigirMesmoAmbiente(blocos, "sem cache definido");
    for (const bloco of blocos) assert.deepEqual(soCache(bloco), []);
  });

  test("r5: HF_TOKEN no servidor NÃO chega a processo NENHUM — nem ao download", async () => {
    // Na r4 o download herdava o servidor inteiro (com HF_TOKEN junto) e o
    // contrato aceitava: o stderr do download era descartado. A r5 fecha a
    // classe por construção — ambiente IGUAL ao da transcrição — e a
    // credencial deixa de existir para o download também.
    const hfHome = path.join(raiz, "cache-c");
    const blocos = await rodarCenario({ HF_HOME: hfHome }, { hfToken: true });
    exigirMesmoAmbiente(blocos, "HF_TOKEN no servidor");
    for (const bloco of blocos) assert.deepEqual(soCache(bloco), [`HF_HOME=${hfHome}`]);
  });
});

describe("r5 — a marca de prontidão retrata a allowlist de cache INTEIRA", () => {
  test("a HUGGINGFACE_HUB_CACHE (antiga) também invalida a marca ao mudar", async () => {
    const cacheA = path.join(raiz, "marca-hhc-a");
    const cacheB = path.join(raiz, "marca-hhc-b");

    process.env.HUGGINGFACE_HUB_CACHE = cacheA;
    __rearmarParaTestes();
    await instalarWhisper();
    assert.equal(whisperInstalado(), true, "instalado com HUGGINGFACE_HUB_CACHE=cacheA deve estar pronto");

    // A marca só vale para a MESMA decisão de cache com que nasceu: trocar a
    // variável ANTIGA troca o cache que o Python vai resolver — o modelo
    // ficou no cache velho e a prontidão cai (mesmo defeito da r4, só que
    // pela variável que a allowlist da r4 não cobria).
    process.env.HUGGINGFACE_HUB_CACHE = cacheB;
    assert.equal(
      whisperInstalado(),
      false,
      "mudou o cache (HUGGINGFACE_HUB_CACHE) → a marca de um cache outro não vale prontidão",
    );

    // E reinstalar baixa DE NOVO (o registro prova a 2ª execução do Python).
    fs.rmSync(registroPython, { force: true });
    __rearmarParaTestes();
    await instalarWhisper();
    assert.equal(whisperInstalado(), true, "reinstalado no cache novo, pronto de novo");
    assert.equal(blocosDoRegistro().length, 1, "a reinstalação refaz o download no cache novo");
    delete process.env.HUGGINGFACE_HUB_CACHE;
  });

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
