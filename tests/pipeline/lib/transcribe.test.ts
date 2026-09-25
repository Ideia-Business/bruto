/**
 * Testes de `transcribe.ts` — só a parte testável sem binário externo (regra
 * do território desta suíte: nada de yt-dlp/ffmpeg/whisper de verdade).
 *
 * IMPORTANTE sobre ordem: `detectarBackend`/`temMlx` memoizam o resultado da
 * sonda Python em uma variável de módulo (`cacheMlx`), preenchida na PRIMEIRA
 * chamada. Por isso o teste que manipula `PATH` para simular "nada instalado"
 * roda ANTES de qualquer outro teste que chame essas funções — senão o cache
 * já estaria preenchido com o resultado do ambiente real da máquina que roda
 * o CI, e o teste não provaria nada.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ambienteMinimo, detectarBackend, modeloWhisperCpp } from "@/pipeline/lib/transcribe";

/**
 * Troca `process.platform` temporariamente — a única forma de exercitar o
 * ramo win32 de `ambienteMinimo()` a partir de um CI que só roda em POSIX,
 * já que a função lê a plataforma real, sem parâmetro injetável.
 */
function comPlataforma<T>(plataforma: NodeJS.Platform, fn: () => T): T {
  const original = process.platform;
  Object.defineProperty(process, "platform", { value: plataforma });
  try {
    return fn();
  } finally {
    Object.defineProperty(process, "platform", { value: original });
  }
}

/**
 * Executa `fn` com PATH temporariamente trocado, restaurando ao final.
 *
 * `fn` é `async` (como `detectarBackend`), então o `finally` PRECISA aguardar
 * a promise antes de restaurar — um `finally` síncrono devolveria o PATH
 * original antes de os `await noPath(...)` internos da função rodarem, e o
 * teste passaria a medir o ambiente real da máquina em vez do PATH fictício.
 * (Foi exatamente esse bug que a 1ª versão deste helper tinha: o teste abaixo
 * falhava, no ambiente de dev, com "whisper-cpp" em vez de `null`.)
 */
async function comPath<T>(novoPath: string, fn: () => Promise<T>): Promise<T> {
  const original = process.env.PATH;
  process.env.PATH = novoPath;
  try {
    return await fn();
  } finally {
    process.env.PATH = original;
  }
}

describe("detectarBackend — sem nenhum backend instalado", () => {
  test("devolve null quando o PATH não aponta para diretório nenhum", async () => {
    // Um diretório de PATH vazio (que não existe no disco) garante que
    // `noPath()` não encontre `python3`, `whisper`, `whisper-cli` nem
    // `whisper-cpp` — reproduz uma máquina sem nenhum transcritor instalado.
    const dirInexistente = path.join(os.tmpdir(), "bruto-teste-path-vazio-" + Date.now());
    const resultado = await comPath(dirInexistente, () => detectarBackend());
    assert.equal(resultado, null);
  });
});

describe("modeloWhisperCpp — respeita BRUTO_WHISPER_CPP_MODEL", () => {
  test("usa o caminho da env var quando o arquivo existe e não está vazio", () => {
    const arquivoTemp = path.join(os.tmpdir(), `bruto-teste-modelo-${Date.now()}.bin`);
    fs.writeFileSync(arquivoTemp, "conteudo-ficticio-do-modelo-ggml");

    const original = process.env.BRUTO_WHISPER_CPP_MODEL;
    process.env.BRUTO_WHISPER_CPP_MODEL = arquivoTemp;
    try {
      assert.equal(modeloWhisperCpp(), arquivoTemp);
    } finally {
      if (original === undefined) delete process.env.BRUTO_WHISPER_CPP_MODEL;
      else process.env.BRUTO_WHISPER_CPP_MODEL = original;
      fs.rmSync(arquivoTemp, { force: true });
    }
  });

  test("ignora a env var quando ela aponta para arquivo vazio (0 bytes)", () => {
    // Um arquivo de 0 bytes não é um modelo utilizável — a função trata isso
    // como "candidato ausente" e segue para os próximos candidatos fixos.
    const arquivoVazio = path.join(os.tmpdir(), `bruto-teste-modelo-vazio-${Date.now()}.bin`);
    fs.writeFileSync(arquivoVazio, "");

    const original = process.env.BRUTO_WHISPER_CPP_MODEL;
    process.env.BRUTO_WHISPER_CPP_MODEL = arquivoVazio;
    try {
      assert.notEqual(modeloWhisperCpp(), arquivoVazio);
    } finally {
      if (original === undefined) delete process.env.BRUTO_WHISPER_CPP_MODEL;
      else process.env.BRUTO_WHISPER_CPP_MODEL = original;
      fs.rmSync(arquivoVazio, { force: true });
    }
  });

  test("devolve null quando nada — nem a env var, nem os caminhos fixos — existe", () => {
    const original = process.env.BRUTO_WHISPER_CPP_MODEL;
    delete process.env.BRUTO_WHISPER_CPP_MODEL;
    try {
      // Só falha se, por acaso, a máquina que roda o teste tiver de verdade um
      // modelo ggml instalado num dos caminhos fixos (Homebrew/local). No CI
      // (runner limpo) isso nunca acontece.
      const resultado = modeloWhisperCpp();
      const candidatosFixosExistem =
        fs.existsSync(path.join(os.homedir(), ".cache", "whisper")) ||
        fs.existsSync("/opt/homebrew/share/whisper-cpp") ||
        fs.existsSync("/usr/local/share/whisper-cpp");
      if (!candidatosFixosExistem) assert.equal(resultado, null);
    } finally {
      if (original !== undefined) process.env.BRUTO_WHISPER_CPP_MODEL = original;
    }
  });
});

describe("ambienteMinimo — allowlist por plataforma", () => {
  test("fora do win32, não inclui variáveis exclusivas do Windows", () => {
    const env = comPlataforma("linux", () => ambienteMinimo());
    assert.equal(env.SYSTEMROOT, undefined);
    assert.equal(env.USERPROFILE, undefined);
    assert.equal(env.PATHEXT, undefined);
  });

  test("no win32, inclui as variáveis que os backends dependem (Python precisa de SYSTEMROOT)", () => {
    const original = {
      USERPROFILE: process.env.USERPROFILE,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      USERNAME: process.env.USERNAME,
      APPDATA: process.env.APPDATA,
      LOCALAPPDATA: process.env.LOCALAPPDATA,
      SYSTEMROOT: process.env.SYSTEMROOT,
      PATHEXT: process.env.PATHEXT,
    };
    process.env.USERPROFILE = "C:\\Users\\teste";
    process.env.TEMP = "C:\\Users\\teste\\AppData\\Local\\Temp";
    process.env.TMP = "C:\\Users\\teste\\AppData\\Local\\Temp";
    process.env.USERNAME = "teste";
    process.env.APPDATA = "C:\\Users\\teste\\AppData\\Roaming";
    process.env.LOCALAPPDATA = "C:\\Users\\teste\\AppData\\Local";
    process.env.SYSTEMROOT = "C:\\Windows";
    process.env.PATHEXT = ".EXE;.CMD;.BAT;.COM";
    try {
      const env = comPlataforma("win32", () => ambienteMinimo());
      assert.equal(env.USERPROFILE, "C:\\Users\\teste");
      assert.equal(env.SYSTEMROOT, "C:\\Windows");
      assert.equal(env.PATHEXT, ".EXE;.CMD;.BAT;.COM");
    } finally {
      for (const [chave, valor] of Object.entries(original)) {
        if (valor === undefined) delete process.env[chave];
        else process.env[chave] = valor;
      }
    }
  });
});
