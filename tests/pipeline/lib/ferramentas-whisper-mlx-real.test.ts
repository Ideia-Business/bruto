/**
 * P1 (r3): o download do modelo Whisper é provado contra o pacote REAL do
 * mlx-whisper, quando a máquina tem um Python com ele — não só contra dublês.
 *
 * O bug que motivou: a produção gerava
 * `import mlx_whisper; mlx_whisper.load_model(<repo>)` — API que NÃO EXISTE
 * no pacote instalado (`hasattr(mlx_whisper, "load_model")` dá False no venv
 * real; a API é `from mlx_whisper.load_models import load_model`). O teste
 * com dublê não pegava porque o Python dublê só registra argumentos.
 *
 * A prova: gerar o código com a MESMA função da produção
 * (`codigoPythonBaixarModelo` — função única para os dois lados), trocar a
 * CHAMADA `load_model(<repo>)` por `callable(load_model)` — mesmo import,
 * zero download — e rodar no Python que tem o pacote. Máquina sem
 * mlx_whisper em nenhum candidato: o teste PULA com aviso explícito (a prova
 * exige o pacote real; a ausência dele não é falha da máquina).
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pythonDaFerramentaUv } from "@/pipeline/lib/binario";
import { codigoPythonBaixarModelo } from "@/pipeline/lib/ferramentas";
import { modeloWhisper, repositorioMlx } from "@/pipeline/lib/modelo-whisper";

/** Pergunta ao Python se mlx_whisper está instalado (find_spec: sem import). */
const SONDA_MLX =
  "import importlib.util, sys; " +
  "sys.exit(0 if importlib.util.find_spec('mlx_whisper') else 1)";

/**
 * Pythons candidatos, na ordem: o venv da ferramenta resolvendo pelo
 * ambiente REAL da máquina (`pythonDaFerramentaUv` honra `UV_TOOL_DIR`/XDG)
 * e, se ele não existir, o default do uv (`~/.local/share/uv/tools`) — que
 * é onde o venv da orquestradora está.
 */
function pythonsCandidatos(): string[] {
  const candidatos: Array<string | null> = [
    pythonDaFerramentaUv("mlx-whisper"),
    path.join(os.homedir(), ".local", "share", "uv", "tools", "mlx-whisper", "bin", "python"),
  ];
  if (process.platform === "win32" && process.env.APPDATA) {
    candidatos.push(
      path.join(process.env.APPDATA, "uv", "data", "tools", "mlx-whisper", "Scripts", "python.exe"),
    );
  }
  return [...new Set(candidatos.filter((c): c is string => c !== null))].filter((c) => {
    try {
      fs.accessSync(c, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

/** O primeiro candidato com mlx_whisper instalado, ou null se nenhum tiver. */
function acharPythonComMlx(): string | null {
  for (const python of pythonsCandidatos()) {
    try {
      execFileSync(python, ["-c", SONDA_MLX], { timeout: 60_000, stdio: "pipe" });
      return python;
    } catch {
      // sem mlx_whisper (ou interpretador quebrado): tenta o próximo
    }
  }
  return null;
}

describe("P1 — o código de produção roda no pacote REAL do mlx_whisper", () => {
  test("o import de load_model existe de verdade (executado, sem baixar nada)", (t) => {
    const python = acharPythonComMlx();
    if (!python) {
      t.skip(
        "nenhum Python com mlx_whisper instalado nesta máquina — " +
          "prova contra o pacote real pulada (rodar num Mac com o venv " +
          "~/.local/share/uv/tools/mlx-whisper para valer)",
      );
      return;
    }

    const codigo = codigoPythonBaixarModelo(repositorioMlx(modeloWhisper()));

    // Trava anti-regressão à API inexistente: `mlx_whisper.load_model` como
    // ATRIBUTO nunca mais (o \b não casa com `load_models`, o módulo certo).
    assert.doesNotMatch(
      codigo,
      /mlx_whisper\.load_model\b/,
      "regressão à API inexistente `mlx_whisper.load_model` (hasattr = False no pacote real)",
    );

    // A prova troca a CHAMADA final por uma checagem de símbolo. Se a forma
    // do código de produção mudar (`; load_model(<repo>)` no fim), a troca
    // não bate e o assert falha — a prova nunca passa em branco.
    const prova = codigo.replace(
      /; load_model\(.*\)$/,
      "; import sys; sys.exit(0 if callable(load_model) else 1)",
    );
    assert.notEqual(
      prova,
      codigo,
      "o código de produção não está na forma '…; load_model(<repo>)' — atualize esta prova junto com a produção",
    );

    // Executa no pacote REAL: módulo errado (ImportError) ou símbolo que não
    // é callable → exit != 0 → falha com o stderr verdadeiro do Python.
    try {
      execFileSync(python, ["-c", prova], { timeout: 120_000, stdio: "pipe" });
    } catch (err) {
      const stderr =
        err instanceof Error && "stderr" in err ? String(err.stderr) : String(err);
      assert.fail(`o código de produção não roda no mlx_whisper real (${python}): ${stderr}`);
    }
  });
});
