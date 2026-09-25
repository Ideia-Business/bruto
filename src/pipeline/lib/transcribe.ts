/**
 * transcribe — transcrição local de áudio, sem script externo.
 *
 * Substitui a ponte para o `vt.sh` da skill IdeiaOS `video-transcribe`. O motivo
 * da troca é concreto: o `vt.sh` não era distribuído com este repositório, então
 * a transcrição — que é o que faz o Bruto dar conta de Instagram e TikTok, onde
 * quase não há legenda publicada — só funcionava em máquina que já tivesse o
 * IdeiaOS instalado. Para quem clonava o projeto, o diferencial anunciado na
 * primeira linha do README simplesmente não existia.
 *
 * Três backends locais, na ordem de preferência:
 *   1. mlx-whisper  — Apple Silicon, o mais rápido aqui
 *   2. whisper      — a CLI de referência da OpenAI (roda em qualquer lugar)
 *   3. whisper.cpp  — `whisper-cli`/`whisper-cpp` + modelo ggml no disco
 *
 * O backend de REDE do vt.sh (a API de transcrição da OpenAI) **não** foi
 * portado, de propósito. Ele já estava morto aqui — `ambienteMinimo()` nunca
 * repassou `OPENAI_API_KEY` ao subprocesso — e trazê-lo de volta significaria
 * fazer a chave de quem usa atravessar um processo externo cujo stderr acaba
 * gravado em `jobs.error_message`. Transcrever áudio não precisa de credencial;
 * o que não precisa de credencial não recebe credencial.
 */
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dividirPath, localizarBinario } from "@/pipeline/lib/binario";
import { DATA_ROOT } from "@/pipeline/lib/paths";
import { redact } from "@/pipeline/lib/llm/redact";
import { PipelineError } from "@/pipeline/types";

export type Backend = "mlx" | "whisper" | "whisper-cpp";

/** Modelo Whisper. `base` equilibra qualidade e tempo; troque por env. */
const MODELO = process.env.BRUTO_WHISPER_MODEL || "base";

/** Idioma opcional passado ao backend (código ISO, ex.: "pt"). */
const TIMEOUT_TRANSCRICAO_MS = 45 * 60 * 1000;
const TIMEOUT_FFMPEG_MS = 10 * 60 * 1000;

/** Cache de transcrição por conteúdo do áudio — ver `transcreverAudio`. */
const CACHE_DIR = path.join(DATA_ROOT, "transcripts");

// ── ambiente e execução ──────────────────────────────────────────────────────

/**
 * O que um processo externo de transcrição legitimamente precisa: achar
 * binários, saber onde é a casa, escrever temporário e formatar texto. Nenhuma
 * credencial atravessa.
 *
 * Isto não é zelo decorativo: o que estes processos imprimem no stderr entra na
 * mensagem de erro, e a mensagem de erro é PERSISTIDA em `jobs.error_message`.
 * Com o ambiente inteiro, uma falha que ecoasse o env gravaria a chave de quem
 * usa, no banco, para sempre.
 */
export function ambienteMinimo(): NodeJS.ProcessEnv {
  // NODE_ENV entra porque o tipo do Node o exige e porque não é segredo —
  // ferramentas de linha de comando costumam consultá-lo.
  const permitidas = ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "SHELL", "USER", "NODE_ENV"];
  // No Windows não existem HOME/TMPDIR/USER/SHELL — quem os substitui são
  // estas outras, e um Python instalado no Windows falha sem SYSTEMROOT (ele
  // usa a variável para localizar DLLs do sistema). PATHEXT é o que permite
  // ao subprocesso resolver um nome nu (`python3`) para o `.exe`/`.cmd` certo.
  if (process.platform === "win32") {
    permitidas.push(
      "USERPROFILE",
      "TEMP",
      "TMP",
      "USERNAME",
      "APPDATA",
      "LOCALAPPDATA",
      "SYSTEMROOT",
      "PATHEXT",
    );
  }
  const env: Record<string, string> = {};
  for (const nome of permitidas) {
    const v = process.env[nome];
    if (v !== undefined) env[nome] = v;
  }
  return env as NodeJS.ProcessEnv;
}

