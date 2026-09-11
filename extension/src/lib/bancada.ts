/**
 * Bancada — as aulas que você já destrinchou, guardadas neste navegador.
 *
 * POR QUE EXISTE: até aqui a extensão era sem memória. Ela capturava, resumia,
 * mostrava — e ao fechar o popup, acabou. Quem não copiasse nem baixasse o `.md`
 * perdia o trabalho, sem aviso. Um produto que gasta a chave (e o dinheiro) de
 * alguém para produzir algo não pode jogar fora o resultado por descuido.
 *
 * ONDE FICA: `chrome.storage.local`, nunca `.sync`. O mesmo princípio da chave —
 * o que é seu não viaja para a conta Google nem para servidor nenhum nosso.
 * Não existe servidor nosso.
 *
 * O LIMITE: `chrome.storage.local` dá ~10 MB e cada aula pesa 3-6 KB, então o
 * teto de 60 é folgado de propósito. Guardar sem limite transformaria uma
 * conveniência em vazamento de espaço silencioso — a bancada esquece a mais
 * antiga, como bancada de verdade.
 */

const CHAVE = "bruto:bancada";
const TETO = 60;

export interface AulaGuardada {
  videoId: string;
  titulo: string;
  canal: string | null;
  url: string;
  /** O markdown da aula, como veio do modelo. */
  markdown: string;
  /** Epoch em ms — o popup formata na hora de exibir. */
  em: number;
  provedor: string | null;
}

async function lerTudo(): Promise<AulaGuardada[]> {
  try {
    const bruto = await chrome.storage.local.get(CHAVE);
    const lista = bruto[CHAVE];
    return Array.isArray(lista) ? (lista as AulaGuardada[]) : [];
  } catch {
    // Armazenamento indisponível (modo restrito, cota estourada) não pode
    // derrubar o popup: a bancada é conveniência, não o produto.
    return [];
  }
}

/** As aulas guardadas, da mais recente para a mais antiga. */
export async function listarBancada(): Promise<AulaGuardada[]> {
  return (await lerTudo()).sort((a, b) => b.em - a.em);
}

/**
 * Guarda uma aula. Se o mesmo vídeo já estiver na bancada, a versão nova
 * SUBSTITUI a antiga em vez de duplicar — destrinchar de novo costuma ser
 * correção, não coleção.
 */
export async function guardarAula(aula: AulaGuardada): Promise<void> {
  try {
    const atuais = (await lerTudo()).filter((a) => a.videoId !== aula.videoId);
    const proximo = [aula, ...atuais].slice(0, TETO);
    await chrome.storage.local.set({ [CHAVE]: proximo });
  } catch {
    /* ver comentário em lerTudo: nunca derruba o fluxo principal */
  }
}

export async function esquecerAula(videoId: string): Promise<void> {
  try {
    const restantes = (await lerTudo()).filter((a) => a.videoId !== videoId);
    await chrome.storage.local.set({ [CHAVE]: restantes });
  } catch {
    /* idem */
  }
}

export async function limparBancada(): Promise<void> {
  try {
    await chrome.storage.local.remove(CHAVE);
  } catch {
    /* idem */
  }
}
