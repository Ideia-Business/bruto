/**
 * Testes de `transcribe.ts` — só a parte testável sem binário externo (regra
 * do território desta suíte: nada de yt-dlp/ffmpeg/whisper de verdade).
 *
 * IMPORTANTE sobre ordem: `detectarBackend`/`temMlx` memoizam o resultado da
 * sonda Python em variáveis de módulo (`cacheMlx`, `cachePythonMlx`),
 * preenchidas na PRIMEIRA chamada. Por isso o teste que manipula `PATH`
 * (e, desde a resolução do Python isolado do `uv tool install`, também
 * `UV_TOOL_DIR`) para simular "nada instalado" roda ANTES de qualquer outro
 * teste que chame essas funções — senão o cache já estaria preenchido com o
 * resultado do ambiente real da máquina que roda o CI, e o teste não
 * provaria nada.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ambienteMinimo,
  detectarBackend,
  modeloWhisperCpp,
  nomeModeloGgml,
  transcricaoDoctor,
} from "@/pipeline/lib/transcribe";

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
    //
    // UV_TOOL_DIR aponta para o MESMO diretório inexistente: sem isso, a
    // resolução do Python do `uv tool install mlx-whisper` (`pythonParaMlx`)
    // consultaria o `$HOME` REAL de quem roda o teste — e numa máquina onde a
    // ferramenta estiver instalada de verdade, este teste deixaria de provar
    // "nada instalado" e passaria a medir o ambiente real, silenciosamente.
    const dirInexistente = path.join(os.tmpdir(), "bruto-teste-path-vazio-" + Date.now());
    const uvToolDirOriginal = process.env.UV_TOOL_DIR;
    process.env.UV_TOOL_DIR = dirInexistente;
    try {
      const resultado = await comPath(dirInexistente, () => detectarBackend());
      assert.equal(resultado, null);
    } finally {
      if (uvToolDirOriginal === undefined) delete process.env.UV_TOOL_DIR;
      else process.env.UV_TOOL_DIR = uvToolDirOriginal;
    }
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

describe("modeloWhisperCpp — fallback do padrão large-v3-turbo (troca de modelo, 12/11/2026)", () => {
  /**
   * Roda `fn` com um HOME temporário contendo `~/.cache/whisper/<arquivo>`
   * para cada nome passado (arquivos com conteúdo, como um ggml real).
   *
   * O HOME é o que decide: os caminhos fixos do whisper.cpp procuram o
   * modelo em `~/.cache/whisper` (o Homebrew/local das máquinas de CI nunca
   * existe, então o teste não depende do que a estação tem instalado).
   */
  async function comHomeGgml<T>(arquivos: string[], fn: () => Promise<T>): Promise<T> {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "bruto-teste-home-ggml-"));
    const dir = path.join(home, ".cache", "whisper");
    fs.mkdirSync(dir, { recursive: true });
    for (const nome of arquivos) {
      fs.writeFileSync(path.join(dir, nome), `ggml-ficticio-${nome}`);
    }
    const homeOriginal = process.env.HOME;
    const uvToolDirOriginal = process.env.UV_TOOL_DIR;
    process.env.HOME = home;
    process.env.UV_TOOL_DIR = path.join(home, "uv-tools-inexistente");
    try {
      return await fn();
    } finally {
      if (homeOriginal === undefined) delete process.env.HOME;
      else process.env.HOME = homeOriginal;
      if (uvToolDirOriginal === undefined) delete process.env.UV_TOOL_DIR;
      else process.env.UV_TOOL_DIR = uvToolDirOriginal;
      fs.rmSync(home, { recursive: true, force: true });
    }
  }

  const salvaModelo = process.env.BRUTO_WHISPER_MODEL;

  test("sem BRUTO_WHISPER_MODEL e sem ggml-large-v3-turbo.bin, usa o melhor ggml presente (base)", async () => {
    delete process.env.BRUTO_WHISPER_MODEL;
    try {
      await comHomeGgml(["ggml-base.bin"], async () => {
        // Quem hoje só tem ggml-base.bin NÃO pode passar a falhar com a troca
        // do padrão para large-v3-turbo — o app cai para o base e segue.
        assert.equal(
          modeloWhisperCpp(),
          path.join(os.homedir(), ".cache", "whisper", "ggml-base.bin"),
        );
      });
    } finally {
      if (salvaModelo !== undefined) process.env.BRUTO_WHISPER_MODEL = salvaModelo;
    }
  });

  test("a ordem de preferência é large-v3-turbo > large-v3 > medium > small > base > tiny", async () => {
    delete process.env.BRUTO_WHISPER_MODEL;
    try {
      await comHomeGgml(["ggml-tiny.bin", "ggml-small.bin", "ggml-medium.bin"], async () => {
        assert.ok(modeloWhisperCpp()?.endsWith("ggml-medium.bin"));
      });
      await comHomeGgml(["ggml-base.bin", "ggml-large-v3-turbo.bin"], async () => {
        assert.ok(modeloWhisperCpp()?.endsWith("ggml-large-v3-turbo.bin"));
      });
    } finally {
      if (salvaModelo !== undefined) process.env.BRUTO_WHISPER_MODEL = salvaModelo;
    }
  });

  test("com BRUTO_WHISPER_MODEL definido, NÃO cai para outro ggml (o env manda)", async () => {
    process.env.BRUTO_WHISPER_MODEL = "small";
    try {
      await comHomeGgml(["ggml-base.bin"], async () => {
        // Sem fallback quando a pessoa pediu um modelo específico: o erro
        // claro atual é o comportamento contratado.
        assert.equal(modeloWhisperCpp(), null);
      });
      await comHomeGgml(["ggml-base.bin", "ggml-small.bin"], async () => {
        assert.ok(modeloWhisperCpp()?.endsWith("ggml-small.bin"));
      });
    } finally {
      if (salvaModelo === undefined) delete process.env.BRUTO_WHISPER_MODEL;
      else process.env.BRUTO_WHISPER_MODEL = salvaModelo;
    }
  });
});

