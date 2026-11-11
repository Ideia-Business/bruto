/**
 * Classes W e X (integração do instalador): o `uv` do pacote NUNCA usa o
 * Python do sistema.
 *
 * Prova em ambiente zerado (orquestradora): `uv tool install yt-dlp` sem
 * preferência de Python usou o `/usr/bin/python3` do sistema (Python 3.9),
 * instalou um yt-dlp antigo que o YouTube recusa ("The page needs to be
 * reloaded") — e num Mac sem Command Line Tools a sonda do
 * `/usr/bin/python3` pode abrir o diálogo da Apple. Com
 * `UV_PYTHON_PREFERENCE=only-managed` o mesmo fluxo instala o yt-dlp novo e
 * funciona.
 *
 *  W — todo comando de instalação/atualização do yt-dlp e do Whisper passa
 *      `--python-preference only-managed` no argv E `UV_PYTHON_PREFERENCE=
 *      only-managed` no ambiente do filho (o dublê do uv grava os dois).
 *  X — ferramenta montada ANTES da correção (venv cujo `home` do
 *      `pyvenv.cfg` aponta para fora do Python gerenciado, ex.:
 *      `/usr/bin`) é refeita na próxima garantia (`--reinstall`).
 */
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let raiz: string;
let ferramentas: string;
let binDir: string;
let uvToolDir: string;
let uvPythonDir: string;
let registroUv: string;
let registroEnv: string;
let marcaUpgrade: string;

let salvas: Record<string, string | undefined>;
const VARS = [
  "BRUTO_EMPACOTADO",
  "BRUTO_UV",
  "BRUTO_FERRAMENTAS",
  "UV_TOOL_DIR",
  "UV_TOOL_BIN_DIR",
  "UV_CACHE_DIR",
  "UV_PYTHON_INSTALL_DIR",
] as const;

/**
 * O dublê do uv grava o argv e o UV_PYTHON_PREFERENCE do ambiente do filho.
 * Em `install yt-dlp` ele "instala" como o uv de verdade com Python
 * gerenciado: binário em $UV_TOOL_BIN_DIR e venv com `pyvenv.cfg` cujo
 * `home` mora dentro de $UV_PYTHON_INSTALL_DIR.
 */
function escreverUvDuble(destino: string): void {
  fs.writeFileSync(
    destino,
    `#!/bin/sh
printf '%s\\n' "$*" >> "${registroUv}"
printf 'UV_PYTHON_PREFERENCE=%s\\n' "\${UV_PYTHON_PREFERENCE:-__AUSENTE__}" >> "${registroEnv}"
if [ -n "$BRUTO_UV_FALHA" ]; then echo "network unreachable" >&2; exit 1; fi
case "$*" in
  *install*yt-dlp*)
    mkdir -p "$UV_TOOL_BIN_DIR"
    printf '#!/bin/sh\\nexit 0\\n' > "$UV_TOOL_BIN_DIR/yt-dlp"
    chmod +x "$UV_TOOL_BIN_DIR/yt-dlp"
    mkdir -p "$UV_TOOL_DIR/yt-dlp"
    printf 'home = %s/cpython-3.13.8-macos-aarch64-none/bin\\n' "$UV_PYTHON_INSTALL_DIR" \\
      > "$UV_TOOL_DIR/yt-dlp/pyvenv.cfg"
    ;;
  *install*mlx-whisper*)
    mkdir -p "$UV_TOOL_DIR/mlx-whisper/bin"
    printf '#!/bin/sh\\nexit 0\\n' > "$UV_TOOL_DIR/mlx-whisper/bin/python"
    chmod +x "$UV_TOOL_DIR/mlx-whisper/bin/python"
    ;;
esac
exit 0
`,
    { mode: 0o755 },
  );
}

