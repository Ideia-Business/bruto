/**
 * O pedido de Whisper (modo pacote): o Whisper NÃO vem no pacote — só é
 * instalado quando a pessoa pede (Configurações → Instalar, com aviso de
 * ~2 GB). Este endpoint é a ação:
 *
 *   GET  /api/ferramentas/whisper → { suportado, instalado }
 *   POST /api/ferramentas/whisper → instala via `uv tool install mlx-whisper`
 *          (guarda de cliente; erro legível se falhar; nunca instala duas
 *          vezes ao mesmo tempo — F3)
 *
 * O dublê do uv "instala" criando o venv da ferramenta em $UV_TOOL_DIR
 * (com `bin/python`), que é como o app detecta o Whisper no modo pacote.
 */
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let raiz: string;
let ferramentas: string;
let uvToolDir: string;
let registroUv: string;

let salvas: Record<string, string | undefined>;
const VARS = [
  "BRUTO_EMPACOTADO",
  "BRUTO_UV",
  "BRUTO_FERRAMENTAS",
  "BRUTO_DATA_ROOT",
  "UV_TOOL_DIR",
  "UV_TOOL_BIN_DIR",
  "UV_CACHE_DIR",
  "UV_PYTHON_INSTALL_DIR",
] as const;

function escreverUvDuble(destino: string): void {
  fs.writeFileSync(
    destino,
    `#!/bin/sh
printf '%s\\n' "$*" >> "${registroUv}"
if [ -n "$BRUTO_UV_FALHA" ]; then echo "network unreachable" >&2; exit 1; fi
if [ "$1" = "tool" ] && [ "$2" = "install" ] && [ "$3" = "mlx-whisper" ]; then
  mkdir -p "$UV_TOOL_DIR/mlx-whisper/bin"
  cat > "$UV_TOOL_DIR/mlx-whisper/bin/python" <<'EOF'
#!/bin/sh
exit 0
EOF
  chmod +x "$UV_TOOL_DIR/mlx-whisper/bin/python"
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

before(async () => {
  raiz = fs.mkdtempSync(path.join(os.tmpdir(), "bruto-whisper-endpoint-"));
  ferramentas = path.join(raiz, "ferramentas");
  uvToolDir = path.join(ferramentas, "uv", "tools");
  fs.mkdirSync(path.join(ferramentas, "bin"), { recursive: true });
  registroUv = path.join(raiz, "uv-chamadas.txt");

  const uvDuble = path.join(raiz, "uv-duble");
  escreverUvDuble(uvDuble);

  salvas = {};
  for (const v of VARS) salvas[v] = process.env[v];

  process.env.BRUTO_EMPACOTADO = "1";
  process.env.BRUTO_UV = uvDuble;
  process.env.BRUTO_FERRAMENTAS = ferramentas;
  process.env.BRUTO_DATA_ROOT = path.join(raiz, "dados");
  process.env.UV_TOOL_DIR = uvToolDir;
  process.env.UV_TOOL_BIN_DIR = path.join(ferramentas, "bin");
  process.env.UV_CACHE_DIR = path.join(ferramentas, "uv", "cache");
  process.env.UV_PYTHON_INSTALL_DIR = path.join(ferramentas, "uv", "python");

  ({ GET, POST } = await import("@/app/api/ferramentas/whisper/route"));
});

after(() => {
  for (const v of VARS) {
    if (salvas[v] === undefined) delete process.env[v];
    else process.env[v] = salvas[v]!;
  }
  fs.rmSync(raiz, { recursive: true, force: true });
});

let GET: typeof import("@/app/api/ferramentas/whisper/route").GET;
let POST: typeof import("@/app/api/ferramentas/whisper/route").POST;

function req(metodo: string, cliente: string | null = "app"): Request {
  const headers: Record<string, string> = { host: "127.0.0.1:3999" };
  if (cliente !== null) headers["x-bruto-cliente"] = cliente;
  return new Request("http://127.0.0.1:3999/api/ferramentas/whisper", {
    method: metodo,
    headers,
  });
}

beforeEach(() => {
  fs.rmSync(registroUv, { force: true });
  fs.rmSync(uvToolDir, { recursive: true, force: true });
  delete process.env.BRUTO_UV_FALHA;
});

describe("GET /api/ferramentas/whisper — estado", () => {
  test("não instalado: instalado=false, suportado=true em modo pacote", async () => {
    const res = await GET();
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { suportado: true, instalado: false });
  });

  test("modo clone: suportado=false (a instalação por endpoint não se aplica)", async () => {
    delete process.env.BRUTO_EMPACOTADO;
    try {
      const res = await GET();
      const corpo = await res.json();
      assert.equal(corpo.suportado, false);
    } finally {
      process.env.BRUTO_EMPACOTADO = "1";
    }
  });
});

describe("POST /api/ferramentas/whisper — instalação sob pedido", () => {
  test("sem o cabeçalho de cliente: recusado (guarda padrão das mutações)", async () => {
    const res = await POST(req("POST", null));
    assert.equal(res.status, 415);
    assert.deepEqual(chamadasUv(), []);
  });

  test("instala com o uv do pacote e passa a constar instalado", async () => {
    const res = await POST(req("POST"));
    assert.equal(res.status, 200);
    assert.deepEqual(chamadasUv(), ["tool install mlx-whisper"]);

    const estado = await GET();
    assert.deepEqual(await estado.json(), { suportado: true, instalado: true });
  });

  test("duas instalações concorrentes: o uv roda UMA vez (F3)", async () => {
    const [a, b] = await Promise.all([POST(req("POST")), POST(req("POST"))]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.deepEqual(chamadasUv(), ["tool install mlx-whisper"]);
  });

  test("falha de rede do uv: erro legível, e não fica 'instalado'", async () => {
    process.env.BRUTO_UV_FALHA = "1";
    const res = await POST(req("POST"));
    assert.equal(res.status, 500);
    const corpo = await res.json();
    assert.match(corpo.error, /transcrição|Whisper|internet/i);

    const estado = await GET();
    const corpoEstado = await estado.json();
    assert.equal(corpoEstado.instalado, false);
  });
});
