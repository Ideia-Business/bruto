/**
 * Fila serial de tarefas assíncronas — cada tarefa enfileirada só COMEÇA
 * depois que a anterior terminou (sucesso ou erro), nunca duas em voo ao
 * mesmo tempo. Extraída de `tag-picker.tsx` para ser testável sem depender de
 * React: o bug que a motivou foi um DEADLOCK POR AUTO-REFERÊNCIA — uma tarefa
 * enfileirada que, ao falhar, reenfileirava sua própria recuperação NA MESMA
 * fila. A fila só via aquela tarefa como concluída depois que a recuperação
 * terminasse, e a recuperação só rodava depois que a fila liberasse — círculo
 * fechado, nada nunca resolvia, e toda tarefa futura ficava presa atrás dele.
 *
 * A lição, documentada aqui para quem for usar: a RECUPERAÇÃO de erro de uma
 * tarefa enfileirada NUNCA pode chamar `enfileirar` de novo enquanto ainda
 * está dentro do corpo daquela tarefa — se precisar reaproveitar a mesma
 * lógica, extraia-a numa função separada e chame-a DIRETO, sem reenfileirar.
 */
export interface FilaSerial {
  enfileirar<T>(tarefa: () => Promise<T>): Promise<T>;
}

export function criarFilaSerial(): FilaSerial {
  let cauda: Promise<void> = Promise.resolve();

  function enfileirar<T>(tarefa: () => Promise<T>): Promise<T> {
    const resultado = cauda.then(tarefa);
    // A cauda nunca pode REJEITAR — se rejeitasse, a próxima tarefa nem
    // chegaria a rodar (encadear `.then` numa promise rejeitada pula direto
    // para o próximo `.catch`, nunca para o próximo `.then`). Cada tarefa é
    // responsável pelo próprio erro; a fila só garante a ORDEM.
    cauda = resultado.then(
      () => undefined,
      () => undefined,
    );
    return resultado;
  }

  return { enfileirar };
}