interface Execucao {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** Trunca preservando o FINAL — a parte útil do stderr fica no fim. */
function cauda(texto: string, max: number): string {
  return texto.length <= max ? texto : `…${texto.slice(-max)}`;
}

/**
 * Roda um comando com ambiente mínimo, coletando saída por stream (transcrição
 * longa estoura o maxBuffer do `exec`; `spawn` não tem esse limite).
 */
function rodar(
  cmd: string,
  args: string[],
  opts: { timeoutMs: number; stdin?: string } = { timeoutMs: TIMEOUT_TRANSCRICAO_MS },
): Promise<Execucao> {
  return new Promise((resolve, reject) => {
    // stdio "pipe" nos três: quando não há entrada, o stdin é apenas fechado —
    // mesmo efeito de "ignore" para quem está do outro lado.
    const child = spawn(cmd, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: ambienteMinimo(),
    });

    // Os tipos do `spawn` não provam que os streams existem; em vez de calar o
    // compilador com `!`, tratamos a ausência como o erro que ela seria.
    const { stdout: saida, stderr: erro, stdin: entrada } = child;
    if (!saida || !erro || !entrada) {
      reject(new Error(`não foi possível abrir os fluxos de ${cmd}`));
      return;
    }

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      // Escalada: se o backend (python/whisper) ignorar SIGTERM, SIGKILL em 10s.
      setTimeout(() => child.kill("SIGKILL"), 10_000).unref();
    }, opts.timeoutMs);
    timer.unref();

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (c: string) => {
      stdout += c;
    });
    child.stderr.on("data", (c: string) => {
      stderr += c;
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });

    if (opts.stdin !== undefined) {
      child.stdin.end(opts.stdin);
    }
  });
}

// ── detecção de backend ──────────────────────────────────────────────────────

/**
 * Procura um executável no PATH sem gastar um processo. Mais barato e mais
 * previsível que chamar `which` — e não depende de shell.
 *
 * No win32, testa também cada extensão de PATHEXT (ver `binario.ts`): sem
 * isso, `ffmpeg`/`whisper` nunca eram encontrados no Windows, porque o que
 * está no disco é `ffmpeg.exe`/`whisper.exe`, nunca o nome nu.
 */
function noPath(bin: string): boolean {
  const dirs = dividirPath(process.env.PATH || "");
  return localizarBinario(bin, { diretorios: dirs }) !== null;
}

/** Script que pergunta ao Python se o módulo `mlx_whisper` está instalado. */
const SONDA_MLX = `import importlib.util, sys
sys.exit(0 if importlib.util.find_spec("mlx_whisper") else 1)
`;

let cacheMlx: boolean | null = null;

/**
 * mlx-whisper é um módulo Python, não um binário — só dá para saber perguntando
 * ao interpretador. O resultado é memoizado: instalar pacote no meio de um
 * processo do Bruto não acontece, e a sonda custa um spawn.
 */
async function temMlx(): Promise<boolean> {
  if (cacheMlx !== null) return cacheMlx;
  if (!noPath("python3")) {
    cacheMlx = false;
    return false;
  }
  try {
    const r = await rodar("python3", ["-"], { timeoutMs: 30_000, stdin: SONDA_MLX });
    cacheMlx = r.code === 0;
  } catch {
    cacheMlx = false;
  }
  return cacheMlx;
}

function binWhisperCpp(): string | null {
  if (noPath("whisper-cli")) return "whisper-cli";
  if (noPath("whisper-cpp")) return "whisper-cpp";
  return null;
}

/**
 * whisper.cpp não baixa modelo sozinho: sem o arquivo ggml no disco, o binário
 * existe e não serve para nada. Por isso a presença do MODELO faz parte da
 * detecção — um backend que falha em tempo de execução não é um backend.
 */
