/**
 * Wrapper para chamadas one-shot ao Claude Code CLI (`claude -p`).
 *
 * Usa a autenticação por subscription já configurada na máquina (OAuth em
 * keychain/config) — o processo filho herda o env normal. Cada chamada é
 * stateless: sem sessão persistida, sem ferramentas, sem MCP, sem skills.
 * Saída em JSON (`--output-format json`) para parse determinístico.
 *
 * Flags escolhidas (validadas contra `claude --help` v2026.x):
 *  -p / --print                one-shot, imprime e sai.
 *  --output-format json        emite objeto com { subtype, is_error, result }.
 *  --model <alias>             sonnet | haiku | opus.
 *  --tools ""                  desabilita TODAS as ferramentas → só texto.
 *  --no-session-persistence    não grava sessão em disco (não retomável).
 *  --strict-mcp-config         ignora MCP servers do ambiente (startup rápido,
 *                              sem prompts de auth de conectores).
 *  --disable-slash-commands    desabilita skills/slash-commands.
 *
 * Nota sobre nesting (CLAUDECODE=1): quando este wrapper roda DENTRO de uma
 * sessão Claude Code, o env contém CLAUDECODE=1 e CLAUDE_CODE_*. Verificamos
 * empiricamente que a chamada aninhada funciona normalmente com essas vars
 * presentes (retorna JSON limpo, exit 0). Por isso herdamos o env COMPLETO —
 * remover CLAUDE_CODE_* arriscaria descartar vars relevantes para a auth por
 * subscription. Caso, em outra máquina, o nesting passe a falhar por causa
 * dessas vars, basta trocar `env: process.env` por `env: sanitizeEnv()` (a
 * função já está pronta abaixo, atualmente não usada).
 */

import { spawn } from "node:child_process";
import { PipelineError } from "@/pipeline/types";

export interface RunClaudeOptions {
  /** Prompt principal (vai como argumento posicional de `claude -p`). */
  prompt: string;
  /** Texto opcional escrito no stdin do processo (ex.: transcrição longa). */
  stdin?: string;
  /** Alias do modelo. Default: "sonnet". */
  model?: "sonnet" | "haiku" | "opus";
  /** Timeout por tentativa em ms. Default: 180_000. */
  timeoutMs?: number;
  /**
   * Ferramentas a habilitar (ex.: ["WebSearch"]). Quando fornecido, o CLI roda
   * o agent loop com essas ferramentas em vez do modo só-texto (--tools "").
   * Use com parcimônia: adiciona latência e custo de server tools.
   */
  allowedTools?: string[];
}

/** Timeout padrão por tentativa (ms). */
const DEFAULT_TIMEOUT_MS = 180_000;

/**
 * Remove cercas de código Markdown (```...```) que envolvem TODO o texto.
 * Aceita tag de linguagem opcional na abertura (```json, ```markdown, etc).
 * Se não houver cerca, devolve o texto apenas com trim. Exportada porque o
 * validador de mindmap reusa a mesma normalização.
 */
