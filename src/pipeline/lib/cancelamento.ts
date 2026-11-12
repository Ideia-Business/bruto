/**
 * Cancelamento de job — o mecanismo, não a rota.
 *
 * O pipeline tem meia dúzia de pontos que criam subprocesso ou conexão longa
 * (yt-dlp, whisper local, `claude`, `codex`, Chromium do export, `fetch` dos
 * provedores HTTP). Passar um "signal" por parâmetro por seis etapas é o
 * desenho que esquece um ponto — a classe do bug volta. Em vez disso, o
 * `processJob` abre UM contexto (`AsyncLocalStorage`) com `{ jobId, signal }`
 * e TODO spawn/fetch que roda dentro dele se registra aqui, sem mudar de
 * assinatura. Cancelar é abortar o signal: cada filho registrado morre com o
 * GRUPO dele (filho + netos, ex.: ffmpeg/python que o filho lançou), e cada
 * `fetch` embutido se aborta junto.
 *
 * Fora de um job (doctor, `availability()` dos provedores, CLI) o registro é
 * no-op: cancelamento de job não toca processo que não pertence a job nenhum.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { ChildProcess } from "node:child_process";
// Import RELATIVO de propósito: este módulo é importado por caminho absoluto
// em fixtures de teste, onde alias `@/` não resolve — e a marca não tem
// dependência nenhuma (o estado dela é globalThis, não instância de módulo).
import { encerramentoEmAndamento } from "./marca-de-encerramento";

/** O que um job em execução carrega para todo await dentro dele. */
export interface ContextoDeJob {
  jobId: string;
  signal: AbortSignal;
  /** Filhos vivos deste job — mortos em grupo quando o signal aborta. */
  filhos: Set<ChildProcess>;
  /**
   * Ações de cancelamento que não são subprocesso (ex.: `browser.close()` do
   * Chromium compartilhado) — executadas quando o signal aborta.
   */
  acoes: Set<() => void>;
}

const storage = new AsyncLocalStorage<ContextoDeJob>();

/** Grace period entre SIGTERM e SIGKILL no grupo do filho cancelado. */
const GRACE_SIGKILL_MS = 2_000;

/**
 * POSIX: filho em grupo próprio para poder matar filho E netos com um sinal
 * (constante avaliada uma vez por processo; no Windows não existe grupo —
 * `detached` lá abriria janela de console nova, e o kill cai no filho direto).
 * Exportada para TODO ponto de spawn do pipeline usar o MESMO critério.
 */
export const FILHO_EM_GRUPO_PROPRIO = process.platform !== "win32";

/** O contexto do job atual, se este código estiver rodando dentro de um. */
export function contextoDeJob(): ContextoDeJob | undefined {
  return storage.getStore();
}

/**
 * Abre o contexto de cancelamento em volta de `fn` (o `processJob` chama isto
 * uma vez; tudo que `fn` aguarda — steps, deps injetadas, spawns — herda).
 */
export function rodarComCancelamento<T>(
  raiz: { jobId: string; signal: AbortSignal },
  fn: () => Promise<T>,
): Promise<T> {
  const ctx: ContextoDeJob = { ...raiz, filhos: new Set(), acoes: new Set() };
  ctx.signal.addEventListener(
    "abort",
    () => {
      for (const filho of ctx.filhos) matarGrupoDoFilho(filho);
      for (const acao of ctx.acoes) acao();
    },
    { once: true },
  );
  return storage.run(ctx, fn);
}

/** Erro interno: o job foi cancelado — nada abaixo deve continuar. */
export class JobCanceladoError extends Error {
  constructor() {
    super("job cancelado");
    this.name = "JobCanceladoError";
  }
}

/**
 * O checkpoint entre etapas: se o job foi cancelado, aborta o que vieria
 * depois. Chamar logo após cada `await` longo do pipeline — é o que impede o
 * job de gravar `done` (ou qualquer etapa) depois de um cancelamento que
 * chegou no meio de um await que nada escuta.
 */
export function recusarSeCancelado(signal: AbortSignal | null | undefined): void {
  if (signal?.aborted) throw new JobCanceladoError();
}

/**
 * Manda `sinal` ao GRUPO do filho (filho + netos): `-pid` = o grupo inteiro.
 * Só funciona porque quem spawnou usou `detached` (ver
 * FILHO_EM_GRUPO_PROPRIO) — sem isso, `-pid` miraria o grupo do PRÓPRIO
 * SERVIDOR, o oposto do invarianto B. Retorna false se o alvo já não existe
 * (grupo sumido, pid ausente) — "nada a fazer" não é erro.
 */
function sinalNoGrupoDoFilho(filho: ChildProcess, sinal: NodeJS.Signals): boolean {
  const pid = filho.pid;
  if (pid === undefined) return false;
  try {
    if (process.platform === "win32") {
      filho.kill(sinal);
    } else {
      process.kill(-pid, sinal);
    }
    return true;
  } catch {
    return false; // grupo já não existe — nada a fazer
  }
}

