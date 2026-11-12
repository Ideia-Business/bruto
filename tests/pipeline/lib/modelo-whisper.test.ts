/**
 * `repositorioMlx` (src/pipeline/lib/modelo-whisper.ts) — resolve o nome
 * curto do Whisper (`BRUTO_WHISPER_MODEL`) para o repositório REAL do
 * backend mlx no Hugging Face.
 *
 * REGRESSÃO (demanda 00a39140): o backend mlx montava sempre
 * `mlx-community/whisper-{modelo}-mlx`. Isso serve para tiny/base/small/
 * medium/large-v3, mas NÃO para `large-v3-turbo`, cujo repositório é
 * `mlx-community/whisper-large-v3-turbo` (sem o sufixo `-mlx`) — com esse
 * modelo a transcrição falharia ao baixar um repo inexistente.
 *
 * Os 6 repositórios da tabela foram conferidos na API pública do Hugging
 * Face (`/api/models/mlx-community/<repo>`, HTTP 200) em 12/11/2026.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { modeloWhisper, repositorioMlx } from "@/pipeline/lib/modelo-whisper";

describe("modeloWhisper — o modelo padrão é large-v3-turbo (decisão 12/11/2026)", () => {
  const salva = process.env.BRUTO_WHISPER_MODEL;

  test("sem BRUTO_WHISPER_MODEL, devolve large-v3-turbo (não mais base)", () => {
    delete process.env.BRUTO_WHISPER_MODEL;
    try {
      assert.equal(modeloWhisper(), "large-v3-turbo");
    } finally {
      if (salva !== undefined) process.env.BRUTO_WHISPER_MODEL = salva;
    }
  });

  test("BRUTO_WHISPER_MODEL continua mandando", () => {
    process.env.BRUTO_WHISPER_MODEL = "small";
    try {
      assert.equal(modeloWhisper(), "small");
    } finally {
      if (salva === undefined) delete process.env.BRUTO_WHISPER_MODEL;
      else process.env.BRUTO_WHISPER_MODEL = salva;
    }
  });

  test("o padrão resolve para o repositório mlx correto (o turbo NÃO tem sufixo -mlx)", () => {
    delete process.env.BRUTO_WHISPER_MODEL;
    try {
      assert.equal(repositorioMlx(modeloWhisper()), "mlx-community/whisper-large-v3-turbo");
    } finally {
      if (salva !== undefined) process.env.BRUTO_WHISPER_MODEL = salva;
    }
  });
});

describe("repositorioMlx — nome curto vira o repositório real do mlx", () => {
  const casos: Array<[string, string]> = [
    ["tiny", "mlx-community/whisper-tiny-mlx"],
    ["base", "mlx-community/whisper-base-mlx"],
    ["small", "mlx-community/whisper-small-mlx"],
    ["medium", "mlx-community/whisper-medium-mlx"],
    ["large-v3", "mlx-community/whisper-large-v3-mlx"],
    ["large-v3-turbo", "mlx-community/whisper-large-v3-turbo"],
  ];

  for (const [nome, esperado] of casos) {
    test(`${nome} → ${esperado}`, () => {
      assert.equal(repositorioMlx(nome), esperado);
    });
  }

  test("nome com `/` já é um repositório completo e passa como está", () => {
    assert.equal(repositorioMlx("mlx-community/whisper-large-v3-turbo"), "mlx-community/whisper-large-v3-turbo");
    assert.equal(repositorioMlx("fulano/meu-whisper-custom"), "fulano/meu-whisper-custom");
  });

  test("nome desconhecido cai no padrão histórico `whisper-<nome>-mlx` (não quebra modelos fora da tabela)", () => {
    // Decisão: passar adiante, não erro — a regra antiga valia para qualquer
    // nome e a maioria dos repos whisper do mlx-community segue esse padrão
    // (ex.: large-v2, tiny.en). Um erro aqui quebraria modelos válidos que
    // simplesmente não estão na tabela.
    assert.equal(repositorioMlx("large-v2"), "mlx-community/whisper-large-v2-mlx");
    assert.equal(repositorioMlx("qualquer-coisa"), "mlx-community/whisper-qualquer-coisa-mlx");
  });
});
