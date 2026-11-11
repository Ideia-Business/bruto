/**
 * INVARIANTE F1 (prova do yt-dlp) + F3 (preparação nunca prende a fila).
 *
 * Cenário: modo pacote ligado, um `yt-dlp`/`ffmpeg` FALSO na frente do PATH
 * que grava "fui chamado" se for executado, e dublês nas variáveis do
 * contrato (`BRUTO_FERRAMENTAS`, `BRUTO_UV`, `BRUTO_FFMPEG`).
 *
 * Provas:
 *  - o falso do PATH NUNCA é chamado; quem roda é o dublê de
 *    `$BRUTO_FERRAMENTAS/bin/yt-dlp` (resolução por caminho absoluto);
 *  - em modo pacote o yt-dlp recebe `--ffmpeg-location $BRUTO_FFMPEG`;
 *  - primeiro uso: yt-dlp ausente → `uv tool install yt-dlp` (F3: UMA
 *    instalação compartilhada entre chamadas concorrentes);
 *  - upgrade no máximo uma vez a cada 7 dias (marca de tempo em
 *    `$BRUTO_FERRAMENTAS`);
 *  - falha de instalação vira erro tipado e legível, nunca job preso.
 */
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000;

let raiz: string;
let ferramentas: string;
let binDir: string;
let pathFalso: string;
let registroPathFalso: string;
let registroUv: string;
let registroYtDlp: string;
let ffmpegDuble: string;
let uvDuble: string;

let salvas: Record<string, string | undefined>;
const VARS = [
  "BRUTO_EMPACOTADO",
  "BRUTO_FFMPEG",
  "BRUTO_UV",
  "BRUTO_FERRAMENTAS",
  "UV_TOOL_DIR",
  "UV_TOOL_BIN_DIR",
  "UV_CACHE_DIR",
  "UV_PYTHON_INSTALL_DIR",
  "PATH",
] as const;

/** O dublê do yt-dlp responde um --dump-json mínimo e grava os argumentos. */
function escreverYtDlpDuble(destino: string): void {
  fs.writeFileSync(
    destino,
    `#!/bin/sh\nfor a in "$@"; do printf '%s\\n' "$a" >> "${registroYtDlp}"; done\nprintf '%s\\n' '---' >> "${registroYtDlp}"\nprintf '{"id":"x","title":"t"}'\n`,
    { mode: 0o755 },
  );
}

/**
 * O dublê do uv grava cada chamada. Em `tool install yt-dlp` ele "instala":
 * cria o binário em $UV_TOOL_BIN_DIR. Com `BRUTO_UV_FALHA=1`, sai com erro
 * (simula máquina sem internet).
 */
