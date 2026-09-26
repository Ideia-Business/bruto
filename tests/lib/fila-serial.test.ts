/**
 * `criarFilaSerial` — extraída de `tag-picker.tsx` depois de um DEADLOCK real
 * achado por Codex e Grok independentemente (7ª rodada): uma tarefa
 * enfileirada que, ao falhar, reenfileirava sua própria recuperação NA MESMA
 * fila. A fila só considerava aquela tarefa concluída depois que a
 * recuperação terminasse — e a recuperação só rodava depois que a fila
 * liberasse. Círculo fechado: nada nunca resolvia, e toda tarefa futura
 * ficava presa atrás dela para sempre.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { criarFilaSerial } from "@/lib/fila-serial";

describe("criarFilaSerial", () => {
  test("executa tarefas na ordem em que foram enfileiradas, uma de cada vez", async () => {
    const fila = criarFilaSerial();
    const ordem: string[] = [];

    const a = fila.enfileirar(async () => {
      ordem.push("A-inicio");
      await new Promise((r) => setTimeout(r, 10));
      ordem.push("A-fim");
    });
    const b = fila.enfileirar(async () => {
      ordem.push("B-inicio");
      ordem.push("B-fim");
    });

    await Promise.all([a, b]);
    assert.deepEqual(ordem, ["A-inicio", "A-fim", "B-inicio", "B-fim"]);
  });

  test("devolve o valor da própria tarefa", async () => {
    const fila = criarFilaSerial();
    const resultado = await fila.enfileirar(async () => 42);
    assert.equal(resultado, 42);
  });

  test("uma tarefa que lança não impede a próxima de rodar (a fila nunca trava por causa de erro)", async () => {
    const fila = criarFilaSerial();
    const ordem: string[] = [];

    await assert.rejects(
      fila.enfileirar(async () => {
        ordem.push("A");
        throw new Error("falhou de propósito");
      }),
    );

    await fila.enfileirar(async () => {
      ordem.push("B");
    });

    assert.deepEqual(ordem, ["A", "B"]);
  });

  /**
   * REGRESSÃO — o padrão CORRETO que substituiu o bug: a recuperação de erro
   * de uma tarefa enfileirada roda DIRETO (chamada de função comum), nunca via
   * `enfileirar` de novo. Prova que isso não trava nada.
   */
  test("REGRESSÃO: recuperação de erro rodando DIRETO (sem reenfileirar) não trava as próximas tarefas", async () => {
    const fila = criarFilaSerial();
    const ordem: string[] = [];

    const recuperacaoDireta = async () => {
      ordem.push("recuperação");
    };

    await fila.enfileirar(async () => {
      ordem.push("A-inicio");
      try {
        throw new Error("falhou");
      } catch {
        await recuperacaoDireta(); // NUNCA `fila.enfileirar(...)` aqui
      }
      ordem.push("A-fim");
    });

    await fila.enfileirar(async () => {
      ordem.push("B");
    });

    assert.deepEqual(ordem, ["A-inicio", "recuperação", "A-fim", "B"]);
  });

  /**
   * REGRESSÃO — documenta o MECANISMO exato do bug original: se a recuperação
   * de erro reenfileirar NA MESMA fila enquanto a tarefa-mãe ainda está
   * rodando (o padrão que `tag-picker.tsx` tinha antes da correção), a
   * chamada trava para sempre. Provado com uma corrida contra um timeout —
   * nunca com um `await` direto, que penduraria a suíte inteira.
   */
  test("REGRESSÃO: reenfileirar dentro do catch da PRÓPRIA tarefa trava para sempre (mecanismo do bug original)", async () => {
    const fila = criarFilaSerial();

    const tarefaComBugOriginal = fila.enfileirar(async () => {
      try {
        throw new Error("falhou");
      } catch {
        // O bug: `enfileirar` de novo, na MESMA fila, enquanto esta função
        // (que a fila está esperando terminar) ainda está no meio do catch.
        await fila.enfileirar(async () => {});
      }
    });

    const resultado = await Promise.race([
      tarefaComBugOriginal.then(() => "resolveu"),
      new Promise((r) => setTimeout(() => r("travou"), 200)),
    ]);

    assert.equal(
      resultado,
      "travou",
      "reenfileirar dentro do catch da própria tarefa deveria mesmo travar — é a prova de que o padrão correto (chamada direta) é o único seguro",
    );
  });
});
