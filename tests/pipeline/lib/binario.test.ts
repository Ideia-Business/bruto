/**
 * Testes de `binario.ts` — a busca de executável no PATH.
 *
 * Por que existe: `spawn("ffmpeg" | "whisper", …)` sem shell nunca encontrava
 * nada no Windows, porque o que está no disco é `ffmpeg.exe`/`whisper.exe`
 * (ou um shim `.cmd`), nunca o nome nu — e o código antigo só testava o nome
 * nu. `localizarBinario` corrige isso testando cada extensão de PATHEXT no
 * win32; estes testes provam a extensão certa e o controle negativo, sem
 * depender do PATH real da máquina que roda o CI (que é sempre POSIX aqui).
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { candidatosDoNome, dividirPath, localizarBinario, pythonDaFerramentaUv } from "@/pipeline/lib/binario";

function dirTemp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "bruto-teste-binario-"));
}

describe("candidatosDoNome", () => {
  test("fora do win32, só o nome nu", () => {
    assert.deepEqual(candidatosDoNome("ffmpeg", "linux", ".EXE;.CMD"), ["ffmpeg"]);
    assert.deepEqual(candidatosDoNome("ffmpeg", "darwin", ".EXE;.CMD"), ["ffmpeg"]);
  });

  test("no win32, uma variação por extensão de PATHEXT, seguida do nome nu", () => {
    assert.deepEqual(candidatosDoNome("ffmpeg", "win32", ".EXE;.CMD;.BAT"), [
      "ffmpeg.EXE",
      "ffmpeg.CMD",
      "ffmpeg.BAT",
      "ffmpeg",
    ]);
  });

  test("no win32, nome que já traz extensão não ganha PATHEXT de novo", () => {
    assert.deepEqual(candidatosDoNome("ffmpeg.exe", "win32", ".EXE;.CMD"), ["ffmpeg.exe"]);
  });
});

describe("dividirPath", () => {
  test("posix separa por ':'", () => {
    assert.deepEqual(dividirPath("/usr/bin:/usr/local/bin", "linux"), [
      "/usr/bin",
      "/usr/local/bin",
    ]);
  });

  test("win32 separa por ';', independente da plataforma real que roda o teste", () => {
    assert.deepEqual(dividirPath("C:\\Windows;C:\\Windows\\System32", "win32"), [
      "C:\\Windows",
      "C:\\Windows\\System32",
    ]);
  });
});

describe("localizarBinario — controle positivo em POSIX (comportamento inalterado)", () => {
  test("acha ffmpeg pelo nome nu quando o arquivo existe e é executável", () => {
    const dir = dirTemp();
    const arquivo = path.join(dir, "ffmpeg");
    fs.writeFileSync(arquivo, "#!/bin/sh\n");
    fs.chmodSync(arquivo, 0o755);
    try {
      const achado = localizarBinario("ffmpeg", { diretorios: [dir], plataforma: "linux" });
      assert.equal(achado, arquivo);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("não acha o que não está lá (controle negativo)", () => {
    const dir = dirTemp();
    try {
      const achado = localizarBinario("ffmpeg", { diretorios: [dir], plataforma: "linux" });
      assert.equal(achado, null);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("localizarBinario — win32, simulado", () => {
  test("acha ffmpeg.exe via PATHEXT quando o nome nu não existe no disco", () => {
    const dir = dirTemp();
    const arquivo = path.join(dir, "ffmpeg.EXE");
    fs.writeFileSync(arquivo, "conteudo-ficticio");
    fs.chmodSync(arquivo, 0o755);
    try {
      const achado = localizarBinario("ffmpeg", {
        diretorios: [dir],
        plataforma: "win32",
        pathExt: ".EXE;.CMD;.BAT;.COM",
      });
      assert.equal(achado, arquivo);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("acha um shim .CMD quando é a única variação presente", () => {
    const dir = dirTemp();
    const arquivo = path.join(dir, "whisper.CMD");
    fs.writeFileSync(arquivo, "@echo off\n");
    fs.chmodSync(arquivo, 0o755);
    try {
      const achado = localizarBinario("whisper", {
        diretorios: [dir],
        plataforma: "win32",
        pathExt: ".EXE;.CMD;.BAT;.COM",
      });
      assert.equal(achado, arquivo);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("não acha quando nenhuma variação existe (controle negativo)", () => {
    const dir = dirTemp();
    try {
      const achado = localizarBinario("ffmpeg", {
        diretorios: [dir],
        plataforma: "win32",
        pathExt: ".EXE;.CMD;.BAT;.COM",
      });
      assert.equal(achado, null);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

/** Cria `<base>/<ferramenta>/bin/python` (POSIX) ou `\Scripts\python.exe` (win32). */
function criarVenvFalso(base: string, ferramenta: string, plataforma: "win32" | "posix"): string {
  const relativo =
    plataforma === "win32" ? [ferramenta, "Scripts", "python.exe"] : [ferramenta, "bin", "python"];
  const caminho = path.join(base, ...relativo);
  fs.mkdirSync(path.dirname(caminho), { recursive: true });
  fs.writeFileSync(caminho, "conteudo-ficticio");
  fs.chmodSync(caminho, 0o755);
  return caminho;
}

