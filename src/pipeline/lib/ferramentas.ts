/**
 * ferramentas.ts — o módulo ÚNICO de resolução e preparação das ferramentas
 * externas do pacote (contrato-instalador.md, INVARIANTE DO PACOTE).
 *
 * Dois modos:
 *
 *  - CLONE (comportamento histórico, INVARIANTE F2): `caminhoDe` devolve o
 *    nome nu e quem resolve é o PATH, como sempre foi. `garantir*` é no-op.
 *
 *  - PACOTE (`BRUTO_EMPACOTADO=1`, INVARIANTE F1): ffmpeg/ffprobe/uv vêm das
 *    variáveis do contrato (`BRUTO_FFMPEG`/`BRUTO_FFPROBE`/`BRUTO_UV`) e o que
 *    o `uv` instala (yt-dlp, whisper) vem de `$BRUTO_FERRAMENTAS/bin/<nome>` —
 *    sempre caminho ABSOLUTO, NUNCA o PATH. O PATH existe só para `claude`/
 *    `codex` (e o `python3` de quem usa), que são ferramentas DO USUÁRIO, não
 *    do pacote — por isso não passam por aqui.
 *
 * Variável do contrato ausente em modo pacote é erro ALTO na hora (o lançador
 * está quebrado; esconder atrás de um fallback de PATH reintroduziria a classe
 * de bug que a F1 existe para fechar: o Homebrew da máquina mascarando
 * dependência esquecida).
 *
 * Preparação sob demanda (INVARIANTE F3): yt-dlp, Chromium e Whisper se
 * instalam via `uv`/CLI do Playwright com (a) teto de tempo, (b) UMA promessa
 * compartilhada — dois jobs nunca disparam duas instalações — e (c) o processo
 * registrado no cancelamento do job (`registrarFilho`), então cancelar o job
 * mata a instalação em andamento. Falha vira erro tipado e legível, nunca job
 * preso; e a promessa NÃO fica cacheada no fracasso (a tentativa seguinte
 * reinstala).
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { FILHO_EM_GRUPO_PROPRIO, registrarFilho } from "@/pipeline/lib/cancelamento";
import { pythonDaFerramentaUv } from "@/pipeline/lib/binario";
import { PipelineError } from "@/pipeline/types";

/** Verdade quando o servidor roda dentro do Bruto.app (o lançador define "1"). */
export function modoPacote(): boolean {
  return process.env.BRUTO_EMPACOTADO === "1";
}

/** Ferramentas do pacote com variável PRÓPRIA no contrato. */
const VARIAVEL_DIRETA: Record<string, string> = {
  ffmpeg: "BRUTO_FFMPEG",
  ffprobe: "BRUTO_FFPROBE",
  uv: "BRUTO_UV",
};

/**
 * O caminho de uma ferramenta. Modo clone: o nome nu (PATH). Modo pacote:
 * caminho absoluto a partir das variáveis do contrato — `BRUTO_FFMPEG`/
 * `BRUTO_FFPROBE`/`BRUTO_UV` para as que vêm dentro do `.app`, e
 * `$BRUTO_FERRAMENTAS/bin/<nome>` para as instaladas pelo `uv` (yt-dlp,
 * whisper).
 */
export function caminhoDe(nome: string): string {
  if (!modoPacote()) return nome;
  const variavel = VARIAVEL_DIRETA[nome];
  if (variavel) {
    const valor = process.env[variavel];
    if (!valor) {
      throw new Error(
        `modo pacote sem ${variavel} definida — o lançador do Bruto.app está quebrado`,
      );
    }
    return valor;
  }
  const base = process.env.BRUTO_FERRAMENTAS;
  if (!base) {
    throw new Error(
      "modo pacote sem BRUTO_FERRAMENTAS definida — o lançador do Bruto.app está quebrado",
    );
  }
  return path.join(base, "bin", nome);
}

