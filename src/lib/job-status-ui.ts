/**
 * Lógica pura de UI para os status de job — sem React, sem rede, testável
 * com node:test. Os três pontos que renderizam um job (lista /processing,
 * cards da home, detalhe do vídeo) bebem daqui: uma tabela só, para nenhum
 * deles cair no fallback silencioso de `queued` quando um status novo
 * aparecer (INVARIANTE T1).
 *
 * `canceled` chegou na ETAPA 1 (back-end): job cancelado pelo usuário ou
 * por duplicata tardia (link curto que virou job depois de outro igual).
 */
import type { Job, JobProgressEvent } from "@/lib/api-types";

/** O união canônico de status — derivado do tipo que a API entrega. */
export type StatusDeJob = Job["status"];

/** Rótulo PT-BR de cada status (pílula, título de card, resumo). */
export const ROTULO_DE_STATUS: Record<StatusDeJob, string> = {
  queued: "Na fila",
  running: "Processando",
  done: "Concluído",
  error: "Erro",
  canceled: "Cancelado",
};

/**
 * Classes da pílula de status. `canceled` é NEUTRO (muted, igual a `queued`)
 * de propósito: cancelamento não é erro — vermelho é reserva do `error`.
 */
export const ESTILO_DE_STATUS: Record<StatusDeJob, string> = {
  queued: "bg-muted text-muted-foreground",
  running: "bg-primary/20 text-primary",
  done: "bg-emerald-500/20 text-emerald-400",
  error: "bg-destructive/20 text-destructive",
  canceled: "bg-muted text-muted-foreground",
};

/** Só job ativo pode ser cancelado — terminal é terminal. */
export function podeCancelar(status: string): boolean {
  return status === "queued" || status === "running";
}

/**
 * Confirmação EM LINHA só para job rodando: matar um processamento em meio
 * perde o trabalho das etapas que faltam. Job na fila ainda não começou —
 * cancela direto, sem cerimônia.
 */
export function precisaConfirmarCancelamento(status: string): boolean {
  return status === "running";
}

/**
 * O status que a UI decide (INVARIANTE E1c): o evento de SSE é sempre mais
 * novo que a prop `job` que veio do servidor — um job renderizado como
 * `queued` pode JÁ estar `running` (e um `running` já pode ser terminal).
 * Nenhum componente decide comportamento a partir de status que pode estar
 * velho: decide a partir daqui.
 */
export function statusEfetivo(
  progressStatus: string | null | undefined,
  jobStatus: string,
): string {
  return progressStatus ?? jobStatus;
}

/**
 * O progresso devolvido pertence SEMPRE ao `jobId` pedido (INVARIANTE P1):
 * o `useJobProgress` guarda o último evento de SSE que chegou — sem este
 * filtro, o evento TERMINAL de um job A continuava vivo quando o componente
 * passou a acompanhar um job B (reprocessamento), e o `statusEfetivo`
 * aplicava `done`/`error`/`canceled` ao job novo (escondendo o botão
 * Cancelar de um job que está na fila). Dono errado ou sem dono → null.
 */
export function progressoDoJob(
  progress: JobProgressEvent | null | undefined,
  jobId: string | null,
): JobProgressEvent | null {
  if (!progress || !jobId) return null;
  return progress.jobId === jobId ? progress : null;
}

/** O corpo da resposta 409 de POST /api/videos e /api/videos/[id]/retry. */
export interface Resposta409 {
  readonly error?: string;
  readonly duplicate?: boolean;
  readonly jobId?: string | null;
  readonly videoId?: string;
}

/**
 * Classifica o 409 de duplicata em "ja-na-fila" × "ja-processado". O sinal
 * é o `jobId`: a duplicata ATIVA (vídeo queued/running) vem com ele; o
 * "já processado" (catálogo) não tem job para apontar.
 */
export function classificarResposta409(
  dados: Resposta409 | null | undefined,
): "ja-na-fila" | "ja-processado" | null {
  if (!dados || dados.duplicate !== true) return null;
  return dados.jobId ? "ja-na-fila" : "ja-processado";
}

/**
 * O texto que o card mostra para um job `canceled`: a mensagem do job vence
 * quando existe (duplicata tardia — "Duplicado: este vídeo já está sendo
 * processado em outro job"); sem mensagem, é cancelamento pedido pelo
 * próprio usuário e "Cancelado" basta.
 */
export function textoDeCancelado(errorMessage: string | null | undefined): string {
  return errorMessage ?? "Cancelado";
}

/** O necessário de um item do resumo do lote para dividir os duplicados. */
export interface DuplicadoContavel {
  readonly status: string;
  readonly jobId?: string;
}

export interface DivisaoDeDuplicados {
  readonly noCatalogo: number;
  readonly jaNaFila: number;
}

/**
 * Divide os itens `duplicado` do resumo do lote entre catálogo (sem jobId) e
 * fila (com jobId) — para o toast não chamar de "já no catálogo" um vídeo
 * que na verdade está sendo processado.
 */
export function dividirDuplicados(
  itens: readonly DuplicadoContavel[],
): DivisaoDeDuplicados {
  let noCatalogo = 0;
  let jaNaFila = 0;
  for (const item of itens) {
    if (item.status !== "duplicado") continue;
    if (item.jobId) jaNaFila++;
    else noCatalogo++;
  }
  return { noCatalogo, jaNaFila };
}

/**
 * URL encurtada para nomes acessíveis ("Cancelar processamento de <url>"):
 * tira scheme e www, corta no máximo com reticências.
 */
export function resumirUrl(url: string, max = 28): string {
  const limpa = url.replace(/^https?:\/\//, "").replace(/^www\./, "");
  if (limpa.length <= max) return limpa;
  return `${limpa.slice(0, max - 1)}…`;
}