describe("pythonDaFerramentaUv — Python isolado de `uv tool install`", () => {
  test("POSIX: usa $HOME/.local/share/uv/tools/<ferramenta>/bin/python quando UV_TOOL_DIR não está setada", () => {
    const home = dirTemp();
    const esperado = criarVenvFalso(path.join(home, ".local", "share", "uv", "tools"), "mlx-whisper", "posix");
    try {
      const achado = pythonDaFerramentaUv("mlx-whisper", {
        plataforma: "linux",
        env: { HOME: home },
      });
      assert.equal(achado, esperado);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  test("POSIX: $XDG_DATA_HOME/uv/tools vence o padrão de $HOME", () => {
    const home = dirTemp();
    const xdg = dirTemp();
    criarVenvFalso(path.join(home, ".local", "share", "uv", "tools"), "mlx-whisper", "posix");
    const esperado = criarVenvFalso(path.join(xdg, "uv", "tools"), "mlx-whisper", "posix");
    try {
      const achado = pythonDaFerramentaUv("mlx-whisper", {
        plataforma: "darwin",
        env: { HOME: home, XDG_DATA_HOME: xdg },
      });
      assert.equal(achado, esperado);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
      fs.rmSync(xdg, { recursive: true, force: true });
    }
  });

  test("win32: usa %APPDATA%\\uv\\data\\tools\\<ferramenta>\\Scripts\\python.exe quando UV_TOOL_DIR não está setada", () => {
    const appdata = dirTemp();
    const esperado = criarVenvFalso(path.join(appdata, "uv", "data", "tools"), "mlx-whisper", "win32");
    try {
      const achado = pythonDaFerramentaUv("mlx-whisper", {
        plataforma: "win32",
        env: { APPDATA: appdata },
      });
      assert.equal(achado, esperado);
    } finally {
      fs.rmSync(appdata, { recursive: true, force: true });
    }
  });

  test("UV_TOOL_DIR, quando setada, tem prioridade sobre o default da plataforma", () => {
    const viaEnvVar = dirTemp();
    const viaDefault = dirTemp();
    const esperado = criarVenvFalso(viaEnvVar, "mlx-whisper", "posix");
    // Um venv também existe no caminho-default — se a precedência estivesse
    // errada (default vencendo a env var), o teste acharia este aqui.
    criarVenvFalso(path.join(viaDefault, ".local", "share", "uv", "tools"), "mlx-whisper", "posix");
    try {
      const achado = pythonDaFerramentaUv("mlx-whisper", {
        plataforma: "linux",
        env: { UV_TOOL_DIR: viaEnvVar, HOME: viaDefault },
      });
      assert.equal(achado, esperado);
    } finally {
      fs.rmSync(viaEnvVar, { recursive: true, force: true });
      fs.rmSync(viaDefault, { recursive: true, force: true });
    }
  });

  test("controle negativo: devolve null quando a ferramenta não está instalada por esse caminho", () => {
    const home = dirTemp();
    try {
      const achado = pythonDaFerramentaUv("mlx-whisper", { plataforma: "linux", env: { HOME: home } });
      assert.equal(achado, null);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  test("controle negativo: devolve null quando nem HOME (POSIX) nem APPDATA (win32) estão presentes", () => {
    assert.equal(pythonDaFerramentaUv("mlx-whisper", { plataforma: "linux", env: {} }), null);
    assert.equal(pythonDaFerramentaUv("mlx-whisper", { plataforma: "win32", env: {} }), null);
  });
});