/** Existe e é executável? (o mesmo critério de `binario.ts`) */
function executavel(caminho: string): boolean {
  try {
    fs.accessSync(caminho, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// ── execução de instalação, com teto e cancelamento (F3) ────────────────────

/**
 * Roda o instalador (uv, ou o node da CLI do Playwright) com teto de tempo e
 * registro de cancelamento: se o processo rodar DENTRO de um job, cancelar o
 * job o mata em grupo. Rejeita em timeout ou exit != 0 com o rabo do stderr.
 */
function rodarInstalacao(cmd: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      shell: false,
      detached: FILHO_EM_GRUPO_PROPRIO,
      // As variáveis UV_* e PLAYWRIGHT_BROWSERS_PATH chegam pelo ambiente do
      // processo (o lançador as define) — o filho herda.
    });
    registrarFilho(child);

    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      // Mata o GRUPO (o instalador e os netos dele — ex.: o downloader que o
      // uv abre): o filho é `detached`, então o sinal no `-pid` pega todos.
      // Sem isto, o neto vivo segura os pipes e o "close" nunca chega.
      if (process.platform !== "win32" && child.pid !== undefined) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      } else {
        child.kill("SIGKILL");
      }
    }, timeoutMs);

    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`a preparação excedeu o teto de ${Math.round(timeoutMs / 1000)}s`));
        return;
      }
      if (code !== 0) {
        reject(new Error(stderr.trim().slice(-300) || `exit ${code}`));
        return;
      }
      resolve();
    });
  });
}

// ── yt-dlp: instala no primeiro uso, atualiza no máximo 1×/7 dias ───────────

/** Marca de tempo do upgrade semanal, em $BRUTO_FERRAMENTAS. */
const MARCA_UPGRADE_YTDLP = "yt-dlp-atualizado-em.txt";
const SETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000;
const TIMEOUT_YTDLP_MS = 10 * 60 * 1000;

const MSG_FALHA_YTDLP =
  "Não foi possível preparar o baixador de vídeos (yt-dlp). " +
  "Verifique a internet e tente de novo.";

let instalacaoYtDlp: Promise<void> | null = null;
let upgradeYtDlp: Promise<void> | null = null;

function caminhoMarcaUpgrade(): string {
  // caminhoDe já validou BRUTO_FERRAMENTAS em modo pacote — mas a marca pode
  // ser pedida antes de qualquer resolução, então valida de novo na cara.
  const base = process.env.BRUTO_FERRAMENTAS;
  if (!base) throw new Error("modo pacote sem BRUTO_FERRAMENTAS definida");
  return path.join(base, MARCA_UPGRADE_YTDLP);
}

function marcaDeUpgradeRecente(): boolean {
  try {
    const em = Number(fs.readFileSync(caminhoMarcaUpgrade(), "utf8").trim());
    return Number.isFinite(em) && Date.now() - em < SETE_DIAS_MS;
  } catch {
    return false;
  }
}

/**
 * Carimba "tentei agora" ANTES de rodar o upgrade: o contrato é "no máximo
 * uma vez a cada 7 dias" — uma máquina sem internet não pode pagar um upgrade
 * falho por job, então a falha também gasta a vez.
 */
function carimbarUpgradeAgora(): void {
  try {
    fs.mkdirSync(path.dirname(caminhoMarcaUpgrade()), { recursive: true });
    fs.writeFileSync(caminhoMarcaUpgrade(), String(Date.now()));
  } catch {
    // a marca é conveniência de cadência; não poder gravá-la não impede o job
  }
}