function escreverUvDuble(destino: string): void {
  fs.writeFileSync(
    destino,
    `#!/bin/sh
printf '%s\\n' "$*" >> "${registroUv}"
if [ -n "$BRUTO_UV_FALHA" ]; then echo "network unreachable" >&2; exit 1; fi
if [ "$1" = "tool" ] && [ "$2" = "install" ] && [ "$3" = "yt-dlp" ]; then
  mkdir -p "$UV_TOOL_BIN_DIR"
  cat > "$UV_TOOL_BIN_DIR/yt-dlp" <<'EOF'
#!/bin/sh
printf '%s\\n' "$@" >> "${registroYtDlp}"
printf '%s\\n' '---' >> "${registroYtDlp}"
printf '{"id":"instalado","title":"t"}'
EOF
  chmod +x "$UV_TOOL_BIN_DIR/yt-dlp"
fi
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

function pathFalsoFoiChamado(): boolean {
  try {
    return fs.readFileSync(registroPathFalso, "utf8").length > 0;
  } catch {
    return false;
  }
}

function argsDaUltimaChamadaYtDlp(): string[] {
  const blocos = fs.readFileSync(registroYtDlp, "utf8").split("---\n").filter(Boolean);
  return (blocos.at(-1) ?? "").split("\n").filter(Boolean);
}

function limparRegistros(): void {
  for (const f of [registroUv, registroYtDlp, registroPathFalso]) {
    fs.rmSync(f, { force: true });
  }
}

function removerYtDlpInstalado(): void {
  fs.rmSync(path.join(binDir, "yt-dlp"), { force: true });
  fs.rmSync(path.join(ferramentas, "yt-dlp-atualizado-em.txt"), { force: true });
}

let fetchMetadata: typeof import("@/pipeline/lib/ytdlp").fetchMetadata;
let ferramentasMod: typeof import("@/pipeline/lib/ferramentas");

before(async () => {
  raiz = fs.mkdtempSync(path.join(os.tmpdir(), "bruto-f1-ytdlp-"));
  ferramentas = path.join(raiz, "ferramentas");
  binDir = path.join(ferramentas, "bin");
  fs.mkdirSync(binDir, { recursive: true });

  registroPathFalso = path.join(raiz, "falso-chamado.txt");
  registroUv = path.join(raiz, "uv-chamadas.txt");
  registroYtDlp = path.join(raiz, "ytdlp-args.txt");

  // Falsos do PATH: se QUALQUER um rodar, gravam a prova do fracasso.
  pathFalso = path.join(raiz, "path-falso");
  fs.mkdirSync(pathFalso);
  for (const nome of ["yt-dlp", "ffmpeg", "ffprobe", "uv"]) {
    fs.writeFileSync(
      path.join(pathFalso, nome),
      `#!/bin/sh\necho "FUI CHAMADO: ${nome}" >> "${registroPathFalso}"\nexit 1\n`,
      { mode: 0o755 },
    );
  }

  ffmpegDuble = path.join(raiz, "ffmpeg-duble");
  fs.writeFileSync(ffmpegDuble, "#!/bin/sh\nexit 0\n", { mode: 0o755 });

  uvDuble = path.join(raiz, "uv-duble");
  escreverUvDuble(uvDuble);

  salvas = {};
  for (const v of VARS) salvas[v] = process.env[v];

  process.env.BRUTO_EMPACOTADO = "1";
  process.env.BRUTO_FFMPEG = ffmpegDuble;
  process.env.BRUTO_UV = uvDuble;
  process.env.BRUTO_FERRAMENTAS = ferramentas;
  process.env.UV_TOOL_DIR = path.join(ferramentas, "uv", "tools");
  process.env.UV_TOOL_BIN_DIR = binDir;
  process.env.UV_CACHE_DIR = path.join(ferramentas, "uv", "cache");
  process.env.UV_PYTHON_INSTALL_DIR = path.join(ferramentas, "uv", "python");
  // O PATH falso na frente: se o código resolver pelo PATH, pega o falso.
  process.env.PATH = `${pathFalso}${path.delimiter}/usr/bin${path.delimiter}/bin`;

  ({ fetchMetadata } = await import("@/pipeline/lib/ytdlp"));
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
  limparRegistros();
  removerYtDlpInstalado();
  delete process.env.BRUTO_UV_FALHA;
});

describe("F1 — em modo pacote o yt-dlp do PATH nunca é chamado", () => {
  test("fetchMetadata usa o dublê de $BRUTO_FERRAMENTAS/bin e ignora o PATH", async () => {
    escreverYtDlpDuble(path.join(binDir, "yt-dlp"));
    await fetchMetadata("https://www.youtube.com/watch?v=abc12345678");
    assert.equal(pathFalsoFoiChamado(), false, "um binário falso do PATH foi executado");
    const args = argsDaUltimaChamadaYtDlp();
    assert.ok(args.includes("--dump-json"), `o dublê não foi chamado (args: ${JSON.stringify(args)})`);
  });

  test("o yt-dlp recebe --ffmpeg-location com o BRUTO_FFMPEG do contrato", async () => {
    escreverYtDlpDuble(path.join(binDir, "yt-dlp"));
    await fetchMetadata("https://www.youtube.com/watch?v=abc12345678");
    const args = argsDaUltimaChamadaYtDlp();
    const i = args.indexOf("--ffmpeg-location");
    assert.notEqual(i, -1, `sem --ffmpeg-location (args: ${JSON.stringify(args)})`);
    assert.equal(args[i + 1], ffmpegDuble);
    assert.equal(pathFalsoFoiChamado(), false);
  });
});

