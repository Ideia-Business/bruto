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
import { candidatosDoNome, dividirPath, localizarBinario } from "@/pipeline/lib/binario";

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
