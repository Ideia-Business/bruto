/**
 * Encerrar o Bruto pelo próprio app (demanda 43fe2879) — a LÓGICA, fora da
 * rota, com dependências injetáveis para o teste nunca precisar do
 * `process.exit` real.
 *
 * Por que um botão: a janela do app é o Chrome em `--app` — o ⌘Q fecha a
 * janela (e o Chrome), nunca o servidor, que segue ocupando a porta até a
 * pessoa reiniciar o Mac (ADR 0005). O botão desliga o servidor DESTE
 * processo e libera a porta; abrir de novo é papel do lançador.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O CICLO DE ENCERRAMENTO COMPLETO (desenhado na 4ª rodada). A correção da
 * 3ª — esperar os filhos com o event loop vivo — criou os dois buracos
 * daqui: a espera abriu uma janela em que um SEGUNDO pedido confirmava junto
 * e dava `exit` antes do SIGKILL do primeiro [P2], e a morte dos filhos
 * rejeitava a etapa do job, que o runner gravava como `error` — estado que o
 * boot não ressuscita, quebrando a promessa do botão ("vídeos que estiverem
 * processando retomam") [P1].
 *
 * SEQUÊNCIA — nesta ordem, dentro da operação ÚNICA:
 *   (a) marcar o runner como "encerrando" (`marcarEncerramento`, em
 *       pipeline/lib/marca-de-encerramento.ts): a fila (`drain`, em
 *       runner.ts) para de começar jobs novos no mesmo instante — o job que
 *       já roda segue até a morte dos filhos do passo seguinte;
 *   (b) encerrar os filhos registrados em `cancelamento.ts` (yt-dlp/whisper/
 *       ffmpeg) COM O EVENT LOOP VIVO: SIGTERM no grupo de cada um, espera o
 *       grace, SIGKILL no grupo de quem sobrou, e só segue quando todos
 *       saíram (ou no teto — o desligamento não pendura);
 *   (c) regra do pid: apagar `$BRUTO_DATA_ROOT/servidor.pid` SÓ se o
 *       conteúdo for o `process.pid` DESTE processo — pid de outra instalação
 *       no arquivo não é tocado (o lançador tem a mesma regra, INVARIANTE P3);
 *   (d) `exit(0)` — exatamente UMA vez por processo.
 *
 * INVARIANTES (todo caminho deste arquivo é conferido contra elas):
 *   1. ENCERRAMENTO ÚNICO (single-flight): no máximo UMA operação de
 *      encerramento por processo. Pedidos seguintes (a segunda janela que
 *      confirma junto) recebem 202 e COMPARTILHAM a promessa da primeira —
 *      nunca um segundo `encerrarFilhos` (a chamada extra esvaziaria o
 *      registro de filhos de novo) e nunca um segundo `exit` independente.
 *   2. A ordem (a)→(b)→(c)→(d), sempre. O `exit` só existe DEPOIS de (b)
 *      completar: filho que ignora SIGTERM não sobrevive ao botão. O handler
 *      de `exit` instalado por `garantirLimpezaDeFilhosNoFim()` segue como
 *      rede de segurança — SIGKILL SÍNCRONO no grupo (depois do `exit`
 *      nenhum timer dispara; sinal síncrono é o único que funciona lá) — e
 *      quem nascer durante a espera de (b), com a marca de (a) ligada, morre
 *      no próprio registro (`registrarFilho` mata em vez de registrar).
 *   3. JOB INTERROMPIDO CONTINUA RECUPERÁVEL: com a marca de (a) ligada, a
 *      falha causada pela morte dos filhos NÃO grava `error` nem `canceled`
 *      no job — ele fica `running` no banco para o `recoverOrphans()` do
 *      próximo boot re-enfileirar (é a promessa do botão). Cancelamento do
 *      usuário (`signal.aborted`) continua `canceled`; job que termina `done`
 *      ou falha por causa própria ANTES da marca segue normal. Esta
 *      invariante é implementada em runner.ts, que lê a MESMA marca.
 *   4. O REGISTRO DE FILHOS NUNCA FICA CEGO COM FILHO VIVO: só a operação
 *      única toca o registro (consequência da 1) — não existe um segundo
 *      pedido para esvaziá-lo enquanto o primeiro ainda espera a escalada, e
 *      no momento do (d) o lote já morreu todo (consequência da 2).
 *
 * Jobs interrompidos ficam como estão (`running`/`queued` no banco): o boot
 * re-enfileira órfãos (`recoverOrphans`), então eles retomam na próxima vez
 * que o app abrir.
 */
import fs from "node:fs";
import path from "node:path";
import { hostEhLoopback } from "@/lib/endpoint-local";
import { encerrarFilhosRegistrados } from "@/pipeline/lib/cancelamento";
import { marcarEncerramento } from "@/pipeline/lib/marca-de-encerramento";
import { DATA_ROOT } from "@/pipeline/lib/paths";

