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

/** O que um job em execução carrega para todo await dentro dele. */
export interface ContextoDeJob {
  jobId: string;
  signal: AbortSignal;
  /** Filhos vivos deste job — mortos em grupo quando o signal aborta. */
  filhos: Set<ChildProcess>;
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
  const ctx: ContextoDeJob = { ...raiz, filhos: new Set() };
  ctx.signal.addEventListener(
    "abort",
    () => {
      for (const filho of ctx.filhos) matarGrupoDoFilho(filho);
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

/** Mata o GRUPO do filho (filho + netos): SIGTERM, e SIGKILL após o grace. */
function matarGrupoDoFilho(filho: ChildProcess): void {
  const pid = filho.pid;
  if (pid === undefined) return;
  const sinalGrupo = (sinal: NodeJS.Signals) => {
    if (process.platform === "win32") {
      filho.kill(sinal);
    } else {
      // `-pid` = o grupo inteiro. Só funciona porque quem spawnou usou
      // `detached` (ver FILHO_EM_GRUPO_PROPRIO) — sem isso, `-pid` miraria o
      // grupo do PRÓPRIO SERVIDOR, o oposto do invarianto B.
      process.kill(-pid, sinal);
    }
  };
  try {
    sinalGrupo("SIGTERM");
  } catch {
    /* grupo já não existe — nada a fazer */
  }
  const escalada = setTimeout(() => {
    try {
      sinalGrupo("SIGKILL");
    } catch {
      /* já morreu com o SIGTERM */
    }
  }, GRACE_SIGKILL_MS);
  escalada.unref();
}

/**
 * Todo processo criado dentro de um job passa por aqui (yt-dlp, whisper,
 * claude, codex…). Sem contexto de job, é no-op — processo de fora de job
 * (doctor, availability) não é alvo de cancelamento NENHUM.
 */
export function registrarFilho(filho: ChildProcess): void {
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
 */
const filhosConhecidos = new Set<ChildProcess>();

function matarFilhosConhecidos(): void {
  for (const filho of filhosConhecidos) matarGrupoDoFilho(filho);
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

garantirLimpezaDeFilhosNoFim();
