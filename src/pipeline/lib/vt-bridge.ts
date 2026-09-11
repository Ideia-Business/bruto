/**
 * vt-bridge — ponte para o vt.sh da skill IdeiaOS `video-transcribe`.
 *
 * Interface real do vt.sh (confirmada lendo lib/vt.sh):
 *   vt.sh transcribe <arquivo> [--json] [--lang CODE] [--no-cache]
 *   vt.sh doctor      → exit 0 = ffmpeg + algum backend whisper prontos
 *   Exit codes: 0=ok · 1=uso/args · 2=deps ausentes · 3=falha de transcrição · 4=arquivo inválido
 *   Cache próprio: ~/.ideiaos/transcripts/<sha256>.txt (mesma mídia não re-transcreve).
 *
 * Decisão `--json`: o vt.sh suporta o flag nativamente e emite no stdout um JSON
 * `{text, backend, path, sha256}`. Extraímos `.text` — inequívoco (sem risco de
 * ruído no stdout) e o `backend` fica disponível caso queiramos logar no futuro.
 */

import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { PipelineError } from "@/pipeline/types";
import { redact } from "@/pipeline/lib/llm/redact";

/**
 * Candidatos ao vt.sh, em ordem de preferência:
 *   1. `$BRUTO_VT_SH` — caminho explícito, para quem mantém o script fora do padrão.
 *   2. `scripts/vt.sh` do próprio projeto — o caminho suportado por padrão.
 *   3. cópia global em ~/.claude/skills/ — conveniência para quem já tem a skill.
 *
 * debt: o vt.sh ainda não é distribuído junto com este repo (ver #1 no README:
 * Whisper é opcional e só liga quando o script está presente). Enquanto isso, a
 * ausência degrada de forma explícita — nunca silenciosa: sem vt.sh, vídeos sem
 * legenda falham com NO_TRANSCRIPT em vez de produzir resumo vazio.
 */
const VT_SH_CANDIDATES: readonly string[] = [
  ...(process.env.BRUTO_VT_SH ? [process.env.BRUTO_VT_SH] : []),
  path.join(process.cwd(), "scripts", "vt.sh"),
  path.join(os.homedir(), ".claude", "skills", "video-transcribe", "lib", "vt.sh"),
];

/** Timeout da transcrição — vídeos longos com modelo base podem demorar; 45 min é teto seguro. */
const TRANSCRIBE_TIMEOUT_MS = 45 * 60 * 1000;

/** Timeout do doctor — é só checagem de deps, nunca deve passar de segundos. */
const DOCTOR_TIMEOUT_MS = 60 * 1000;

/** Resolve o primeiro vt.sh existente (checa o disco a cada chamada — barato). */
export function resolveVtShPath(): string | null {
  for (const candidate of VT_SH_CANDIDATES) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/** Path do vt.sh resolvido no load do módulo (null se ausente). Informativo/debug. */
export const VT_SH_PATH: string | null = resolveVtShPath();

/** True se algum dos paths candidatos do vt.sh existe. */
export function isVtAvailable(): boolean {
  return resolveVtShPath() !== null;
}

interface VtRunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** Trunca texto longo preservando o FINAL (mensagens de erro úteis ficam no fim do stderr). */
function truncateTail(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `…${text.slice(-maxChars)}`;
}

/**
 * Executa `bash <vt.sh> <args>` coletando stdout/stderr como streams
 * (transcrições longas estouram o maxBuffer do exec — spawn não tem esse limite).
 */
/**
 * O que um processo externo de transcrição legitimamente precisa: achar
 * binários, saber onde é a casa, escrever temporário e formatar texto. Nenhuma
 * credencial atravessa.
 */
export function ambienteMinimo(): NodeJS.ProcessEnv {
  // NODE_ENV entra porque o tipo do Node o exige e porque não é segredo —
  // ferramentas de linha de comando costumam consultá-lo.
  const permitidas = ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "SHELL", "USER", "NODE_ENV"];
  const env: Record<string, string> = {};
  for (const nome of permitidas) {
    const v = process.env[nome];
    if (v !== undefined) env[nome] = v;
  }
  return env as NodeJS.ProcessEnv;
}