function talvezAtualizarYtDlp(timeoutMs: number): Promise<void> {
  if (marcaDeUpgradeRecente()) return Promise.resolve();
  carimbarUpgradeAgora();
  if (!upgradeYtDlp) {
    upgradeYtDlp = rodarInstalacao(caminhoDe("uv"), ["tool", "upgrade", "yt-dlp"], timeoutMs)
      .catch((err) => {
        // Upgrade falho NÃO derruba o job: a ferramenta instalada funciona.
        console.warn(
          `[bruto] upgrade semanal do yt-dlp falhou (a versão instalada segue em uso): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      })
      .finally(() => {
        upgradeYtDlp = null;
      });
  }
  return upgradeYtDlp;
}

/**
 * Garante o yt-dlp antes do primeiro job que precisa dele (modo pacote):
 * instala com `"$BRUTO_UV" tool install yt-dlp` se ausente e roda o upgrade
 * semanal se a marca estiver velha. Modo clone: no-op (o yt-dlp vem do PATH,
 * como sempre). Falha de INSTALAÇÃO vira PipelineError legível; falha de
 * upgrade é só warning.
 */
export async function garantirYtDlp(opcoes: { timeoutMs?: number } = {}): Promise<void> {
  if (!modoPacote()) return;
  const timeoutMs = opcoes.timeoutMs ?? TIMEOUT_YTDLP_MS;
  if (!executavel(caminhoDe("yt-dlp"))) {
    if (!instalacaoYtDlp) {
      const p = (async () => {
        try {
          await rodarInstalacao(caminhoDe("uv"), ["tool", "install", "yt-dlp"], timeoutMs);
          // Recém-instalado = atualizado: a marca nasce fresca.
          carimbarUpgradeAgora();
        } catch {
          throw new PipelineError("UNKNOWN", MSG_FALHA_YTDLP);
        } finally {
          instalacaoYtDlp = null;
        }
      })();
      instalacaoYtDlp = p;
    }
    await instalacaoYtDlp;
  }
  await talvezAtualizarYtDlp(timeoutMs);
}

// ── Chromium do export: instala no primeiro export ───────────────────────────

const TIMEOUT_CHROMIUM_MS = 15 * 60 * 1000;

const MSG_FALHA_CHROMIUM =
  "Não foi possível preparar o navegador interno (Chromium) para gerar os arquivos de estudo. " +
  "Verifique a internet e tente de novo.";

let instalacaoChromium: Promise<void> | null = null;

function diretorioDosNavegadores(): string {
  // O lançador define PLAYWRIGHT_BROWSERS_PATH; o default do contrato é
  // $BRUTO_FERRAMENTAS/ms-playwright (cobre testes e usos fora do lançador).
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) return process.env.PLAYWRIGHT_BROWSERS_PATH;
  const base = process.env.BRUTO_FERRAMENTAS;
  if (!base) throw new Error("modo pacote sem BRUTO_FERRAMENTAS definida");
  return path.join(base, "ms-playwright");
}

/**
 * Marca de "o headless shell está garantido neste PLAYWRIGHT_BROWSERS_PATH",
 * escrita por nós depois de cada instalação bem-sucedida. Vive DENTRO do
 * diretório dos navegadores: se o diretório for apagado, a marca some junto
 * e a próxima garantia reinstala.
 *
 * Por que uma marca, e não varrer o diretório atrás de
 * `chromium_headless_shell-*`: `readdirSync` com caminho dinâmico faz o
 * tracer do build standalone varrer o projeto inteiro atrás de arquivo
 * (warning do Turbopack, medido nesta lane). A marca é `existsSync`, que o
 * tracer aceita sem varredura — e a CLI do Playwright é idempotente: numa
 * máquina onde o navegador já exista sem a nossa marca, a primeira garantia
 * roda a CLI, ela constata "já instalado" sem baixar nada, e a marca nasce.
 */
const MARCA_CHROMIUM = ".bruto-chromium-headless-shell-instalado";

function caminhoMarcaChromium(): string {
  return path.join(diretorioDosNavegadores(), MARCA_CHROMIUM);
}

function chromiumHeadlessShellPresente(): boolean {
  return fs.existsSync(caminhoMarcaChromium());
}

/**
 * Garante o Chromium headless antes de `chromium.launch` (modo pacote):
 * instala com `"$BRUTO_NODE" "$BRUTO_PLAYWRIGHT_CLI" install
 * chromium-headless-shell` se ausente. Modo clone: no-op — igual a hoje, o
 * Playwright usa o que já está instalado na máquina.
 */
export async function garantirChromium(opcoes: { timeoutMs?: number } = {}): Promise<void> {
  if (!modoPacote()) return;
  if (chromiumHeadlessShellPresente()) return;
  if (!instalacaoChromium) {
    const timeoutMs = opcoes.timeoutMs ?? TIMEOUT_CHROMIUM_MS;
    const p = (async () => {
      try {
        const node = process.env.BRUTO_NODE;
        const cli = process.env.BRUTO_PLAYWRIGHT_CLI;
        if (!node || !cli) {
          throw new Error("modo pacote sem BRUTO_NODE/BRUTO_PLAYWRIGHT_CLI definidas");
        }
        await rodarInstalacao(node, [cli, "install", "chromium-headless-shell"], timeoutMs);
        if (!chromiumHeadlessShellPresente()) {
          throw new Error("a instalação terminou sem deixar o Chromium no lugar esperado");
        }
      } catch {
        throw new PipelineError("UNKNOWN", MSG_FALHA_CHROMIUM);
      } finally {
        instalacaoChromium = null;
      }
    })();
    instalacaoChromium = p;
  }
  return instalacaoChromium;
}

// ── Whisper: só instala quando a pessoa pede (~2 GB) ─────────────────────────

const TIMEOUT_WHISPER_MS = 30 * 60 * 1000;

let instalacaoWhisper: Promise<void> | null = null;

/**
 * O Whisper está instalado? Detecção barata (só filesystem): o venv do
 * `uv tool install mlx-whisper` (o backend preferido do app) ou a CLI
 * `whisper` instalada pelo uv. Cara demais seria sondar o Python — a sonda
 * fica em `transcribe.ts`, memoizada, e é rearmada depois da instalação.
 */
export function whisperInstalado(): boolean {
  if (!modoPacote()) return false;
  if (pythonDaFerramentaUv("mlx-whisper") !== null) return true;
  return executavel(caminhoDe("whisper"));
}

/**
 * Instala o backend de transcrição sob pedido (endpoint das Configurações):
 * `"$BRUTO_UV" tool install mlx-whisper` (~2 GB de modelo e dependências — o
 * aviso é da UI). Modo clone: rejeita — lá quem instala é o instalador do
 * repositório, não o app. UMA instalação por vez, com teto e cancelamento.
 */
export function instalarWhisper(opcoes: { timeoutMs?: number } = {}): Promise<void> {
  if (!modoPacote()) {
    return Promise.reject(
      new Error("A instalação sob pedido só existe no app instalado (.app)."),
    );
  }
  if (whisperInstalado()) return Promise.resolve();
  if (!instalacaoWhisper) {
    const timeoutMs = opcoes.timeoutMs ?? TIMEOUT_WHISPER_MS;
    const p = (async () => {
      try {
        await rodarInstalacao(caminhoDe("uv"), ["tool", "install", "mlx-whisper"], timeoutMs);
      } catch {
        throw new Error(
          "Não foi possível instalar a transcrição local (Whisper). " +
            "Verifique a internet e tente de novo.",
        );
      } finally {
        instalacaoWhisper = null;
      }
    })();
    instalacaoWhisper = p;
  }
  return instalacaoWhisper;
}

// ── apoio de teste ───────────────────────────────────────────────────────────

/**
 * Esquece as promessas de preparação em andamento/concluídas. SÓ para testes:
 * produção nunca rearma — a promessa compartilhada é o que impede duas
 * instalações concorrentes (F3).
 */
export function __rearmarParaTestes(): void {
  instalacaoYtDlp = null;
  upgradeYtDlp = null;
  instalacaoChromium = null;
  instalacaoWhisper = null;
}