function chamadasUv(): string[] {
  try {
    return fs.readFileSync(registroUv, "utf8").split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

function ambientesDosFilhos(): string[] {
  try {
    return fs.readFileSync(registroEnv, "utf8").split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

/** Escreve o estado "yt-dlp instalado", com o venv apontando para o `home` dado. */
function ytDlpInstaladoComVenv(homeDoVenv: string): void {
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, "yt-dlp"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const venv = path.join(uvToolDir, "yt-dlp");
  fs.mkdirSync(venv, { recursive: true });
  fs.writeFileSync(path.join(venv, "pyvenv.cfg"), `home = ${homeDoVenv}\n`);
}

function assertPreferenciaGerenciada(chamada: string): void {
  assert.ok(
    chamada.includes("--python-preference only-managed"),
    `argv sem --python-preference only-managed: "${chamada}"`,
  );
  const ambientes = ambientesDosFilhos();
  assert.ok(ambientes.length > 0, "o dublê do uv não foi executado");
  for (const env of ambientes) {
    assert.equal(env, "UV_PYTHON_PREFERENCE=only-managed", "filho sem UV_PYTHON_PREFERENCE");
  }
}

let ferramentasMod: typeof import("@/pipeline/lib/ferramentas");

before(async () => {
  raiz = fs.mkdtempSync(path.join(os.tmpdir(), "bruto-uv-python-"));
  ferramentas = path.join(raiz, "ferramentas");
  binDir = path.join(ferramentas, "bin");
  uvToolDir = path.join(ferramentas, "uv", "tools");
  uvPythonDir = path.join(ferramentas, "uv", "python");
  fs.mkdirSync(binDir, { recursive: true });
  registroUv = path.join(raiz, "uv-chamadas.txt");
  registroEnv = path.join(raiz, "uv-env.txt");
  marcaUpgrade = path.join(ferramentas, "yt-dlp-atualizado-em.txt");

  const uvDuble = path.join(raiz, "uv-duble");
  escreverUvDuble(uvDuble);

  salvas = {};
  for (const v of VARS) salvas[v] = process.env[v];

  process.env.BRUTO_EMPACOTADO = "1";
  process.env.BRUTO_UV = uvDuble;
  process.env.BRUTO_FERRAMENTAS = ferramentas;
  process.env.UV_TOOL_DIR = uvToolDir;
  process.env.UV_TOOL_BIN_DIR = binDir;
  process.env.UV_CACHE_DIR = path.join(ferramentas, "uv", "cache");
  process.env.UV_PYTHON_INSTALL_DIR = uvPythonDir;

  ferramentasMod = await import("@/pipeline/lib/ferramentas");
});

after(() => {
  for (const v of VARS) {
    if (salvas[v] === undefined) delete process.env[v];
    else process.env[v] = salvas[v]!;
  }
  fs.rmSync(raiz, { recursive: true, force: true });
});

beforeEach(() => {
  ferramentasMod.__rearmarParaTestes();
  fs.rmSync(registroUv, { force: true });
  fs.rmSync(registroEnv, { force: true });
  fs.rmSync(ferramentas, { recursive: true, force: true });
  fs.mkdirSync(binDir, { recursive: true });
  delete process.env.BRUTO_UV_FALHA;
});

describe("classe W — uv nunca usa o Python do sistema", () => {
  test("instalação do yt-dlp: --python-preference only-managed no argv E no env do filho", async () => {
    await ferramentasMod.garantirYtDlp();
    const instalacoes = chamadasUv().filter((c) => c.includes("install") && c.includes("yt-dlp"));
    assert.equal(instalacoes.length, 1, `chamadas: ${JSON.stringify(chamadasUv())}`);
    assertPreferenciaGerenciada(instalacoes[0]);
  });

  test("upgrade semanal do yt-dlp: a preferência vai no argv E no env", async () => {
    ytDlpInstaladoComVenv(`${uvPythonDir}/cpython-3.13.8-macos-aarch64-none/bin`);
    fs.writeFileSync(marcaUpgrade, String(Date.now() - 8 * 24 * 60 * 60 * 1000)); // 8 dias
    await ferramentasMod.garantirYtDlp();
    const upgrades = chamadasUv().filter((c) => c.includes("upgrade"));
    assert.equal(upgrades.length, 1, `chamadas: ${JSON.stringify(chamadasUv())}`);
    assertPreferenciaGerenciada(upgrades[0]);
  });

  test("instalação do Whisper: a preferência vai no argv E no env", async () => {
    await ferramentasMod.instalarWhisper();
    const instalacoes = chamadasUv().filter((c) => c.includes("install") && c.includes("mlx-whisper"));
    assert.equal(instalacoes.length, 1, `chamadas: ${JSON.stringify(chamadasUv())}`);
    assertPreferenciaGerenciada(instalacoes[0]);
  });
});

describe("classe X — ferramenta montada com o Python do sistema é refeita", () => {
  test("venv apontando para /usr/bin (Python do sistema): garantia reinstala com --reinstall", async () => {
    ytDlpInstaladoComVenv("/usr/bin");
    await ferramentasMod.garantirYtDlp();
    const reinstalacoes = chamadasUv().filter(
      (c) => c.includes("install") && c.includes("--reinstall") && c.includes("yt-dlp"),
    );
    assert.equal(reinstalacoes.length, 1, `chamadas: ${JSON.stringify(chamadasUv())}`);
    assertPreferenciaGerenciada(reinstalacoes[0]);
  });

  test("venv com Python gerenciado e marca fresca: NENHUMA chamada ao uv", async () => {
    ytDlpInstaladoComVenv(`${uvPythonDir}/cpython-3.13.8-macos-aarch64-none/bin`);
    fs.writeFileSync(marcaUpgrade, String(Date.now()));
    await ferramentasMod.garantirYtDlp();
    assert.deepEqual(chamadasUv(), []);
  });

  test("reinstalação que falha não derruba o job (a ferramenta existente segue em uso)", async () => {
    ytDlpInstaladoComVenv("/usr/bin");
    process.env.BRUTO_UV_FALHA = "1";
    await ferramentasMod.garantirYtDlp(); // não pode rejeitar
    const reinstalacoes = chamadasUv().filter((c) => c.includes("--reinstall"));
    assert.equal(reinstalacoes.length, 1, `chamadas: ${JSON.stringify(chamadasUv())}`);
  });
});
