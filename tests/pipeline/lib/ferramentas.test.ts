/**
 * ferramentas.ts — o módulo único de resolução das ferramentas externas.
 *
 * INVARIANTE F2 (controle): sem `BRUTO_EMPACOTADO`, `caminhoDe` devolve o
 * nome nu (resolução pelo PATH), exatamente como o código sempre fez — o
 * modo clone não pode mudar.
 *
 * INVARIANTE F1: com `BRUTO_EMPACOTADO=1`, as ferramentas do pacote resolvem
 * por CAMINHO ABSOLUTO a partir das variáveis do contrato
 * (`BRUTO_FFMPEG`/`BRUTO_FFPROBE`/`BRUTO_UV`, e `$BRUTO_FERRAMENTAS/bin` para
 * o que o `uv` instala) — nunca pelo PATH.
 *
 * Estes testes só leem/escrevem variáveis de ambiente do próprio processo
 * (cada arquivo de teste roda em processo separado no `node --test`).
 */
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { caminhoDe, modoPacote } from "@/pipeline/lib/ferramentas";

const VARIAVEIS = [
  "BRUTO_EMPACOTADO",
  "BRUTO_FFMPEG",
  "BRUTO_FFPROBE",
  "BRUTO_UV",
  "BRUTO_FERRAMENTAS",
] as const;

let salvas: Record<string, string | undefined>;

beforeEach(() => {
  salvas = {};
  for (const v of VARIAVEIS) {
    salvas[v] = process.env[v];
    delete process.env[v];
  }
});

afterEach(() => {
  for (const v of VARIAVEIS) {
    if (salvas[v] === undefined) delete process.env[v];
    else process.env[v] = salvas[v]!;
  }
});

describe("modoPacote", () => {
  test("sem BRUTO_EMPACOTADO: false", () => {
    assert.equal(modoPacote(), false);
  });

  test("BRUTO_EMPACOTADO=1: true", () => {
    process.env.BRUTO_EMPACOTADO = "1";
    assert.equal(modoPacote(), true);
  });

  test("BRUTO_EMPACOTADO com outro valor: false (só '1' liga)", () => {
    process.env.BRUTO_EMPACOTADO = "0";
    assert.equal(modoPacote(), false);
  });
});

describe("caminhoDe — modo clone (controle da F2)", () => {
  test("devolve o nome nu para todas as ferramentas (resolução pelo PATH)", () => {
    assert.equal(caminhoDe("yt-dlp"), "yt-dlp");
    assert.equal(caminhoDe("ffmpeg"), "ffmpeg");
    assert.equal(caminhoDe("ffprobe"), "ffprobe");
    assert.equal(caminhoDe("uv"), "uv");
    assert.equal(caminhoDe("whisper"), "whisper");
  });
});

describe("caminhoDe — modo pacote (F1)", () => {
  beforeEach(() => {
    process.env.BRUTO_EMPACOTADO = "1";
    process.env.BRUTO_FFMPEG = "/pacote/bin/ffmpeg";
    process.env.BRUTO_FFPROBE = "/pacote/bin/ffprobe";
    process.env.BRUTO_UV = "/pacote/bin/uv";
    process.env.BRUTO_FERRAMENTAS = "/dados/ferramentas";
  });

  test("ffmpeg/ffprobe/uv vêm das variáveis do contrato, absolutos", () => {
    assert.equal(caminhoDe("ffmpeg"), "/pacote/bin/ffmpeg");
    assert.equal(caminhoDe("ffprobe"), "/pacote/bin/ffprobe");
    assert.equal(caminhoDe("uv"), "/pacote/bin/uv");
  });

  test("o que o uv instala (yt-dlp, whisper) resolve em $BRUTO_FERRAMENTAS/bin", () => {
    assert.equal(caminhoDe("yt-dlp"), "/dados/ferramentas/bin/yt-dlp");
    assert.equal(caminhoDe("whisper"), "/dados/ferramentas/bin/whisper");
  });

  test("variável do contrato ausente em modo pacote é erro ALTO, não fallback pro PATH", () => {
    delete process.env.BRUTO_FFMPEG;
    assert.throws(() => caminhoDe("ffmpeg"), /BRUTO_FFMPEG/);
  });

  test("BRUTO_FERRAMENTAS ausente em modo pacote é erro ALTO", () => {
    delete process.env.BRUTO_FERRAMENTAS;
    assert.throws(() => caminhoDe("yt-dlp"), /BRUTO_FERRAMENTAS/);
  });
});
