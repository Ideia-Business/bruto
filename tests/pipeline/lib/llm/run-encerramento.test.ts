/**
 * `runLLM` e a marca de encerramento — o achado [P2] da r4: durante o
 * encerramento, o retry da chamada spawnava filho NOVO (claude/codex CLI)
 * DEPOIS do retrato da limpeza — o filho que escapa ao "Encerrar o Bruto".
 * O contrato novo: com a marca ligada, NÃO há segunda tentativa.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import type { LlmProvider, LlmRequest, LlmResult } from "@/pipeline/lib/llm/types";

let runLLMComProvedor: typeof import("@/pipeline/lib/llm").runLLMComProvedor;
let marcarEncerramento: typeof import("@/pipeline/lib/marca-de-encerramento").marcarEncerramento;
let resetarMarca: typeof import("@/pipeline/lib/marca-de-encerramento").resetarMarcaDeEncerramentoParaTestes;

before(async () => {
  ({ runLLMComProvedor } = await import("@/pipeline/lib/llm"));
  ({ marcarEncerramento, resetarMarcaDeEncerramentoParaTestes: resetarMarca } = await import(
    "@/pipeline/lib/marca-de-encerramento"
  ));
});

after(() => {
  resetarMarca();
});

/** Provedor falso que SEMPRE falha com erro transitório (o tipo que ganha retry). */
function provedorQueSempreFalha(): { provedor: LlmProvider; chamadas: () => number } {
  let n = 0;
  const provedor: LlmProvider = {
    id: "openai",
    label: "provedor falso",
    envVar: null,
    supports: () => true,
    availability: async () => ({ ok: true }),
    run: async (_req: LlmRequest, _timeoutMs: number): Promise<LlmResult> => {
      n += 1;
      throw new Error("falha transitória — o tipo que ganha segunda tentativa");
    },
  };
  return { provedor, chamadas: () => n };
}

describe("runLLM — nenhum trabalho novo com a marca de encerramento ligada", () => {
  const req: LlmRequest = { task: "summary", prompt: "resuma" };

  test("SEM a marca: erro transitório ganha a segunda tentativa (sanity da fixture)", async () => {
    resetarMarca();
    const { provedor, chamadas } = provedorQueSempreFalha();
    await assert.rejects(runLLMComProvedor(provedor, req));
    assert.equal(chamadas(), 2, "sem a marca ligada, tenta duas vezes");
  });

  test("COM a marca: NÃO há nova tentativa — retry nenhum cria filho no encerramento", async () => {
    marcarEncerramento();
    try {
      const { provedor, chamadas } = provedorQueSempreFalha();
      await assert.rejects(runLLMComProvedor(provedor, req));
      assert.equal(chamadas(), 1, "com a marca ligada, uma chamada só");
    } finally {
      resetarMarca();
    }
  });
});
