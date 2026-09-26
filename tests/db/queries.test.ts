/**
 * `videosProntosParaExportar` — a decisão de qual job (videoId, jobId)
 * representa o resultado ATUAL de cada vídeo pra exportação automática.
 * Achado da 4ª revisão cross-vendor (item 2, os dois revisores, Grok deu o
 * repro exato): a marca de "já exportado" era só por `videoId`, nunca
 * invalidada — reprocessar o mesmo vídeo (retry) e chegar a `done` de novo
 * não disparava nova cópia, porque a função via o id já marcado. A correção
 * chaveia por (videoId, jobId): esta função decide QUAL jobId é o "atual" de
 * cada vídeo, e exclui vídeo com job em andamento agora (evita pegar o
 * resultado done antigo no meio de um reprocesso).
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { videosProntosParaExportar, type JobResumido } from "@/db/queries";

function job(parcial: Partial<JobResumido> & Pick<JobResumido, "id" | "videoId" | "status">): JobResumido {
  return { createdAt: new Date(0), ...parcial };
}

describe("videosProntosParaExportar", () => {
  test("vídeo com um único job done aparece com esse jobId", () => {
    const resultado = videosProntosParaExportar([job({ id: "j1", videoId: "v1", status: "done" })]);
    assert.deepEqual(resultado, [{ videoId: "v1", jobId: "j1" }]);
  });

  test("job queued/running (sem done ainda) não aparece", () => {
    const resultado = videosProntosParaExportar([
      job({ id: "j1", videoId: "v1", status: "queued" }),
      job({ id: "j2", videoId: "v2", status: "running" }),
    ]);
    assert.deepEqual(resultado, []);
  });

  test("job error não aparece", () => {
    const resultado = videosProntosParaExportar([job({ id: "j1", videoId: "v1", status: "error" })]);
    assert.deepEqual(resultado, []);
  });

  // O caso central do item 2: reprocessar (retry) cria um job NOVO. Entre
  // dois jobs done do MESMO vídeo, o mais recente (createdAt maior) é quem
  // representa o resultado atual — é o jobId que precisa exportar de novo.
  test("dois jobs done do MESMO vídeo (reprocesso) → só o mais recente conta", () => {
    const resultado = videosProntosParaExportar([
      job({ id: "job-antigo", videoId: "v1", status: "done", createdAt: new Date(1000) }),
      job({ id: "job-novo-do-retry", videoId: "v1", status: "done", createdAt: new Date(2000) }),
    ]);
    assert.deepEqual(resultado, [{ videoId: "v1", jobId: "job-novo-do-retry" }]);
  });

  test("ordem de entrada não importa — só o createdAt decide qual é o mais recente", () => {
    const resultado = videosProntosParaExportar([
      job({ id: "job-novo", videoId: "v1", status: "done", createdAt: new Date(2000) }),
      job({ id: "job-antigo", videoId: "v1", status: "done", createdAt: new Date(1000) }),
    ]);
    assert.deepEqual(resultado, [{ videoId: "v1", jobId: "job-novo" }]);
  });

  // Segunda metade do item 2: vídeo com um job done ANTIGO e um job novo
  // AINDA EM ANDAMENTO (retry disparado, não terminou) não deve aparecer —
  // senão o catch-up pegaria o resultado done antigo bem no meio do
  // reprocesso, exportando conteúdo que está prestes a ficar desatualizado.
  test("job done antigo + job novo queued/running pro MESMO vídeo → vídeo inteiro fica de fora", () => {
    const resultado = videosProntosParaExportar([
      job({ id: "job-antigo-done", videoId: "v1", status: "done", createdAt: new Date(1000) }),
      job({ id: "job-retry-rodando", videoId: "v1", status: "running", createdAt: new Date(2000) }),
    ]);
    assert.deepEqual(resultado, []);
  });

  test("vários vídeos independentes — cada um com o próprio jobId mais recente", () => {
    const resultado = videosProntosParaExportar([
      job({ id: "a1", videoId: "a", status: "done", createdAt: new Date(1000) }),
      job({ id: "b1", videoId: "b", status: "done", createdAt: new Date(1000) }),
      job({ id: "b2", videoId: "b", status: "done", createdAt: new Date(2000) }),
    ]);
    assert.deepEqual(
      [...resultado].sort((x, y) => x.videoId.localeCompare(y.videoId)),
      [
        { videoId: "a", jobId: "a1" },
        { videoId: "b", jobId: "b2" },
      ],
    );
  });

  test("job sem videoId (job muito cedo, metadata ainda não rodou) é ignorado, nunca quebra", () => {
    const resultado = videosProntosParaExportar([job({ id: "j1", videoId: null, status: "done" })]);
    assert.deepEqual(resultado, []);
  });

  test("lista vazia → lista vazia", () => {
    assert.deepEqual(videosProntosParaExportar([]), []);
  });
});