describe("nomeModeloGgml — extrai o nome curto do caminho do ggml", () => {
  test("ggml-<nome>.bin vira <nome>; caminho arbitrário vira o basename", () => {
    assert.equal(nomeModeloGgml("/home/x/.cache/whisper/ggml-base.bin"), "base");
    assert.equal(nomeModeloGgml("/opt/homebrew/share/whisper-cpp/ggml-large-v3-turbo.bin"), "large-v3-turbo");
    assert.equal(nomeModeloGgml("/home/x/meu-modelo.bin"), "meu-modelo.bin");
  });
});

describe("doctor — o whisper.cpp diz QUAL modelo ggml está em uso", () => {
  test("com fallback para o base, a linha do whisper-cpp nomeia o ggml", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "bruto-teste-doctor-"));
    const dirWhisper = path.join(home, ".cache", "whisper");
    fs.mkdirSync(dirWhisper, { recursive: true });
    fs.writeFileSync(path.join(dirWhisper, "ggml-base.bin"), "ggml-ficticio");

    // PATH com ffmpeg + whisper-cli (e NADA de python3/whisper): o backend
    // detectado só pode ser o whisper.cpp, com o ggml do HOME falso.
    const binDir = path.join(home, "bin");
    fs.mkdirSync(binDir, { recursive: true });
    for (const nome of ["ffmpeg", "whisper-cli"]) {
      fs.writeFileSync(path.join(binDir, nome), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    }

    const salvas: Record<string, string | undefined> = {
      HOME: process.env.HOME,
      PATH: process.env.PATH,
      UV_TOOL_DIR: process.env.UV_TOOL_DIR,
      BRUTO_WHISPER_MODEL: process.env.BRUTO_WHISPER_MODEL,
    };
    process.env.HOME = home;
    process.env.PATH = binDir;
    process.env.UV_TOOL_DIR = path.join(home, "uv-tools-inexistente");
    delete process.env.BRUTO_WHISPER_MODEL;
    try {
      assert.equal(await detectarBackend(), "whisper-cpp");
      const { ok, linhas } = await transcricaoDoctor();
      assert.equal(ok, true);
      const linhaCpp = linhas.find((l) => l.includes("whisper-cli"));
      assert.ok(linhaCpp, `linha do whisper-cli sumiu do doctor: ${linhas.join(" | ")}`);
      assert.match(linhaCpp, /ggml base/);
    } finally {
      for (const [chave, valor] of Object.entries(salvas)) {
        if (valor === undefined) delete process.env[chave];
        else process.env[chave] = valor;
      }
      fs.rmSync(home, { recursive: true, force: true });
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

  test("r4+r5: as variáveis de CACHE do HF entram, INCLUSIVE a antiga HUGGINGFACE_HUB_CACHE — HF_TOKEN NÃO", () => {
    // A invariante r4/P2: quem instala e quem transcreve têm de ver as MESMAS
    // variáveis de cache do Hugging Face — senão o download grava a marca de
    // "pronto" num cache e o 1º vídeo baixa ~1,6 GB de novo noutro. A r5
    // acrescentou a `HUGGINGFACE_HUB_CACHE` (a variável ANTIGA que o
    // huggingface_hub ainda honra) à mesma lista. São CAMINHOS, não
    // credenciais: `HF_TOKEN` segue fora (o propósito da allowlist — nenhuma
    // credencial chega ao stderr persistido — não muda).
    const original = {
      HF_HOME: process.env.HF_HOME,
      HF_HUB_CACHE: process.env.HF_HUB_CACHE,
      HUGGINGFACE_HUB_CACHE: process.env.HUGGINGFACE_HUB_CACHE,
      XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,
      HF_TOKEN: process.env.HF_TOKEN,
    };
    process.env.HF_HOME = "/bruto-teste/hf";
    process.env.HF_HUB_CACHE = "/bruto-teste/hf/hub";
    process.env.HUGGINGFACE_HUB_CACHE = "/bruto-teste/hhcache";
    process.env.XDG_CACHE_HOME = "/bruto-teste/xdg";
    process.env.HF_TOKEN = "hf-segredo-do-teste";
    try {
      const env = ambienteMinimo();
      assert.equal(env.HF_HOME, "/bruto-teste/hf");
      assert.equal(env.HF_HUB_CACHE, "/bruto-teste/hf/hub");
      assert.equal(env.HUGGINGFACE_HUB_CACHE, "/bruto-teste/hhcache");
      assert.equal(env.XDG_CACHE_HOME, "/bruto-teste/xdg");
      assert.equal(env.HF_TOKEN, undefined, "credencial do HF jamais entra no ambiente mínimo");
    } finally {
      for (const [chave, valor] of Object.entries(original)) {
        if (valor === undefined) delete process.env[chave];
        else process.env[chave] = valor;
      }
    }
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
