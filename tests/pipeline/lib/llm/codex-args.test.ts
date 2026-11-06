/**
 * `argumentosDoExec` (src/pipeline/lib/llm/providers/codex-cli.ts) — as flags de
 * contenção do `codex exec`, que roda sobre a transcrição de um vídeo de TERCEIRO.
 * Travam: o prompt só depois de `--`, o shell desligado, a sandbox só-leitura e a
 * config da pessoa ignorada (fecha o MCP; achado de segurança de 05/11/2026).
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { argumentosDoExec } from "@/pipeline/lib/llm/providers/codex-cli";

describe("argumentosDoExec", () => {
  const args = argumentosDoExec("faça o resumo", "medium");

  test("o prompt é o último argumento e vem depois de `--`", () => {
    assert.equal(args.at(-1), "faça o resumo");
    assert.equal(args.at(-2), "--");
    assert.equal(args.indexOf("--"), args.length - 2, "nenhum outro `--` antes do terminador");
  });

  test("um prompt com cara de flag continua sendo só texto", () => {
    const hostil = argumentosDoExec("--dangerously-bypass-approvals-and-sandbox", "low");
    assert.equal(hostil.at(-2), "--");
    assert.equal(hostil.at(-1), "--dangerously-bypass-approvals-and-sandbox");
    assert.equal(hostil.indexOf("--dangerously-bypass-approvals-and-sandbox"), hostil.length - 1);
  });

  test("ignora a config da pessoa, que é o que fecha os MCP servers (`-c mcp_servers={}` não fecha: medido)", () => {
    assert.ok(args.includes("--ignore-user-config"));
    assert.ok(args.indexOf("--ignore-user-config") < args.indexOf("--"), "é flag, tem de vir antes do terminador");
    assert.ok(!args.includes("mcp_servers={}"), "o override não fecha MCP; não deve voltar como se fechasse");
  });

  test("o esforço de raciocínio segue como override separado", () => {
    assert.ok(args.includes("model_reasoning_effort=medium"));
  });

  test("shell desligado, sandbox só-leitura e sessão efêmera", () => {
    assert.deepEqual(args.slice(args.indexOf("--disable"), args.indexOf("--disable") + 2), ["--disable", "shell_tool"]);
    assert.deepEqual(args.slice(args.indexOf("--sandbox"), args.indexOf("--sandbox") + 2), ["--sandbox", "read-only"]);
    assert.ok(args.includes("--ephemeral"));
  });
});