/** Mata o GRUPO do filho (filho + netos): SIGTERM, e SIGKILL após o grace. */
function matarGrupoDoFilho(filho: ChildProcess): void {
  sinalNoGrupoDoFilho(filho, "SIGTERM");
  const escalada = setTimeout(() => {
    sinalNoGrupoDoFilho(filho, "SIGKILL");
  }, GRACE_SIGKILL_MS);
  escalada.unref();
}

/**
 * Todo processo criado dentro de um job passa por aqui (yt-dlp, whisper,
 * claude, codex…). Sem contexto de job, é no-op — processo de fora de job
 * (doctor, availability) não é alvo de cancelamento NENHUM.
 *
 * Com a marca de encerramento LIGADA, o filho nascido tarde demais NÃO é
 * registrado: a limpeza já fez o retrato do lote dela — entrar na lista agora
 * seria sobreviver a toda matança (o handler de `exit` limpou a lista antes,
 * e a próxima limpeza pode não vir). Morre AGORA, com SIGKILL síncrono no
 * GRUPO (filho + netos que ele já lançou).
 */
export function registrarFilho(filho: ChildProcess): void {
  if (encerramentoEmAndamento()) {
    sinalNoGrupoDoFilho(filho, "SIGKILL");
    return;
  }
  // A rede de segurança de shutdown também precisa dele (ver abaixo).
  filhosConhecidos.add(filho);
  filho.once("close", () => {
    filhosConhecidos.delete(filho);
  });

  const ctx = storage.getStore();
  if (!ctx) return;
  if (ctx.signal.aborted) {
    // Cancelamento chegou entre o spawn e o registro: mata agora.
    matarGrupoDoFilho(filho);
    return;
  }
  ctx.filhos.add(filho);
  filho.once("close", () => ctx.filhos.delete(filho));
}

/**
 * Registra uma ação de cancelamento para o job corrente — para recursos que
 * não são subprocesso (o Chromium do export é parado por `browser.close()`,
 * não por sinal de processo). Sem contexto de job, é no-op: recurso de fora
 * de job (doctor, `availability()`) não é alvo de cancelamento NENHUM.
 *
 * INVARIANTE E1: um registro que não pode surtir efeito falha ALTO — aqui na
 * hora do registro, não no dia em que o cancelamento precisar dele. Por isso
 * o parâmetro é uma função PLENA (não um "talvez método" opcional): quem
 * registra algo inefetivo descobre agora, com exceção.
 */
export function registrarAcaoDeCancelamento(acao: () => void): void {
  if (typeof acao !== "function") {
    throw new TypeError("registrarAcaoDeCancelamento exige uma função executável");
  }
  const ctx = storage.getStore();
  if (!ctx) return;
  if (ctx.signal.aborted) {
    // Cancelamento chegou entre a criação do recurso e o registro: age agora.
    acao();
    return;
  }
  ctx.acoes.add(acao);
}

/**
 * Vincula um AbortController local (timeout de fetch, etc.) ao signal do job
 * corrente: cancelar o job aborta a chamada de rede em andamento. Retorna a
 * função que desvincula (chamar quando a chamada terminar).
 */
export function vincularAoSinalDoJob(controller: AbortController): () => void {
  const sinal = storage.getStore()?.signal;
  if (!sinal) return () => {};
  if (sinal.aborted) {
    controller.abort();
    return () => {};
  }
  const aoAbortar = () => controller.abort();
  sinal.addEventListener("abort", aoAbortar, { once: true });
  return () => sinal.removeEventListener("abort", aoAbortar);
}

// ─────────────────────────────────────────────────────────────────────────────
// Rede de segurança de shutdown
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Filho em grupo próprio (`detached`) NÃO recebe o SIGINT/SIGHUP que o
 * terminal manda para o grupo do servidor — sem compensação, um Ctrl+C no
 * `next dev` deixaria yt-dlp/whisper órfãos rodando até terminarem sozinhos
 * (regressão de comportamento que o grupo próprio introduziria). Aqui é o
 * outro lado do contrato: quem o servidor lançou, o servidor mata ao sair.
 *
 * A lista vive em `globalThis` (o mesmo truque da marca de encerramento e do
 * RunnerState): o Next empacota a instrumentação do boot e cada rota em
 * bundles PRÓPRIOS, cada um com a SUA instância deste módulo. Uma lista por
 * instância deixava a limpeza de um bundle cega aos filhos que o outro
 * bundle registrou (o achado [P2] da r4: filhos do re-enfileiramento do boot
 * vs. rota `/api/encerrar`). Agora é UMA lista por PROCESSO — o botão
 * "Encerrar" e a rede de segurança do `exit` veem TODO filho registrado.
 */
const globalForFilhos = globalThis as unknown as {
  __brutoFilhosConhecidos?: Set<ChildProcess>;
};
const filhosConhecidos: Set<ChildProcess> =
  globalForFilhos.__brutoFilhosConhecidos ?? new Set<ChildProcess>();
globalForFilhos.__brutoFilhosConhecidos = filhosConhecidos;

