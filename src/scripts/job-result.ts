/**
 * A decisão de sucesso/falha do `npm run process` (process-cli.ts), isolada
 * como função pura: logo após `runJobSync` (que só resolve quando o job
 * settle), o CLI relê o job do banco e é ESTA função que decide se aquele job
 * é sucesso ou falha — antes de tocar em `job.videoId`.
 *
 * Por que em arquivo próprio e não exportada do próprio `process-cli.ts`: o
 * CLI é um script que roda `main()` no import, então não pode ser importado
 * por teste nenhum; a decisão, sim (e deve — ver `tests/scripts/job-result.test.ts`).
 */
export interface JobDecidivel {
  /** 'queued' | 'running' | 'done' | 'error' | 'canceled' — texto no banco. */
  status: string;
  errorCode: string | null;
  errorMessage: string | null;
}

/**
 * `ok: true`  → caminho de sucesso do CLI: o próprio `job` (garantido
 *               existente e não-falho) volta para o resumo + exit 0.
 * `ok: false` → `mensagem` pronta para o `✖` do CLI + exit 1.
 */
export type ResultadoDoJob<T extends JobDecidivel> = { ok: true; job: T } | { ok: false; mensagem: string };

export function descreverResultadoDoJob<T extends JobDecidivel>(job: T | undefined): ResultadoDoJob<T> {
  if (!job) {
    return { ok: false, mensagem: "Falhou [?]: erro desconhecido" };
  }
  if (job.status === "error") {
    return {
      ok: false,
      mensagem: `Falhou [${job.errorCode ?? "?"}]: ${job.errorMessage ?? "erro desconhecido"}`,
    };
  }
  if (job.status === "canceled") {
    // Cancelado NUNCA é sucesso: o vídeo deste job não foi processado por
    // ele (duplicata tardia de link curto grava a mensagem de duplicado e
    // nem persiste `videoId`; cancelamento por sinal grava `errorMessage`
    // null — daí o fallback). O CLI não pode imprimir "Concluído" nem ler
    // `job.videoId!` para um job neste estado.
    return { ok: false, mensagem: `Cancelado: ${job.errorMessage ?? "o job foi cancelado"}` };
  }
  // `runJobSync` só resolve com o job em estado terminal, então o que sobra
  // aqui é `done` — segue o caminho de sucesso, como sempre seguiu.
  return { ok: true, job };
}
