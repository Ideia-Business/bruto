/**
 * O pedido de Whisper (modo pacote): o Whisper NÃO vem no pacote — só é
 * instalado quando a pessoa pede (Configurações → Instalar, com aviso de
 * ~3 GB entre ferramenta e modelo). Este endpoint é a ação:
 *
 *   GET  /api/ferramentas/whisper → { suportado, instalado, venvInstalado }
 *          `instalado` = prontidão de VDD (venv E modelo padrão baixado até
 *          o fim — r3/P2); `venvInstalado` é o que decide o texto do botão
 *          ("Baixar o modelo" quando o venv já existe, "Instalar" quando não).
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
  "BRUTO_WHISPER_MODEL",
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
    # O gatilho de falha é um ARQUIVO (não variável de ambiente): desde a r5
    # o Python do download roda com EXATAMENTE o ambiente da transcrição
    # (ambienteMinimo) — uma variável qualquer do servidor, como a antiga
    # BRUTO_PYTHON_FALHA, NÃO chega mais ao processo do download. É o mesmo
    # isolamento que a r5 prova; o dublê obedece a ele.
    cat > "$UV_TOOL_DIR/mlx-whisper/bin/python" <<EOF
#!/bin/sh
printf '%s\\n' "\\$*" >> "${registroPython}"
if [ -f "${raiz}/python-falha" ]; then echo "download do modelo falhou" >&2; exit 1; fi
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

/** Apaga as marcas de "modelo baixado" ($BRUTO_FERRAMENTAS/whisper-modelo-*). */
function limparMarcasDeModelo(): void {
  for (const nome of fs.readdirSync(ferramentas)) {
    if (nome.startsWith("whisper-modelo-")) {
      fs.rmSync(path.join(ferramentas, nome), { force: true });
    }
  }
}

beforeEach(() => {
  fs.rmSync(registroUv, { force: true });
  fs.rmSync(registroPython, { force: true });
  fs.rmSync(uvToolDir, { recursive: true, force: true });
  fs.rmSync(path.join(raiz, "python-falha"), { force: true });
  limparMarcasDeModelo();
  delete process.env.BRUTO_UV_FALHA;
  delete process.env.BRUTO_WHISPER_MODEL;
});

describe("GET /api/ferramentas/whisper — estado", () => {
  test("nada instalado: instalado=false E venvInstalado=false em modo pacote", async () => {
    const res = await GET();
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), {
      suportado: true,
      instalado: false,
      venvInstalado: false,
    });
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

    // O download antecipado: o Python do próprio venv recebe o código de
    // produção COMPLETO — o import da API real (r3/P1: `load_model` vive em
    // mlx_whisper.load_models, e `mlx_whisper.load_model` NÃO existe) e o
    // repositório RESOLVIDO do padrão novo.
    const python = chamadasPython();
    assert.equal(python.length, 1, `esperava 1 chamada ao Python do venv, veio: ${python.join(" | ")}`);
    assert.match(
      python[0],
      /from mlx_whisper\.load_models import load_model; load_model\("mlx-community\/whisper-large-v3-turbo"\)/,
    );

    const estado = await GET();
    assert.deepEqual(await estado.json(), {
      suportado: true,
      instalado: true,
      venvInstalado: true,
    });
  });

  test("segunda chamada com tudo pronto: não roda NADA (nem o uv, nem o Python)", async () => {
    await POST(req("POST"));
    const uvApos = chamadasUv().length;
    const pythonApos = chamadasPython().length;

    const res = await POST(req("POST"));
    assert.equal(res.status, 200);
    assert.equal(chamadasUv().length, uvApos, "o uv não deve rodar de novo (venv já existe)");
    // r3/P2: a marca de "modelo baixado até o fim" pula também o Python —
    // antes, cada pedido re-executava o load_model (idempotente, mas caro
    // à toa) mesmo com o modelo garantido.
    assert.equal(
      chamadasPython().length,
      pythonApos,
      "o download é pulado quando a marca diz pronto",
    );
  });

  test("download do modelo quebra (rede caiu no meio): erro legível, venv de pé — e o botão CONTINUA (P2)", async () => {
    // 1ª tentativa instala o venv mas o Python falha no download do modelo.
    // O gatilho é um arquivo porque o download r5 roda com EXATAMENTE o
    // ambiente da transcrição — variável do servidor não chega ao processo.
    fs.writeFileSync(path.join(raiz, "python-falha"), "1");
    const falha = await POST(req("POST"));
    assert.equal(falha.status, 500);
    const corpo = await falha.json();
    assert.match(corpo.error, /transcrição|Whisper|internet/i);
    fs.rmSync(path.join(raiz, "python-falha"), { force: true });

    // O venv sobrevive, mas prontidão AGORA exige o modelo (r3/P2): sem ele,
    // `instalado` é false e `venvInstalado` é true — é esse par que faz a
    // tela mostrar "Baixar o modelo" em vez de sumir com o botão.
    const estado = await GET();
    assert.deepEqual(await estado.json(), {
      suportado: true,
      instalado: false,
      venvInstalado: true,
    });

    const retry = await POST(req("POST"));
    assert.equal(retry.status, 200);
    assert.equal(chamadasUv().length, 1, "o retry não repete o uv tool install");

    const depois = await GET();
    assert.deepEqual(await depois.json(), {
      suportado: true,
      instalado: true,
      venvInstalado: true,
    });
  });

  test("trocar BRUTO_WHISPER_MODEL invalida a prontidão: o botão volta e baixa SÓ o outro modelo", async () => {
    await POST(req("POST")); // turbo (o padrão) fica pronto
    const pronto = await GET();
    assert.equal(((await pronto.json()) as { instalado: boolean }).instalado, true);

    process.env.BRUTO_WHISPER_MODEL = "base";
    try {
      // A marca leva o nome do repositório: modelo diferente = não pronto.
      const estado = await GET();
      assert.deepEqual(await estado.json(), {
        suportado: true,
        instalado: false,
        venvInstalado: true,
      });

      const res = await POST(req("POST"));
      assert.equal(res.status, 200);
      assert.equal(chamadasUv().length, 1, "o venv já existe; só o modelo novo desce");
      const ultima = chamadasPython().at(-1) ?? "";
      assert.match(ultima, /mlx-community\/whisper-base-mlx/);

      const depois = await GET();
      assert.deepEqual(await depois.json(), {
        suportado: true,
        instalado: true,
        venvInstalado: true,
      });
    } finally {
      delete process.env.BRUTO_WHISPER_MODEL;
    }
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
    assert.equal(corpoEstado.venvInstalado, false);
  });
});