export function modeloWhisperCpp(): string | null {
  const candidatos = [
    ...(process.env.BRUTO_WHISPER_CPP_MODEL ? [process.env.BRUTO_WHISPER_CPP_MODEL] : []),
    path.join(os.homedir(), ".cache", "whisper", `ggml-${MODELO}.bin`),
    `/opt/homebrew/share/whisper-cpp/ggml-${MODELO}.bin`,
    `/usr/local/share/whisper-cpp/ggml-${MODELO}.bin`,
  ];
  for (const c of candidatos) {
    try {
      if (fs.statSync(c).size > 0) return c;
    } catch {
      // segue para o próximo candidato
    }
  }
  return null;
}

/** O primeiro backend utilizável, ou null se não houver nenhum. */
export async function detectarBackend(): Promise<Backend | null> {
  if (await temMlx()) return "mlx";
  if (noPath("whisper")) return "whisper";
  if (binWhisperCpp() && modeloWhisperCpp()) return "whisper-cpp";
  return null;
}

/** True se há ffmpeg E algum backend — a transcrição precisa dos dois. */
export async function transcricaoDisponivel(): Promise<boolean> {
  return noPath("ffmpeg") && (await detectarBackend()) !== null;
}

// ── extração de áudio ────────────────────────────────────────────────────────

/** Extrai wav mono 16 kHz — o formato que todos os backends esperam. */
async function extrairAudioWav(origem: string, destino: string): Promise<void> {
  if (!noPath("ffmpeg")) {
    throw new PipelineError(
      "NO_TRANSCRIPT",
      "ffmpeg ausente — rode o instalador de novo (install/instalar.sh no macOS/Linux, install\\instalar.ps1 no Windows)",
    );
  }
  const r = await rodar(
    "ffmpeg",
    // prettier-ignore
    [
      "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
      "-i", origem, "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1", destino,
    ],
    { timeoutMs: TIMEOUT_FFMPEG_MS },
  );
  if (r.code !== 0) {
    throw new PipelineError(
      "NO_TRANSCRIPT",
      `ffmpeg falhou ao extrair o áudio: ${redact(cauda(r.stderr.trim(), 400))}`,
    );
  }
  let vazio = true;
  try {
    vazio = fs.statSync(destino).size === 0;
  } catch {
    vazio = true;
  }
  if (vazio) {
    throw new PipelineError("NO_TRANSCRIPT", "o áudio extraído saiu vazio (arquivo sem trilha?)");
  }
}

// ── backends ─────────────────────────────────────────────────────────────────

/**
 * O `mlx_whisper` imprime coisas no stdout por conta própria ("Detected
 * language: pt"). Este script isola o stdout da biblioteca num buffer e devolve
 * só o texto — e, se a biblioteca tiver escrito o texto no buffer em vez de
 * devolvê-lo, recupera de lá. Portado verbatim do vt.sh, onde já era o
 * comportamento provado.
 */
const SCRIPT_MLX = `import os, sys, warnings
os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
os.environ.setdefault("TRANSFORMERS_VERBOSITY", "error")
warnings.filterwarnings("ignore")
import io, contextlib
from mlx_whisper import transcribe
wav, model, lang = sys.argv[1], sys.argv[2], sys.argv[3]
model_id = model if "/" in model else f"mlx-community/whisper-{model}-mlx"
kwargs = {"path_or_hf_repo": model_id, "verbose": False}
if lang:
    kwargs["language"] = lang
buf = io.StringIO()
with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(sys.stderr):
    result = transcribe(wav, **kwargs)
text = (result.get("text") or "").strip()
if not text:
    text = buf.getvalue().strip().splitlines()[-1] if buf.getvalue().strip() else ""
print(text)
`;

async function rodarMlx(wav: string, lang: string): Promise<Execucao> {
  return rodar("python3", ["-", wav, MODELO, lang], {
    timeoutMs: TIMEOUT_TRANSCRICAO_MS,
    stdin: SCRIPT_MLX,
  });
}

