/**
 * Avalia um texto colado com vários links, um por linha, contra a fonte
 * única de plataformas (`@/lib/plataformas`) — sem tocar rede nem estado.
 *
 * POR QUE SEPARADO DE `plataformas.ts`: aquele arquivo é compartilhado com a
 * extensão (esbuild, sem Node) e não pode ganhar peso; este é só do app, que
 * decide como colar N links vira N linhas avaliadas.
 */
import { reconhecerLink, type ReferenciaDeMidia } from "@/lib/plataformas";

export interface LinhaDoLote {
  readonly linha: string;
  /** `null` quando a linha não é um link de plataforma suportada. */
  readonly referencia: ReferenciaDeMidia | null;
}

/** Quebra por linha, descarta vazias/espaços, reconhece cada uma. */
export function avaliarLoteDeLinks(texto: string): LinhaDoLote[] {
  return texto
    .split("\n")
    .map((linha) => linha.trim())
    .filter((linha) => linha.length > 0)
    .map((linha) => ({ linha, referencia: reconhecerLink(linha) }));
}

/**
 * Chave estável para agrupar a mesma mídia entre grafias diferentes de
 * link (`youtu.be/X` e `youtube.com/watch?v=X` viram a mesma chave).
 * `null` para linha inválida OU sem id extraível (link curto do TikTok) —
 * essas nunca agrupam entre si, nem consigo mesmas.
 */
export function chaveDeAgrupamento(item: LinhaDoLote): string | null {
  if (item.referencia === null || !item.referencia.id) return null;
  return `${item.referencia.plataforma}:${item.referencia.id}`;
}

/**
 * Chave para lembrar "esta linha já foi enviada" entre um submit e o
 * próximo (`filtrarNaoEnviados`). Cai no texto cru quando não há id
 * extraível — é o único sinal disponível antes do yt-dlp resolver.
 */
export function chaveDeRastreio(item: LinhaDoLote): string {
  return chaveDeAgrupamento(item) ?? `linha:${item.linha}`;
}

/** Uma linha que dispara chamada de rede própria — líder de um grupo, ou sem id. */
export interface TarefaDoLote {
  readonly index: number;
  readonly linha: string;
}

/** Uma linha que copia o resultado de outra (mesmo id) em vez de chamar a rede. */
export interface SeguidorDoLote {
  readonly index: number;
  readonly liderIndex: number;
}

export interface PlanoDeEnvioDoLote {
  readonly tarefas: readonly TarefaDoLote[];
  readonly seguidores: readonly SeguidorDoLote[];
}

/**
 * Agrupa as linhas VÁLIDAS do lote (linha inválida fica de fora — quem
 * chama decide o que fazer com ela) pelo id que `reconhecerLink` já
 * extrai. A mesma URL em grafias diferentes (`youtu.be/X` e
 * `youtube.com/watch?v=X`) cai no mesmo id: só a primeira ocorrência
 * (líder) vira tarefa de rede, as demais (seguidoras) copiam o resultado
 * dela — sem chamar a rede de novo, sem processar o mesmo vídeo em dobro.
 *
 * Linha sem id extraível (link curto do TikTok, `id` vazio) NUNCA agrupa,
 * mesmo com texto idêntico a outra: cada ocorrência vira sua própria
 * tarefa, porque o id real só aparece depois do redirect que o yt-dlp
 * resolve por chamada.
 *
 * Índices são posicionais (posição no `lote` de entrada), nunca o texto
 * da linha — duas linhas com o mesmo texto têm índices, e portanto
 * resultados, distintos.
 */
export function planejarEnvioDoLote(lote: readonly LinhaDoLote[]): PlanoDeEnvioDoLote {
  const tarefas: TarefaDoLote[] = [];
  const seguidores: SeguidorDoLote[] = [];
  const liderPorChave = new Map<string, number>();

  lote.forEach((item, index) => {
    const chave = chaveDeAgrupamento(item);
    if (item.referencia === null) return;
    if (chave === null) {
      tarefas.push({ index, linha: item.linha });
      return;
    }
    const liderIndex = liderPorChave.get(chave);
    if (liderIndex === undefined) {
      liderPorChave.set(chave, index);
      tarefas.push({ index, linha: item.linha });
    } else {
      seguidores.push({ index, liderIndex });
    }
  });

  return { tarefas, seguidores };
}

/**
 * Tira do lote as linhas cuja chave de rastreio já está em `jaEnviados` —
 * usado ao reenviar depois de editar o textarea, para uma linha que já
 * voltou `fila`/`duplicado` numa rodada anterior não virar um segundo job
 * do mesmo vídeo só porque ainda não é `done` (`isBrutoDone` não barra
 * `queued`/`running`).
 */
export function filtrarNaoEnviados(
  lote: readonly LinhaDoLote[],
  jaEnviados: ReadonlySet<string>,
): LinhaDoLote[] {
  return lote.filter((item) => !jaEnviados.has(chaveDeRastreio(item)));
}

/** O necessário de um item do resumo para contar o lote — sem acoplar ao tipo completo do diálogo. */
export interface ItemContavel {
  readonly status: "invalido" | "fila" | "duplicado" | "erro";
  readonly jobId?: string;
}

export interface ContagemDoLote {
  readonly naFila: number;
  readonly duplicados: number;
  readonly falhas: number;
}

/**
 * Conta o resumo do lote — `naFila` por JOB ÚNICO, não por linha: duas
 * linhas que colapsaram para o mesmo id (`planejarEnvioDoLote`) têm o
 * mesmo `jobId` e contam como 1 vídeo na fila, não 2.
 */
export function contarEnvioDoLote(itens: readonly ItemContavel[]): ContagemDoLote {
  const jobsUnicos = new Set(
    itens.filter((item) => item.status === "fila" && item.jobId).map((item) => item.jobId!),
  );
  return {
    naFila: jobsUnicos.size,
    duplicados: itens.filter((item) => item.status === "duplicado").length,
    falhas: itens.filter((item) => item.status === "erro" || item.status === "invalido").length,
  };
}
