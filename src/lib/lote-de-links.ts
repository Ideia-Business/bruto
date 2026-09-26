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
    if (item.referencia === null) return;
    const { plataforma, id } = item.referencia;
    const chave = id ? `${plataforma}:${id}` : null;
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
