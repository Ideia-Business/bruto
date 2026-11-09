/**
 * A decisão de sucesso/falha do `npm run process` (process-cli.ts), testada
 * pura — sem rodar o pipeline e sem abrir banco: depois de `runJobSync`, o CLI
 * relê o job do banco e `descreverResultadoDoJob` é quem diz se aquele job é
 * sucesso ou falha (e qual mensagem imprimir). O `process-cli.ts` em si é um
 * script que executa `main()` no import, então não pode ser importado por
 * teste nenhum; a decisão, isolada em `src/scripts/job-result.ts`, sim.
 *
 * REGRESSÃO (F1): um job encerrado como `canceled` — hoje possível por
 * duplicata tardia de link curto (o runner grava `canceled` com
 * `errorMessage = "Duplicado: este vídeo já está sendo processado em outro
 * job"` e SEM `videoId`) — caía no caminho de SUCESSO do CLI: `job.videoId!`
 * nulo e um "✔ Concluído" para um vídeo que este job nunca processou.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { descreverResultadoDoJob } from "@/scripts/job-result";

const MENSAGEM_DUPLICADO = "Duplicado: este vídeo já está sendo processado em outro job";

/** Um job como o drizzle devolve: campos que a decisão lê + `videoId` real. */
function job(
  status: string,
  extra: Partial<{ errorCode: string | null; errorMessage: string | null; videoId: string | null }> = {},
) {
  return { status, errorCode: null, errorMessage: null, videoId: null, ...extra };
}

describe("descreverResultadoDoJob — o que o CLI faz com o job relido do banco", () => {
  test("REGRESSÃO (F1): job canceled por duplicata tardia é FALHA, nunca sucesso", () => {
    const r = descreverResultadoDoJob(job("canceled", { errorMessage: MENSAGEM_DUPLICADO, videoId: null }));
    if (r.ok) assert.fail("canceled cair no caminho de sucesso do CLI é o defeito da F1");
    assert.match(r.mensagem, /Cancelado: Duplicado: este vídeo já está sendo processado em outro job/);
  });

  test("canceled sem errorMessage (cancelado por sinal) também é falha, com fallback", () => {
    const r = descreverResultadoDoJob(job("canceled", { errorMessage: null }));
    if (r.ok) assert.fail("cancelamento por sinal também é não-sucesso");
    assert.match(r.mensagem, /Cancelado: o job foi cancelado/);
  });

  test("job error continua falha com a mensagem de antes (nada regrediu)", () => {
    const r = descreverResultadoDoJob(
      job("error", { errorCode: "NO_TRANSCRIPT", errorMessage: "sem transcrição disponível" }),
    );
    if (r.ok) assert.fail();
    assert.match(r.mensagem, /Falhou \[NO_TRANSCRIPT\]: sem transcrição disponível/);
  });

  test("job error sem código/mensagem mantém os fallbacks de antes", () => {
    const r = descreverResultadoDoJob(job("error", { errorCode: null, errorMessage: null }));
    if (r.ok) assert.fail();
    assert.match(r.mensagem, /Falhou \[\?\]: erro desconhecido/);
  });

  test("job ausente (select não achou) é falha com os fallbacks de antes", () => {
    const r = descreverResultadoDoJob(undefined);
    if (r.ok) assert.fail();
    assert.match(r.mensagem, /Falhou \[\?\]: erro desconhecido/);
  });

  test("job done é o único caminho de sucesso — e o job volta junto", () => {
    const r = descreverResultadoDoJob(job("done", { videoId: "abc123" }));
    assert.equal(r.ok, true);
    if (!r.ok) return; // só para o TS narrow — o equal acima já decidiu
    assert.equal(r.job.status, "done");
    assert.equal(r.job.videoId, "abc123");
  });
});