function runVt(vtShPath: string, args: string[], timeoutMs: number): Promise<VtRunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", [vtShPath, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      // Ambiente MÍNIMO, nunca `process.env`. O vt.sh é script externo que não
      // controlamos, e o que ele imprime no stderr acaba na mensagem de erro —
      // gravada em `jobs.error_message`, no banco. Com o ambiente inteiro, uma
      // falha que ecoasse o env gravaria a chave de quem usa. Transcrever áudio
      // não precisa de credencial nenhuma.
      env: ambienteMinimo(),
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      // Escalada: se o backend (python/whisper) ignorar SIGTERM, SIGKILL em 10s.
      setTimeout(() => child.kill("SIGKILL"), 10_000).unref();
    }, timeoutMs);
    timer.unref();

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code, stdout, stderr, timedOut });
    });
  });
}

/**
 * Roda `vt.sh doctor` — checagem de dependências (ffmpeg + backend whisper).
 * Nunca lança: vt.sh ausente ou falha de spawn viram `{ ok: false }` com explicação.
 */
export async function vtDoctor(): Promise<{ ok: boolean; output: string }> {
  const vtSh = resolveVtShPath();
  if (!vtSh) {
    return { ok: false, output: "vt.sh não encontrado — rode /ideiaos-setup" };
  }
  try {
    const run = await runVt(vtSh, ["doctor"], DOCTOR_TIMEOUT_MS);
    const output = [run.stdout.trim(), run.stderr.trim()].filter(Boolean).join("\n");
    return { ok: run.exitCode === 0, output };
  } catch (err) {
    return {
      ok: false,
      output: `falha ao executar vt.sh doctor: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Transcreve um arquivo de áudio via `vt.sh transcribe <arquivo> --json [--lang CODE]`.
 * Retorna o texto puro da transcrição (campo `.text` do JSON do vt.sh).
 *
 * Erros viram PipelineError('NO_TRANSCRIPT', …) — este é o último degrau da cascata
 * de transcript, então falha aqui significa "sem transcrição possível".
 */
export async function transcribeAudio(audioPath: string, lang?: string): Promise<string> {
  const vtSh = resolveVtShPath();
  if (!vtSh) {
    throw new PipelineError("NO_TRANSCRIPT", "vt.sh não encontrado — rode /ideiaos-setup");
  }

  const args = ["transcribe", audioPath, "--json"];
  if (lang) {
    args.push("--lang", lang);
  }

  let run: VtRunResult;
  try {
    run = await runVt(vtSh, args, TRANSCRIBE_TIMEOUT_MS);
  } catch (err) {
    throw new PipelineError(
      "NO_TRANSCRIPT",
      `falha ao executar vt.sh: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (run.timedOut) {
    throw new PipelineError(
      "NO_TRANSCRIPT",
      `transcrição excedeu o timeout de 45 min: ${path.basename(audioPath)}`,
    );
  }

  if (run.exitCode !== 0) {
    // Cinto e suspensório: o ambiente já vai mínimo, mas texto de processo
    // externo nunca entra numa exceção sem passar pela redação — esta mensagem é
    // PERSISTIDA, e o que é persistido não se corrige depois.
    const detail = redact(
      truncateTail(
        run.stderr.trim() || run.stdout.trim() || `vt.sh saiu com código ${run.exitCode}`,
        600,
      ),
    );
    throw new PipelineError(
      "NO_TRANSCRIPT",
      `${detail} — instale whisper: uv tool install mlx-whisper`,
    );
  }

  // Com --json o stdout é exatamente um objeto {text, backend, path, sha256}.
  let text: string;
  try {
    const parsed: unknown = JSON.parse(run.stdout);
    const maybeText =
      typeof parsed === "object" && parsed !== null && "text" in parsed
        ? (parsed as { text: unknown }).text
        : null;
    text = typeof maybeText === "string" ? maybeText.trim() : "";
  } catch {
    throw new PipelineError(
      "NO_TRANSCRIPT",
      `vt.sh retornou saída inesperada (JSON inválido): ${truncateTail(run.stdout.trim(), 200)}`,
    );
  }

  if (!text) {
    throw new PipelineError(
      "NO_TRANSCRIPT",
      "vt.sh retornou transcrição vazia (áudio sem fala detectável?)",
    );
  }

  return text;
}
