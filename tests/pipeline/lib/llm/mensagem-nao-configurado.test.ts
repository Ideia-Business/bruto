/**
 * `LLM_NOT_CONFIGURED` — a mensagem é POR MODO.
 *
 * No app empacotado não existe `.env` editável nem `.env.example`: a
 * mensagem manda primeiro ao caminho do plano (entrar no `claude` ou
 * `codex login`) e depois à alternativa real do pacote (`~/.bruto/.env`).
 * No clone, a mensagem histórica fica INALTERADA.
 *
 * Também trava a razão de indisponibilidade dos provedores de chave: ela
 * compõe a mensagem do resolver, o doctor e o /api/llm/saude — no pacote
 * tem de apontar para `~/.bruto/.env`, nunca para um `.env` que não existe.
 */
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mensagemNenhumProvedor } from "@/pipeline/lib/llm";
import { anthropicProvider } from "@/pipeline/lib/llm/providers/anthropic";
import { googleProvider } from "@/pipeline/lib/llm/providers/google";
import { openaiProvider } from "@/pipeline/lib/llm/providers/openai-compativel";

let salvas: Record<string, string | undefined>;
const VARS = [
  "BRUTO_EMPACOTADO",
  "ANTHROPIC_API_KEY",
  "GOOGLE_API_KEY",
  "GEMINI_API_KEY",
  "OPENAI_API_KEY",
] as const;

beforeEach(() => {
  salvas = {};
  for (const v of VARS) {
    salvas[v] = process.env[v];
    delete process.env[v];
  }
});

afterEach(() => {
  for (const v of VARS) {
    if (salvas[v] === undefined) delete process.env[v];
    else process.env[v] = salvas[v]!;
  }
});

describe("mensagemNenhumProvedor — texto por modo", () => {
  test("modo pacote: plano primeiro, ~/.bruto/.env depois, NADA de .env.example", () => {
    process.env.BRUTO_EMPACOTADO = "1";
    const msg = mensagemNenhumProvedor(["  · Anthropic: sem chave"]);

    const iPlano = msg.indexOf("claude");
    const iEnv = msg.indexOf("~/.bruto/.env");
    assert.ok(iPlano !== -1 && msg.includes("codex login"), "o caminho recomendado é o plano");
    assert.ok(iEnv !== -1, "a alternativa é o .env da pessoa");
    assert.ok(iPlano < iEnv, "o plano vem ANTES da alternativa da chave");
    assert.ok(msg.includes("ANTHROPIC_API_KEY="), "exemplo concreto de linha do arquivo");
    assert.ok(!msg.includes(".env.example"), ".env.example NÃO existe no pacote");
  });

  test("modo clone: a mensagem de sempre, INALTERADA", () => {
    const msg = mensagemNenhumProvedor(["  · A: x", "  · B: y"]);
    assert.equal(
      msg,
      "Nenhum provedor de IA configurado. Escolha um:\n  · A: x\n  · B: y\n" +
        "Copie .env.example para .env e preencha uma chave, ou instale o Claude Code.",
    );
  });
});

describe("a razão de indisponibilidade dos provedores aponta para o arquivo certo", () => {
  const provedoresDeChave = [anthropicProvider, googleProvider, openaiProvider];

  test("modo pacote → ~/.bruto/.env", async () => {
    process.env.BRUTO_EMPACOTADO = "1";
    for (const p of provedoresDeChave) {
      const d = await p.availability();
      assert.equal(d.ok, false, `${p.label} não devia estar disponível sem chave`);
      if (!d.ok) {
        assert.match(d.reason, /~\/\.bruto\/\.env/, `${p.label}: "${d.reason}"`);
      }
    }
  });

  test("modo clone → .env, sem vazar texto do pacote", async () => {
    for (const p of provedoresDeChave) {
      const d = await p.availability();
      assert.equal(d.ok, false, `${p.label} não devia estar disponível sem chave`);
      if (!d.ok) {
        assert.match(d.reason, /\.env/, `${p.label}: "${d.reason}"`);
        assert.ok(!d.reason.includes(".bruto"), `${p.label} vazou texto do pacote no clone`);
      }
    }
  });
});
