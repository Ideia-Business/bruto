/**
 * Provedor: Claude Code CLI (`claude -p`).
 *
 * Autentica pela sessão já configurada na máquina — nenhuma chave de API
 * transita. É o caminho de menor atrito para quem já usa o Claude Code, e o
 * único provedor com busca web nesta versão.
 *
 * Flags (validadas contra `claude --help`):
 *  -p / --print                one-shot, imprime e sai
 *  --output-format json        objeto com { subtype, is_error, result }
 *  --model <alias>             sonnet | haiku | opus
 *  --tools ""                  desabilita TODAS as ferramentas → só texto
 *  --no-session-persistence    não grava sessão em disco
 *  --strict-mcp-config         ignora MCP do ambiente (startup rápido)
 *  --disable-slash-commands    desabilita skills/slash-commands
 *
 * Nota sobre aninhamento: quando isto roda DENTRO de uma sessão Claude Code, o
 * env traz CLAUDECODE=1 e CLAUDE_CODE_*. Verificado empiricamente que a chamada
 * aninhada funciona com essas variáveis presentes, por isso herdamos o env
 * completo — removê-las arriscaria descartar o que sustenta a autenticação.
 */

import { spawn } from "node:child_process";
import { ENV_SENSIVEIS, redact } from "../redact";
import type { LlmCapability, LlmProvider, LlmRequest, LlmResult } from "../types";

const MODELO: Record<string, string> = {
  fast: "haiku",
  balanced: "sonnet",
  deep: "opus",
};

function semChavesDeOutros(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const nome of ENV_SENSIVEIS) delete env[nome];
  return env;
}

interface Saida {
  stdout: string;
  stderr: string;
  code: number | null;
  timedOut: boolean;
}

function executar(args: string[], input: string | undefined, timeoutMs: number): Promise<Saida> {
  return new Promise((resolve, reject) => {
    // Aqui o env COMPLETO é necessário: a autenticação do Claude Code vem da
    // sessão local, e não sabemos com certeza quais variáveis a sustentam —
    // podar às cegas arriscaria quebrar o login. O que SIM se pode tirar, e se
    // tira, são as chaves dos OUTROS provedores: se alguém configurou OpenAI no
    // .env e está usando o CLI, não há razão para o processo filho enxergar
    // aquela chave. Least-privilege no que dá para provar.
    const child = spawn("claude", args, {
      env: semChavesDeOutros(),
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString("utf8");
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString("utf8");
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err); // ex.: ENOENT (binário ausente)
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, code, timedOut });
    });

    // Fecha o stdin imediatamente — evita o aviso "no stdin data received in 3s".
    if (input != null) child.stdin.write(input);
    child.stdin.end();
  });
}

function extrairResultado(stdout: string): string {
  const trimmed = stdout.trim();
  if (!trimmed) throw new Error("saída vazia");

  let obj: unknown;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    throw new Error(`saída não é JSON válido: ${redact(trimmed.slice(0, 200))}`);
  }
  if (typeof obj !== "object" || obj === null) throw new Error("saída não é um objeto");

  const rec = obj as Record<string, unknown>;
  if (rec.is_error === true) {
    const detalhe = typeof rec.result === "string" ? redact(rec.result) : "";
    throw new Error(`o CLI retornou erro (${String(rec.subtype)}): ${detalhe}`);
  }
  if (typeof rec.result !== "string") throw new Error("campo 'result' ausente na saída");
  return rec.result;
}

export const claudeCliProvider: LlmProvider = {
  id: "claude-cli",
  label: "Claude Code CLI",
  envVar: null, // autentica pela sessão local — nenhuma chave envolvida

  supports(capability: LlmCapability): boolean {
    return capability === "webSearch";
  },

  async availability() {
    try {
      const r = await executar(["--version"], undefined, 15_000);
      if (r.code === 0) return { ok: true as const };
      return { ok: false as const, reason: "o comando `claude` respondeu com erro" };
    } catch {
      return {
        ok: false as const,
        reason: "o comando `claude` não está no PATH — instale o Claude Code ou escolha outro provedor em BRUTO_LLM_PROVIDER",
      };
    }
  },

  async run(req: LlmRequest, timeoutMs: number): Promise<LlmResult> {
    const model = MODELO[req.tier ?? "balanced"];
    const querBusca = req.requires?.includes("webSearch") ?? false;

    const args = [
      "-p",
      req.prompt,
      "--output-format",
      "json",
      "--model",
      model,
      ...(querBusca ? ["--allowed-tools", "WebSearch"] : ["--tools", ""]),
      "--no-session-persistence",
      "--strict-mcp-config",
      "--disable-slash-commands",
    ];

    const r = await executar(args, req.input, timeoutMs);

    if (r.timedOut) throw new Error(`tempo esgotado após ${timeoutMs}ms`);
    if (r.code !== 0) {
      // O stderr do CLI pode conter caminho e contexto; redigir antes de propagar.
      const detalhe = redact(r.stderr.trim().slice(0, 300));
      throw new Error(`o CLI saiu com código ${String(r.code)}${detalhe ? `: ${detalhe}` : ""}`);
    }

    return { text: extrairResultado(r.stdout), provider: "claude-cli", model };
  },
};
