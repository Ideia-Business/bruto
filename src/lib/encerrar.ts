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
 * Contrato do desligamento (na ordem):
 *   1. mata os filhos registrados em `cancelamento.ts` (yt-dlp/whisper/ffmpeg)
 *      pelo mecanismo existente — a rede de segurança de shutdown: o handler
 *      de `exit` instalado por `garantirLimpezaDeFilhosNoFim()` mata cada
 *      filho em GRUPO quando o processo sai ("quem o servidor lançou, o
 *      servidor mata ao sair");
 *   2. apaga `$BRUTO_DATA_ROOT/servidor.pid` SÓ se o conteúdo for o
 *      `process.pid` DESTE processo — pid de outra instalação no arquivo não
 *      é tocado (o lançador tem a mesma regra, INVARIANTE P3);
 *   3. `process.exit(0)`.
 *
 * Jobs interrompidos ficam como estão (`running`/`queued` no banco): o boot
 * re-enfileira órfãos (`recoverOrphans`), então eles retomam na próxima vez
 * que o app abrir.
 */
import fs from "node:fs";
import path from "node:path";
import { garantirLimpezaDeFilhosNoFim } from "@/pipeline/lib/cancelamento";
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
 * comparar com o `Host` abriria exactly a porta do DNS rebinding.
 */
export function origemRecusada(
  headers: { origin: string | null; secFetchSite: string | null },
  porta: number | string,
): boolean {
  if (headers.secFetchSite === "same-origin") return false;
  if (headers.origin !== null && origensDoServidor(porta).includes(headers.origin)) return false;
  return true;
}

/** Tudo que o encerramento toca — injetável, e o teste injeta tudo. */
export interface DepsEncerrar {
  /** O relógio: agenda a execução (produção: `setTimeout`). */
  agendar: (fn: () => void, ms: number) => void;
  /** O fim do processo — produção: `process.exit`. Teste: registro. */
  exit: (codigo: number) => void;
  /** Conteúdo atual de `servidor.pid`, ou null se não há arquivo legível. */
  lerPid: () => string | null;
  /** Remove `servidor.pid`. */
  removerPid: () => void;
  /** Jobs `running`/`queued` — o 409 avisa quem está processando. */
  contarJobsAtivos: () => number;
  /** Mata os filhos registrados (mecanismo de `cancelamento.ts`). */
  matarFilhos: () => void;
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

/** O desligamento em si — o que o `setTimeout` da produção dispara. */
function encerrarAgora(deps: DepsEncerrar): void {
  deps.matarFilhos();
  const gravado = deps.lerPid();
  if (gravado !== null && gravado === String(deps.pid)) deps.removerPid();
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
    matarFilhos: () => {
      // Idempotente: a rede já é instalada no import de cancelamento.ts;
      // chamar aqui documenta e GARANTE que o exit(0) abaixo mata os filhos
      // registrados (yt-dlp/whisper/ffmpeg) em grupo.
      garantirLimpezaDeFilhosNoFim();
    },
    pid: process.pid,
  };
  return Object.assign(base, overrides);
}
