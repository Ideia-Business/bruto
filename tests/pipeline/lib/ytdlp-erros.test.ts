/**
 * Muro de login do Instagram: classificação e retentativa.
 * Origem: Reel real que caiu em "erro inesperado" em 25/09/2026.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { detectYtdlpError, comRetentativaDeLogin } from "@/pipeline/lib/ytdlp";
import { PipelineError } from "@/pipeline/types";

const STDERR_INSTAGRAM =
  "ERROR: [Instagram] Ddsb_AiMuM8: The webpage request was redirected to the login page. You have exceeded the rate-limit for accessing posts anonymously. Use --cookies-from-browser or --cookies for the authentication.";

describe("detectYtdlpError", () => {
  test("muro de login do Instagram vira LOGIN_REQUIRED, não RATE_LIMIT nem UNKNOWN", () => {
    assert.equal(detectYtdlpError(STDERR_INSTAGRAM), "LOGIN_REQUIRED");
  });
  test("vídeo privado sugere --cookies mas não é muro passageiro", () => {
    assert.equal(
      detectYtdlpError("ERROR: [youtube] abc: Private video. Use --cookies-from-browser or --cookies for the authentication."),
      "UNKNOWN",
    );
  });
  test("429 continua RATE_LIMIT", () => {
    assert.equal(detectYtdlpError("ERROR: HTTP Error 429: Too Many Requests"), "RATE_LIMIT");
  });
  test("verificação anti-robô do YouTube continua BOT_CHECK", () => {
    assert.equal(detectYtdlpError("ERROR: Sign in to confirm you're not a bot"), "BOT_CHECK");
  });
  test("erro sem padrão conhecido continua UNKNOWN", () => {
    assert.equal(detectYtdlpError("ERROR: algo novo"), "UNKNOWN");
  });
});

describe("comRetentativaDeLogin", () => {
  const semEspera = async () => {};

  test("passa na segunda tentativa depois de um muro de login", async () => {
    let chamadas = 0;
    const r = await comRetentativaDeLogin(async () => {
      chamadas++;
      if (chamadas === 1) throw new PipelineError("LOGIN_REQUIRED", "muro");
      return "ok";
    }, [10, 20], semEspera);
    assert.equal(r, "ok");
    assert.equal(chamadas, 2);
  });

  test("desiste depois de esgotar as esperas e devolve o próprio erro", async () => {
    let chamadas = 0;
    await assert.rejects(
      comRetentativaDeLogin(async () => {
        chamadas++;
        throw new PipelineError("LOGIN_REQUIRED", "muro");
      }, [10, 20], semEspera),
      (e: unknown) => e instanceof PipelineError && e.code === "LOGIN_REQUIRED",
    );
    assert.equal(chamadas, 3);
  });

  test("não repete outros erros (o 429 de legenda cai para o Whisper)", async () => {
    let chamadas = 0;
    await assert.rejects(
      comRetentativaDeLogin(async () => {
        chamadas++;
        throw new PipelineError("RATE_LIMIT", "429");
      }, [10, 20], semEspera),
    );
    assert.equal(chamadas, 1);
  });

  test("respeita as esperas na ordem", async () => {
    const esperas: number[] = [];
    let chamadas = 0;
    await comRetentativaDeLogin(async () => {
      chamadas++;
      if (chamadas < 3) throw new PipelineError("LOGIN_REQUIRED", "muro");
      return 1;
    }, [4000, 12000], async (ms) => { esperas.push(ms); });
    assert.deepEqual(esperas, [4000, 12000]);
  });
});