/**
 * Mata o GRUPO de todo filho registrado ainda vivo — SÍNCRONO, com SIGKILL
 * direto. É o código que o handler de `exit` roda (e o que os de
 * SIGINT/SIGTERM/SIGHUP correm antes de levarem ao `exit`): depois do `exit`
 * NENHUM timer dispara, então o desenho "SIGTERM agora, SIGKILL após o
 * grace" aqui era uma promessa que o processo não cumpria — filho que ignora
 * SIGTERM sobrevivia à própria saída [P2, r4]. `process.kill(-pid,
 * "SIGKILL")` é síncrono e funciona dentro do `exit`. O grace (SIGTERM →
 * espera → SIGKILL) continua existindo onde o event loop está VIVO: no
 * cancelamento de job (`matarGrupoDoFilho`) e no botão "Encerrar"
 * (`encerrarFilhosRegistrados`).
 */
function matarFilhosConhecidos(): void {
  for (const filho of filhosConhecidos) sinalNoGrupoDoFilho(filho, "SIGKILL");
  filhosConhecidos.clear();
}

let redeInstalada = false;

/** Instala (uma vez por processo) a limpeza de filhos no fim da vida dele. */
export function garantirLimpezaDeFilhosNoFim(): void {
  if (redeInstalada) return;
  redeInstalada = true;
  process.on("exit", matarFilhosConhecidos);
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    const aoReceber = () => {
      matarFilhosConhecidos();
      process.removeListener(sig, aoReceber);
      // Devolve o sinal ao comportamento default: se ninguém mais escuta, o
      // processo morre como morreria sem nós (Ctrl+C continua funcionando).
      if (process.listenerCount(sig) === 0) process.kill(process.pid, sig);
    };
    process.on(sig, aoReceber);
  }
}

/**
 * Teto de espera depois do SIGKILL: `encerrarFilhosRegistrados` resolve no
 * máximo em `graceMs + 1 s` — o desligamento do app não pendura em filho
 * que nem SIGKILL no grupo derrubou.
 */
const TETO_APOS_SIGKILL_MS = 1_000;

/** Resolve quando o set esvazia (todos os filhos saíram) ou no prazo — o que vier primeiro. */
function esperarSairem(vivos: Set<ChildProcess>, prazoMs: number): Promise<void> {
  return new Promise((resolve) => {
    if (vivos.size === 0) return resolve();
    const conferir = setInterval(() => {
      if (vivos.size === 0) {
        clearInterval(conferir);
        clearTimeout(teto);
        resolve();
      }
    }, 20);
    const teto = setTimeout(() => {
      clearInterval(conferir);
      resolve(); // prazo: seguir o desligamento vale mais que esperar o impossível
    }, prazoMs);
  });
}

/**
 * Encerra TODO filho registrado com o event loop VIVO — o caminho do botão
 * "Encerrar o Bruto" (`encerrarAgora`), não o do `exit`.
 *
 * Por que não o handler de `exit`: depois do `exit` nenhum timer dispara, e
 * o SIGKILL que `matarGrupoDoFilho` agenda para o grace nunca era enviado —
 * um filho que ignora SIGTERM (yt-dlp/whisper/ffmpeg travado) ficava vivo
 * depois de o app dizer que encerrou [P2]. Aqui a limpeza TERMINA antes de
 * sair: SIGTERM no GRUPO de cada filho, espera até o grace (ou todos
 * saírem), SIGKILL no grupo de quem sobrou, e resolve quando todos saíram —
 * ou no teto (`graceMs + TETO_APOS_SIGKILL_MS`), sem pendurar.
 *
 * O lote é tirado do registro na hora (chamadas a mais são no-op); filho que
 * nascer durante a espera morre NO PRÓPRIO registro — a marca de
 * encerramento está ligada e `registrarFilho` mata em vez de registrar — e o
 * que escapar disso é da rede de segurança do `exit` (SIGKILL síncrono).
 * Jobs interrompidos NÃO são marcados como cancelados — o boot os
 * re-enfileira. Nunca rejeita: em encerramento não há quem trate erro; quem
 * sobrar é do handler de `exit`.
 */
export async function encerrarFilhosRegistrados(graceMs: number = GRACE_SIGKILL_MS): Promise<void> {
  const filhos = Array.from(filhosConhecidos);
  filhosConhecidos.clear();
  if (filhos.length === 0) return;

  // `close` = processo saiu E foi reaped: o PID sumiu de verdade.
  const vivos = new Set<ChildProcess>(filhos);
  for (const filho of filhos) {
    filho.once("close", () => vivos.delete(filho));
  }

  for (const filho of vivos) sinalNoGrupoDoFilho(filho, "SIGTERM");
  await esperarSairem(vivos, graceMs);

  for (const filho of vivos) sinalNoGrupoDoFilho(filho, "SIGKILL");
  await esperarSairem(vivos, TETO_APOS_SIGKILL_MS);
}

garantirLimpezaDeFilhosNoFim();