export function stripFences(text: string): string {
  const trimmed = text.trim();
  // Abertura: ``` seguido de tag opcional até o fim da linha.
  // Conteúdo: qualquer coisa (não-guloso) até a cerca de fechamento no fim.
  const fenced = /^```[^\n`]*\n([\s\S]*?)\n?```$/;
  const m = trimmed.match(fenced);
  if (m) return m[1].trim();
  return trimmed;
}

/** Env do filho SEM as vars de nesting do Claude Code. Reserva — ver header. */
function sanitizeEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k === "CLAUDECODE") continue;
    if (k.startsWith("CLAUDE_CODE_")) continue;
    env[k] = v;
  }
  return env;
}

interface SpawnOutcome {
  stdout: string;
  stderr: string;
  code: number | null;
  timedOut: boolean;
}

/** Roda `claude` uma vez, sem shell, coletando stdout/stderr. */
function spawnClaude(
  opts: RunClaudeOptions,
  timeoutMs: number,
): Promise<SpawnOutcome> {
  return new Promise((resolve, reject) => {
    const model = opts.model ?? "sonnet";
    const useTools = opts.allowedTools && opts.allowedTools.length > 0;
    const args = [
      "-p",
      opts.prompt,
      "--output-format",
      "json",
      "--model",
      model,
      // Modo só-texto (--tools "") por padrão; com ferramentas, permite apenas
      // as solicitadas (ex.: WebSearch) e roda o agent loop.
      ...(useTools
        ? ["--allowed-tools", ...(opts.allowedTools as string[])]
        : ["--tools", ""]),
      "--no-session-persistence",
      "--strict-mcp-config",
      "--disable-slash-commands",
    ];

    // Herda o env completo (auth por subscription). Ver nota no header.
    const child = spawn("claude", args, {
      env: process.env,
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
      reject(err); // ex.: ENOENT (claude não encontrado)
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, code, timedOut });
    });

    // Escreve o stdin (se houver) e SEMPRE fecha — fechar imediatamente evita
    // o aviso "no stdin data received in 3s" e o atraso correspondente.
    if (opts.stdin != null) child.stdin.write(opts.stdin);
    child.stdin.end();
  });
}

/** Extrai o campo `result` do JSON do `claude --output-format json`. */
function parseResult(stdout: string): string {
  const trimmed = stdout.trim();
  if (!trimmed) throw new Error("stdout vazio");

  let obj: unknown;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    throw new Error(`stdout não é JSON válido: ${trimmed.slice(0, 200)}`);
  }

  if (typeof obj !== "object" || obj === null) {
    throw new Error("JSON de saída não é um objeto");
  }
  const rec = obj as Record<string, unknown>;

  if (rec.is_error === true) {
    const detail = typeof rec.result === "string" ? rec.result : "";
    throw new Error(`claude retornou is_error=true (subtype=${String(rec.subtype)}): ${detail}`);
  }
  if (typeof rec.result !== "string") {
    throw new Error("campo 'result' ausente ou não-string no JSON de saída");
  }
  return rec.result;
}

/**
 * Executa uma chamada one-shot ao Claude CLI e devolve o texto do resultado
 * (já sem cercas de código). Em caso de timeout/falha, tenta 1x novamente;
 * se o retry também falhar, lança PipelineError classificado:
 *  - LLM_QUOTA  quando stderr/stdout casar /limit|quota|rate|overloaded/i
 *  - UNKNOWN    caso contrário.
 */
export async function runClaude(opts: RunClaudeOptions): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let lastStdout = "";
  let lastStderr = "";
  let lastReason = "";

  // Tentativa inicial + 1 retry automático (total: 2 execuções).
  for (let attempt = 1; attempt <= 2; attempt++) {
    let outcome: SpawnOutcome;
    try {
      outcome = await spawnClaude(opts, timeoutMs);
    } catch (err) {
      // Falha de spawn (ex.: binário ausente) — registra e tenta de novo.
      lastReason = err instanceof Error ? err.message : String(err);
      lastStderr = lastReason;
      continue;
    }

    lastStdout = outcome.stdout;
    lastStderr = outcome.stderr;

    if (outcome.timedOut) {
      lastReason = `timeout após ${timeoutMs}ms`;
      continue;
    }
    if (outcome.code !== 0) {
      lastReason = `claude saiu com código ${String(outcome.code)}`;
      continue;
    }

    try {
      return stripFences(parseResult(outcome.stdout));
    } catch (err) {
      lastReason = err instanceof Error ? err.message : String(err);
      continue;
    }
  }

  // Ambas as tentativas falharam — classifica o erro.
  const haystack = `${lastStderr}\n${lastStdout}\n${lastReason}`;
  const msg = `Chamada ao Claude CLI falhou após 2 tentativas: ${lastReason}`;
  if (/limit|quota|rate|overloaded/i.test(haystack)) {
    throw new PipelineError("LLM_QUOTA", msg);
  }
  throw new PipelineError("UNKNOWN", msg);
}
