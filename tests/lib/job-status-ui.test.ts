/**
 * Testes de `src/lib/job-status-ui.ts` — a lógica pura de UI dos status de
 * job (rótulo/pílula, "pode cancelar?/precisa confirmar?", classificação do
 * 409 de duplicata e texto do cancelado). Tudo que a tela decide sobre um
 * status mora aqui, para os três pontos de render (lista /processing, cards
 * da home, detalhe) beberem da mesma fonte — INVARIANTE T1.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  ROTULO_DE_STATUS,
  ESTILO_DE_STATUS,
  podeCancelar,
  precisaConfirmarCancelamento,
  classificarResposta409,
  textoDeCancelado,
  dividirDuplicados,
  resumirUrl,
} from "@/lib/job-status-ui";

const TODOS_OS_STATUS = ["queued", "running", "done", "error", "canceled"] as const;

describe("ROTULO_DE_STATUS — todo estado é renderizável (T1)", () => {
  test("cobre os 5 status, incluindo canceled", () => {
    for (const status of TODOS_OS_STATUS) {
      assert.ok(ROTULO_DE_STATUS[status], `rótulo faltando para ${status}`);
    }
  });

  test("canceled tem rótulo 'Cancelado'", () => {
    assert.equal(ROTULO_DE_STATUS.canceled, "Cancelado");
  });

  test("labels conhecidos preservados (Na fila / Processando / Concluído / Erro)", () => {
    assert.equal(ROTULO_DE_STATUS.queued, "Na fila");
    assert.equal(ROTULO_DE_STATUS.running, "Processando");
    assert.equal(ROTULO_DE_STATUS.done, "Concluído");
    assert.equal(ROTULO_DE_STATUS.error, "Erro");
  });
});

describe("ESTILO_DE_STATUS — pílula de canceled é neutra, não vermelha (Q1)", () => {
  test("todo status tem estilo não vazio", () => {
    for (const status of TODOS_OS_STATUS) {
      assert.ok((ESTILO_DE_STATUS[status] ?? "").length > 0, `estilo faltando para ${status}`);
    }
  });

  test("canceled NÃO usa destructive (vermelho é só do error)", () => {
    assert.ok(!ESTILO_DE_STATUS.canceled.includes("destructive"));
    assert.ok(ESTILO_DE_STATUS.error.includes("destructive"));
  });
});

describe("podeCancelar — só job ativo (Q6)", () => {
  test("queued e running podem", () => {
    assert.equal(podeCancelar("queued"), true);
    assert.equal(podeCancelar("running"), true);
  });

  test("estados terminais não podem — inclusive canceled", () => {
    assert.equal(podeCancelar("done"), false);
    assert.equal(podeCancelar("error"), false);
    assert.equal(podeCancelar("canceled"), false);
  });
});

describe("precisaConfirmarCancelamento — só running (Q7)", () => {
  test("running pede confirmação em linha", () => {
    assert.equal(precisaConfirmarCancelamento("running"), true);
  });

  test("queued cancela direto, sem confirmação", () => {
    assert.equal(precisaConfirmarCancelamento("queued"), false);
  });

  test("terminais nunca pedem confirmação", () => {
    assert.equal(precisaConfirmarCancelamento("done"), false);
    assert.equal(precisaConfirmarCancelamento("error"), false);
    assert.equal(precisaConfirmarCancelamento("canceled"), false);
  });
});

describe("classificarResposta409 — 'já na fila' × 'já no catálogo' (Q4)", () => {
  test("409 com jobId é duplicata ATIVA (vídeo queued/running em outro job)", () => {
    assert.equal(
      classificarResposta409({ error: "Esse vídeo já está na fila", duplicate: true, jobId: "job-1", videoId: "v-1" }),
      "ja-na-fila",
    );
  });

  test("409 com duplicate mas SEM jobId é 'já processado' (catálogo)", () => {
    assert.equal(
      classificarResposta409({ error: "Vídeo já processado", videoId: "v-1", duplicate: true }),
      "ja-processado",
    );
  });

  test("jobId nulo/vazio não conta como fila — é catálogo", () => {
    assert.equal(classificarResposta409({ duplicate: true, videoId: "v-1", jobId: null }), "ja-processado");
    assert.equal(classificarResposta409({ duplicate: true, videoId: "v-1", jobId: "" }), "ja-processado");
  });

  test("sem duplicate não é conflito de dupla inserção (null)", () => {
    assert.equal(classificarResposta409({ error: "outra coisa" }), null);
    assert.equal(classificarResposta409({}), null);
    assert.equal(classificarResposta409(null), null);
    assert.equal(classificarResposta409(undefined), null);
  });
});

describe("textoDeCancelado — mensagem do job canceled (Q1)", () => {
  test("sem errorMessage: 'Cancelado'", () => {
    assert.equal(textoDeCancelado(null), "Cancelado");
    assert.equal(textoDeCancelado(undefined), "Cancelado");
  });

  test("com errorMessage (duplicata tardia): o texto do job vence", () => {
    assert.equal(
      textoDeCancelado("Duplicado: este vídeo já está sendo processado em outro job"),
      "Duplicado: este vídeo já está sendo processado em outro job",
    );
  });
});

describe("dividirDuplicados — o toast do lote não chama fila de catálogo (Q4)", () => {
  test("separa duplicado-na-fila (com jobId) de duplicado-no-catálogo (sem jobId)", () => {
    const { noCatalogo, jaNaFila } = dividirDuplicados([
      { status: "duplicado", jobId: "job-1" },
      { status: "duplicado" },
      { status: "fila", jobId: "job-2" },
      { status: "erro" },
    ]);
    assert.equal(noCatalogo, 1);
    assert.equal(jaNaFila, 1);
  });

  test("lote sem duplicado zera os dois", () => {
    assert.deepEqual(
      dividirDuplicados([
        { status: "fila", jobId: "job-1" },
        { status: "erro" },
        { status: "invalido" },
      ]),
      { noCatalogo: 0, jaNaFila: 0 },
    );
  });
});

describe("resumirUrl — nome acessível do botão (T4)", () => {
  test("remove scheme e www, mantém curta inteira", () => {
    assert.equal(resumirUrl("https://youtu.be/dQw4w9WgXcQ"), "youtu.be/dQw4w9WgXcQ");
    assert.equal(resumirUrl("https://www.youtube.com/watch?v=abc"), "youtube.com/watch?v=abc");
    assert.equal(resumirUrl("http://youtu.be/abc"), "youtu.be/abc");
  });

  test("url longa é cortada com reticências e respeita o máximo", () => {
    const resumida = resumirUrl("https://www.tiktok.com/@usuario-muito-longo/video/1234567890", 24);
    assert.ok(resumida.length <= 24, `esperado <= 24, veio ${resumida.length}`);
    assert.ok(resumida.endsWith("…"));
    assert.ok(resumida.startsWith("tiktok.com/"));
  });

  test("sem scheme não quebra", () => {
    assert.equal(resumirUrl("youtu.be/abc"), "youtu.be/abc");
  });
});