/** A resposta 202 já foi entregue quando o desligamento dispara. */
export const ATRASO_ENCERRAMENTO_MS = 300;

/** O pid gravado pelo lançador (`scripts/instalador-macos/Bruto`). */
export const CAMINHO_PID = path.join(DATA_ROOT, "servidor.pid");

/** As origens que são o PRÓPRIO servidor — nada mais passa na guarda. */
export function origensDoServidor(porta: number | string): string[] {
  return [`http://127.0.0.1:${porta}`, `http://localhost:${porta}`];
}

/**
 * A trava anti-outro-site (CSRF de localhost) do `POST /api/encerrar`: aceita
 * só `Sec-Fetch-Site: same-origin` (a janela do próprio app) ou `Origin`
 * exatamente igual a uma das origens do servidor. Qualquer outro caso —
 * `Origin` de outro site, `Origin: null`, `Origin` ausente com
 * `Sec-Fetch-Site: cross-site`, ou os dois ausentes — é recusado. A lista é
 * FIXA (loopback + a porta do servidor), nunca derivada do `Host` do pedido:
 * comparar com o `Host` abriria exatamente a porta do DNS rebinding.
 *
 * O atalho `same-origin` EXIGE Host de loopback (`127.0.0.1:<porta>`,
 * `localhost:<porta>`): num rebinding, o domínio do atacante resolve para
 * 127.0.0.1 e a página dele fala com este servidor como same-origin — com
 * `Host: <domínio-do-atacante>`. `Sec-Fetch-Site` sozinho não distingue a
 * janela do app da página do atacante; o `Host` distingue. E o corpo JSON
 * obrigatório não salvaria: same-origin não tem preflight. A rota ainda chama
 * `recusarSeNaoForLocal` ANTES de tudo (segunda camada, a mesma trava das
 * rotas `/api/llm*`); esta checagem aqui é a camada da própria decisão de
 * origem — se uma das duas faltar, a outra barra.
 */
export function origemRecusada(
  headers: { origin: string | null; secFetchSite: string | null; host: string | null },
  porta: number | string,
): boolean {
  if (headers.secFetchSite === "same-origin" && hostEhLoopback(headers.host)) return false;
  if (headers.origin !== null && origensDoServidor(porta).includes(headers.origin)) return false;
  return true;
}

/** Tudo que o encerramento toca — injetável, e o teste injeta tudo. */
export interface DepsEncerrar {
  /**
   * Passo (a): liga a marca de encerramento — a fila de jobs para de
   * começar jobs novos e o catch do job passa a tratar falha como
   * interrupção recuperável. Produção: `marcarEncerramento`.
   */
  marcarEncerrando: () => void;
  /** O relógio: agenda a execução (produção: `setTimeout`). */
  agendar: (fn: () => void | Promise<void>, ms: number) => void;
  /** O fim do processo — produção: `process.exit`. Teste: registro. */
  exit: (codigo: number) => void;
  /** Conteúdo atual de `servidor.pid`, ou null se não há arquivo legível. */
  lerPid: () => string | null;
  /** Remove `servidor.pid`. */
  removerPid: () => void;
  /** Jobs `running`/`queued` — o 409 avisa quem está processando. */
  contarJobsAtivos: () => number;
  /**
   * Encerra os filhos registrados E espera a morte deles (event loop vivo).
   * Produção: `encerrarFilhosRegistrados` de `cancelamento.ts`.
   */
  encerrarFilhos: () => Promise<void>;
  /** O pid DESTE processo, para a regra "só apago o meu". */
  pid: number;
}

/** A resposta da decisão — a rota só copia para o JSON. */
export type RespostaEncerrar =
  | { status: 202; corpo: { ok: true } }
  | { status: 409; corpo: { ok: false; code: "processamento-em-andamento"; ativos: number } };

/**
 * Decide o encerramento e (no 202) agenda o desligamento para DEPOIS de a
 * resposta ir ao cliente. Com job `running`/`queued` e sem `confirmar:true`,
 * 409 — a pessoa precisa saber o que vai ser interrompido.
 */
export function pedirEncerramento(
  corpo: { confirmar?: boolean },
  deps: DepsEncerrar,
): RespostaEncerrar {
  const ativos = deps.contarJobsAtivos();
  if (ativos > 0 && corpo.confirmar !== true) {
    return { status: 409, corpo: { ok: false, code: "processamento-em-andamento", ativos } };
  }
  deps.agendar(() => encerrarAgora(deps), ATRASO_ENCERRAMENTO_MS);
  return { status: 202, corpo: { ok: true } };
}

/**
 * O estado do single-flight (INVARIANTE 1) — a operação ÚNICA de
 * encerramento deste processo. Em `globalThis` como o RunnerState: sobrevive
 * ao hot reload do Next dev, e o `depsDeEncerramento` de cada request cria
 * um objeto de deps NOVO sem quebrar o "no máximo uma por processo".
 */
