/**
 * A marca de encerramento — o contrato entre o botão "Encerrar o Bruto"
 * (src/lib/encerrar.ts, que LIGA) e a fila (src/pipeline/runner.ts, que LÊ).
 *
 * O ciclo desenhado em src/lib/encerrar.ts exige que a fila PARE de começar
 * jobs novos antes de matar os filhos, e que o job em execução — cujos
 * filhos SERÃO mortos pela limpeza — não seja gravado como `error` quando a
 * etapa dele rejeitar por causa dessa morte. Isso não pode depender de
 * `encerrar.ts` importar o runner inteiro (que arrasta o banco de dados
 * junto para quem só testa a lógica do botão com deps falsas): a marca é um
 * módulo SEM dependência nenhuma, guardado em `globalThis` — sobrevive ao
 * hot reload do Next dev, o mesmo truque do RunnerState do runner.
 *
 * Quem liga não desliga: o processo que marca está encerrando sai com
 * `exit(0)` logo em seguida (passo (d) do ciclo). O reset só existe para o
 * TESTE — cada caso de teste é um "processo" novo dentro do mesmo worker.
 */
const globalForMarca = globalThis as unknown as { __brutoEncerrando?: boolean };

/** Passo (a) do ciclo: a fila para de começar jobs novos a partir de agora. */
export function marcarEncerramento(): void {
  globalForMarca.__brutoEncerrando = true;
}

/**
 * A marca está ligada? O runner consulta (i) a cada volta do `drain` — para
 * não começar job novo — e (ii) no catch do job — para não gravar `error`
 * numa falha que a própria morte dos filhos causou.
 */
export function encerramentoEmAndamento(): boolean {
  return globalForMarca.__brutoEncerrando === true;
}

/** SÓ PARA TESTE: no processo real a marca nunca é desligada — ele sai. */
export function resetarMarcaDeEncerramentoParaTestes(): void {
  globalForMarca.__brutoEncerrando = false;
}