/** A CLI da OpenAI escreve `<stem>.txt` no `--output_dir`; lemos de lá. */
async function rodarWhisperCli(wav: string, lang: string): Promise<string> {
  const outdir = fs.mkdtempSync(path.join(os.tmpdir(), "bruto-whisper-"));
  try {
    const args = [wav, "--model", MODELO, "--output_format", "txt", "--output_dir", outdir, "--verbose", "False"];
    if (lang) args.push("--language", lang);
    const r = await rodar("whisper", args, { timeoutMs: TIMEOUT_TRANSCRICAO_MS });
    if (r.timedOut) throw new PipelineError("NO_TRANSCRIPT", tempoEsgotado(wav));
    if (r.code !== 0) {
      throw new PipelineError(
        "NO_TRANSCRIPT",
        `whisper falhou: ${redact(cauda(r.stderr.trim() || r.stdout.trim(), 400))}`,
      );
    }
    const txt = fs.readdirSync(outdir).find((f) => f.endsWith(".txt"));
    if (!txt) {
      throw new PipelineError("NO_TRANSCRIPT", "whisper terminou sem escrever o arquivo de texto");
    }
    return fs.readFileSync(path.join(outdir, txt), "utf8");
  } finally {
    fs.rmSync(outdir, { recursive: true, force: true });
  }
}

/** `-nt` = sem marcação de tempo; o texto sai no stdout, uma linha por trecho. */
async function rodarWhisperCpp(wav: string, lang: string): Promise<string> {
  const bin = binWhisperCpp();
  const modelo = modeloWhisperCpp();
  if (!bin || !modelo) {
    throw new PipelineError(
      "NO_TRANSCRIPT",
      `whisper.cpp sem o modelo ggml-${MODELO}.bin no disco — baixe-o ou aponte BRUTO_WHISPER_CPP_MODEL`,
    );
  }
  const args = ["-m", modelo, "-f", wav, "-nt"];
  if (lang) args.push("-l", lang);
  const r = await rodar(bin, args, { timeoutMs: TIMEOUT_TRANSCRICAO_MS });
  if (r.timedOut) throw new PipelineError("NO_TRANSCRIPT", tempoEsgotado(wav));
  if (r.code !== 0) {
    throw new PipelineError(
      "NO_TRANSCRIPT",
      `${bin} falhou: ${redact(cauda(r.stderr.trim() || r.stdout.trim(), 400))}`,
    );
  }
  return r.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");
}

function tempoEsgotado(arquivo: string): string {
  return `a transcrição passou de 45 min e foi interrompida: ${path.basename(arquivo)}`;
}

// ── API pública ──────────────────────────────────────────────────────────────

/**
 * Transcreve um arquivo de áudio e devolve o texto puro.
 *
 * O resultado é guardado em cache pelo sha256 do ÁUDIO, não pelo id do vídeo:
 * o mesmo conteúdo transcrito uma vez não volta a custar 45 minutos num retry.
 * Falha de cache nunca é fatal — é conveniência, não fonte da verdade.
 */