interface EstadoDoEncerramento {
  emCurso: Promise<void> | null;
}
const globalForEncerrar = globalThis as unknown as { __brutoEncerramentoUnico?: EstadoDoEncerramento };
const encerramentoUnico: EstadoDoEncerramento =
  globalForEncerrar.__brutoEncerramentoUnico ?? { emCurso: null };
globalForEncerrar.__brutoEncerramentoUnico = encerramentoUnico;

/**
 * O desligamento em si — o que o `setTimeout` da produção dispara.
 * INVARIANTE 1: no máximo UMA operação por processo. O segundo pedido que
 * confirmar junto (a segunda janela) cai no `if` e COMPARTILHA a promessa da
 * primeira — o seu `encerrarFilhos` nunca roda (rodaria com o registro de
 * filhos já tomado pela primeira operação e resolveria na hora, vazando) e o
 * seu `exit` nunca roda (saía ANTES do SIGKILL da primeira, deixando filho
 * órfão com o registro limpo — a rede de segurança do `exit` também não via
 * mais [P2, r4]).
 */
async function encerrarAgora(deps: DepsEncerrar): Promise<void> {
  if (encerramentoUnico.emCurso) return encerramentoUnico.emCurso;
  const operacao = operacaoUnicaDeEncerramento(deps);
  encerramentoUnico.emCurso = operacao;
  try {
    return await operacao;
  } finally {
    // Na produção isto é inalcançável: o passo (d) da operação é
    // `process.exit` e o processo acaba DENTRO dela — nada roda depois, a
    // marca de "em curso" fica para sempre e qualquer pedido tardio (se o
    // processo sobrevivesse) compartilharia a operação já resolvida. O reset
    // existe para o TESTE, onde o exit é falso e cada cenário é um
    // "processo" novo que precisa começar sem operação em curso.
    encerramentoUnico.emCurso = null;
  }
}

/**
 * A sequência (a)→(b)→(c)→(d) do ciclo desenhado no topo do arquivo, na
 * ordem, sem pulos — rodada UMA vez por processo (INVARIANTE 1 + 2).
 */
async function operacaoUnicaDeEncerramento(deps: DepsEncerrar): Promise<void> {
  // (a) A fila para de começar jobs novos ANTES da primeira morte: quem
  // estiver rodando será interrompido no passo (b) e fica RECUPERÁVEL
  // (INVARIANTE 3, aplicada no catch do runner); começar job novo agora só
  // fabricaria mais interrupção.
  deps.marcarEncerrando();
  try {
    // (b) A limpeza TERMINA antes de sair (a correção da r3): SIGTERM no
    // GRUPO de cada filho registrado, espera o grace, SIGKILL no grupo de
    // quem sobrou — tudo com o event loop VIVO. Filho que ignora SIGTERM
    // não pode sobreviver ao encerramento por um timer que nunca dispara.
    await deps.encerrarFilhos();
  } catch {
    /* não pendura o desligamento: quem sobrar é da rede de segurança do exit */
  }
  // (c) A regra do pid: só apaga o arquivo se ele aponta para ESTE processo.
  const gravado = deps.lerPid();
  if (gravado !== null && gravado === String(deps.pid)) deps.removerPid();
  // (d) O ÚNICO `exit` do processo — sempre depois de (b) ter completado.
  deps.exit(0);
}

/**
 * As deps de produção, com overrides opcionais (a rota injeta a contagem de
 * jobs, que mora no banco — por isso ela é OBRIGATÓRIA aqui: a lógica nunca
 * roda sem saber quantos jobs estão ativos). `lerPid` devolve null em
 * qualquer falha: arquivo ausente não é erro, é "nada a apagar".
 */
export function depsDeEncerramento(
  overrides: Partial<DepsEncerrar> & Pick<DepsEncerrar, "contarJobsAtivos">,
): DepsEncerrar {
  const base: Omit<DepsEncerrar, "contarJobsAtivos"> = {
    marcarEncerrando: () => {
      // Passo (a): módulo sem dependência nenhuma — não arrasta o runner (e
      // o banco dele) para quem só testa a lógica do botão com deps falsas.
      marcarEncerramento();
    },
    agendar: (fn, ms) => {
      setTimeout(fn, ms);
    },
    exit: (codigo) => process.exit(codigo),
    lerPid: () => {
      try {
        return fs.readFileSync(CAMINHO_PID, "utf8").trim() || null;
      } catch {
        return null;
      }
    },
    removerPid: () => {
      fs.rmSync(CAMINHO_PID, { force: true });
    },
    encerrarFilhos: () => {
      // Com o event loop VIVO: SIGTERM no grupo, grace, SIGKILL em quem
      // sobrou, e só resolve com todos mortos (ou no teto). O import de
      // cancelamento.ts já instala a rede de segurança do `exit`.
      return encerrarFilhosRegistrados();
    },
    pid: process.pid,
  };
  return Object.assign(base, overrides);
}