describe("F3 — primeiro uso: instalação do yt-dlp pelo uv do pacote", () => {
  test("yt-dlp ausente dispara `uv tool install yt-dlp` e o job segue", async () => {
    assert.equal(fs.existsSync(path.join(binDir, "yt-dlp")), false);
    await fetchMetadata("https://www.youtube.com/watch?v=abc12345678");
    assert.deepEqual(chamadasUv(), ["tool install yt-dlp"]);
    assert.equal(fs.existsSync(path.join(binDir, "yt-dlp")), true);
    // E quem rodou o metadata foi o yt-dlp INSTALADO, não o falso do PATH.
    assert.equal(pathFalsoFoiChamado(), false);
  });

  test("duas chamadas concorrentes disparam UMA instalação (promessa compartilhada)", async () => {
    await Promise.all([
      fetchMetadata("https://www.youtube.com/watch?v=abc12345678"),
      fetchMetadata("https://www.youtube.com/watch?v=def12345678"),
    ]);
    const instalacoes = chamadasUv().filter((c) => c === "tool install yt-dlp");
    assert.equal(instalacoes.length, 1, `instalações: ${JSON.stringify(chamadasUv())}`);
  });

  test("falha de instalação vira erro tipado e legível — nunca job preso", async () => {
    process.env.BRUTO_UV_FALHA = "1";
    await assert.rejects(
      () => fetchMetadata("https://www.youtube.com/watch?v=abc12345678"),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /Não foi possível preparar o baixador de vídeos \(yt-dlp\)/);
        return true;
      },
    );
    // E a promessa NÃO fica cacheada no fracasso: a próxima tentativa instala de novo.
    delete process.env.BRUTO_UV_FALHA;
    await fetchMetadata("https://www.youtube.com/watch?v=abc12345678");
    assert.equal(fs.existsSync(path.join(binDir, "yt-dlp")), true);
  });

  test("instalação demorada demais tem teto de tempo (F3)", async () => {
    // uv dublê que dorme para sempre: a garantia precisa rejeitar com teto.
    const uvLento = path.join(raiz, "uv-lento");
    fs.writeFileSync(uvLento, "#!/bin/sh\nsleep 600\n", { mode: 0o755 });
    const uvOriginal = process.env.BRUTO_UV;
    process.env.BRUTO_UV = uvLento;
    // Força o módulo a esquecer instalações anteriores deste arquivo de teste.
    ferramentasMod.__rearmarParaTestes();
    try {
      const inicio = Date.now();
      await assert.rejects(() => ferramentasMod.garantirYtDlp({ timeoutMs: 300 }), /yt-dlp|tempo|timeout/i);
      assert.ok(Date.now() - inicio < 10_000, "o teto de tempo não segurou");
    } finally {
      process.env.BRUTO_UV = uvOriginal;
      ferramentasMod.__rearmarParaTestes();
    }
  });
});

describe("F3 — upgrade do yt-dlp no máximo uma vez a cada 7 dias", () => {
  test("instalado e com marca recente: NÃO roda upgrade", async () => {
    escreverYtDlpDuble(path.join(binDir, "yt-dlp"));
    fs.writeFileSync(
      path.join(ferramentas, "yt-dlp-atualizado-em.txt"),
      String(Date.now()),
    );
    await fetchMetadata("https://www.youtube.com/watch?v=abc12345678");
    assert.deepEqual(chamadasUv(), []);
  });

  test("instalado com marca mais velha que 7 dias: roda `uv tool upgrade yt-dlp` UMA vez", async () => {
    escreverYtDlpDuble(path.join(binDir, "yt-dlp"));
    fs.writeFileSync(
      path.join(ferramentas, "yt-dlp-atualizado-em.txt"),
      String(Date.now() - SETE_DIAS_MS - 60_000),
    );
    await fetchMetadata("https://www.youtube.com/watch?v=abc12345678");
    await fetchMetadata("https://www.youtube.com/watch?v=def12345678");
    assert.deepEqual(chamadasUv(), ["tool upgrade yt-dlp"]);
  });

  test("upgrade que falha NÃO derruba o job (a ferramenta já existe e funciona)", async () => {
    escreverYtDlpDuble(path.join(binDir, "yt-dlp"));
    fs.writeFileSync(
      path.join(ferramentas, "yt-dlp-atualizado-em.txt"),
      String(Date.now() - SETE_DIAS_MS - 60_000),
    );
    process.env.BRUTO_UV_FALHA = "1";
    await fetchMetadata("https://www.youtube.com/watch?v=abc12345678"); // não pode rejeitar
    const args = argsDaUltimaChamadaYtDlp();
    assert.ok(args.includes("--dump-json"), "o job não seguiu depois do upgrade falho");
  });
});
