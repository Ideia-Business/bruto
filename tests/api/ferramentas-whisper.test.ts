/**
 * O pedido de Whisper (modo pacote): o Whisper NÃO vem no pacote — só é
 * instalado quando a pessoa pede (Configurações → Instalar, com aviso de
 * ~3,5 GB entre ferramenta e modelo). Este endpoint é a ação:
 *
 *   GET  /api/ferramentas/whisper → { suportado, instalado }
 *   POST /api/ferramentas/whisper → instala via `uv tool install
 *          --python-preference only-managed mlx-whisper` e, com o Python do
 *          próprio venv, JÁ BAIXA o modelo padrão (large-v3-turbo) — sem
 *          isso, o 1º vídeo parava num download de ~1,6 GB sem aviso
 *          (guarda de cliente; erro legível se falhar; nunca instala duas
 *          vezes ao mesmo tempo — F3; a preferência de Python gerenciado é
 *          a classe W)
 *
 * O dublê do uv "instala" criando o venv da ferramenta em $UV_TOOL_DIR
 * (com `bin/python`), que é como o app detecta o Whisper no modo pacote —
 * e o `bin/python` dublê REGISTRA o que recebeu, que é como o teste prova
 * o download antecipado do modelo.
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
let registroPython: string;

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
case "$*" in
  *"tool install"*mlx-whisper*)
    mkdir -p "$UV_TOOL_DIR/mlx-whisper/bin"
    # Heredoc SEM aspas para injetar ${registroPython}; por isso os "$" do
    # dublê vão escapados para o ARQUIVO ("\\$*" aqui = "$*" lá) — sem o
    # escape, o shell expandiria "$*" com os args do uv ao criar o python.
    cat > "$UV_TOOL_DIR/mlx-whisper/bin/python" <<EOF
#!/bin/sh
printf '%s\\n' "\\$*" >> "${registroPython}"
if [ -n "\\$BRUTO_PYTHON_FALHA" ]; then echo "download do modelo falhou" >&2; exit 1; fi
exit 0
EOF
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

/** O que o Python do venv recebeu (o download antecipado do modelo). */
function chamadasPython(): string[] {
  try {
    return fs.readFileSync(registroPython, "utf8").split("\n").filter(Boolean);
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
  registroPython = path.join(raiz, "python-chamadas.txt");

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
  fs.rmSync(registroPython, { force: true });
  fs.rmSync(uvToolDir, { recursive: true, force: true });
  delete process.env.BRUTO_UV_FALHA;
  delete process.env.BRUTO_PYTHON_FALHA;
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

  test("instala o venv com o uv do pacote E baixa o modelo padrão com o Python do venv", async () => {
    const res = await POST(req("POST"));
    assert.equal(res.status, 200, JSON.stringify(await res.json().catch(() => null)));
    assert.deepEqual(chamadasUv(), ["tool install --python-preference only-managed mlx-whisper"]);

    // O download antecipado: o Python do próprio venv recebe o repositório
    // RESOLVIDO do padrão novo — sem isto, o 1º vídeo parava ~1,6 GB de
    // download depois, sem aviso.
    const python = chamadasPython();
    assert.equal(python.length, 1, `esperava 1 chamada ao Python do venv, veio: ${python.join(" | ")}`);
    assert.match(python[0], /mlx-community\/whisper-large-v3-turbo/);

    const estado = await GET();
    assert.deepEqual(await estado.json(), { suportado: true, instalado: true });
  });

  test("segunda chamada com o venv já pronto: pula o uv e só confere o modelo", async () => {
    await POST(req("POST"));
    const uvDepoisDaPrimeira = chamadasUv().length;

    const res = await POST(req("POST"));
    assert.equal(res.status, 200);
    assert.equal(chamadasUv().length, uvDepoisDaPrimeira, "o uv não deve rodar de novo (venv já existe)");
    // O modelo é baixado/conferido em CADA pedido (idempotente: com o modelo
    // já em cache, o load_model só confere; é o preço aceito de não manter
    // mais uma marca de presença além das que o contrato já tem).
    assert.equal(chamadasPython().length, 2, "o Python do venv roda uma vez por pedido");
  });

  test("download do modelo quebra (rede caiu no meio): erro legível, e o venv instalado segue de pé", async () => {
    // 1ª tentativa instala o venv mas o Python falha no download do modelo.
    process.env.BRUTO_PYTHON_FALHA = "1";
    const falha = await POST(req("POST"));
    assert.equal(falha.status, 500);
    const corpo = await falha.json();
    assert.match(corpo.error, /transcrição|Whisper|internet/i);
    delete process.env.BRUTO_PYTHON_FALHA;

    // O venv sobrevive (o Whisper funciona; só o modelo antecipado faltou) —
    // e a pessoa pode tentar o download de novo sem reinstalar nada.
    const estado = await GET();
    assert.deepEqual(await estado.json(), { suportado: true, instalado: true });

    const retry = await POST(req("POST"));
    assert.equal(retry.status, 200);
    assert.equal(chamadasUv().length, 1, "o retry não repete o uv tool install");
  });

  test("duas instalações concorrentes: o uv e o download rodam UMA vez (F3)", async () => {
    const [a, b] = await Promise.all([POST(req("POST")), POST(req("POST"))]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.deepEqual(chamadasUv(), ["tool install --python-preference only-managed mlx-whisper"]);
    assert.equal(chamadasPython().length, 1);
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