export async function transcreverAudio(audioPath: string, idioma?: string): Promise<string> {
  const lang = (idioma ?? "").split("-")[0];

  // A chave inclui MODELO e IDIOMA, não só o conteúdo do áudio. O vt.sh
  // chaveava só pelo arquivo, e isso devolve a transcrição errada quando o
  // mesmo áudio é pedido noutro idioma (ou com outro modelo) — medido ao portar:
  // um vídeo em inglês transcrito com `--lang pt` ficava preso no cache, e o
  // pedido seguinte, sem idioma, recebia de volta a salada em português.
  const hash = sha256Arquivo(audioPath, `${MODELO}:${lang}`);
  const cacheFile = hash ? path.join(CACHE_DIR, `${hash}.txt`) : null;
  if (cacheFile) {
    try {
      const guardado = fs.readFileSync(cacheFile, "utf8").trim();
      if (guardado) return guardado;
    } catch {
      // sem cache — segue para transcrever
    }
  }

  const backend = await detectarBackend();
  if (!backend) {
    throw new PipelineError("NO_TRANSCRIPT", SEM_BACKEND);
  }

  const work = fs.mkdtempSync(path.join(os.tmpdir(), "bruto-audio-"));
  const wav = path.join(work, "audio.wav");
  let texto: string;
  try {
    await extrairAudioWav(audioPath, wav);
    texto = await transcreverWav(backend, wav, lang);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }

  texto = texto.trim();
  if (!texto) {
    throw new PipelineError(
      "NO_TRANSCRIPT",
      "a transcrição saiu vazia (áudio sem fala detectável?)",
    );
  }

  if (cacheFile) {
    try {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      fs.writeFileSync(cacheFile, texto);
    } catch {
      // cache é conveniência: não poder gravar não invalida a transcrição
    }
  }
  return texto;
}

async function transcreverWav(backend: Backend, wav: string, lang: string): Promise<string> {
  if (backend === "whisper") return rodarWhisperCli(wav, lang);
  if (backend === "whisper-cpp") return rodarWhisperCpp(wav, lang);

  let r: Execucao;
  try {
    r = await rodarMlx(wav, lang);
  } catch (err) {
    throw new PipelineError(
      "NO_TRANSCRIPT",
      `falha ao executar o mlx-whisper: ${redact(err instanceof Error ? err.message : String(err))}`,
    );
  }
  if (r.timedOut) throw new PipelineError("NO_TRANSCRIPT", tempoEsgotado(wav));
  if (r.code !== 0) {
    throw new PipelineError(
      "NO_TRANSCRIPT",
      `mlx-whisper falhou: ${redact(cauda(r.stderr.trim() || r.stdout.trim(), 400))}`,
    );
  }
  return r.stdout;
}

/**
 * sha256 do conteúdo do arquivo MAIS o tempero (modelo e idioma) — é o tempero
 * que impede uma transcrição de vazar para um pedido feito com outros
 * parâmetros. Null se não der para ler; nesse caso o cache é simplesmente
 * pulado, nunca inventado.
 */
function sha256Arquivo(p: string, tempero: string): string | null {
  try {
    return crypto
      .createHash("sha256")
      .update(fs.readFileSync(p))
      .update(` ${tempero}`)
      .digest("hex");
  } catch {
    return null;
  }
}

/**
 * A mensagem que quem clonou o projeto vai ver. Diz o que instalar — nunca
 * manda rodar comando de ferramenta interna que essa pessoa não tem.
 */
export const SEM_BACKEND =
  "Vídeo sem legenda e nenhum transcritor instalado. `pip install -U openai-whisper` " +
  "funciona em qualquer sistema; em Apple Silicon `uv tool install mlx-whisper` é mais " +
  "rápido. Ou rode o instalador de novo (install/instalar.sh no macOS/Linux, " +
  "install\\instalar.ps1 no Windows).";

/** Diagnóstico para o `npm run doctor`. */
export async function transcricaoDoctor(): Promise<{ ok: boolean; linhas: string[] }> {
  const linhas: string[] = [];
  const temFfmpeg = noPath("ffmpeg");
  const backend = await detectarBackend();

  // Nomes curtos: esta lista é impressa numa linha só. A única exceção é o
  // whisper.cpp sem modelo, porque aí o aviso É a informação útil — o binário
  // está lá e mesmo assim não transcreve.
  if (await temMlx()) linhas.push("mlx-whisper");
  if (noPath("whisper")) linhas.push("whisper CLI");
  const bin = binWhisperCpp();
  if (bin) linhas.push(modeloWhisperCpp() ? bin : `${bin} (sem o modelo ggml)`);

  return { ok: temFfmpeg && backend !== null, linhas };
}
