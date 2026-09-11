/**
 * Caderno de Ideias — as faíscas que um vídeo acendeu em você.
 *
 * O QUE É UMA FAÍSCA: uma ideia **sua**, escrita por você, no instante em que o
 * conteúdo a provocou. Não é anotação sobre o vídeo, não é trecho do resumo —
 * é o que você teve vontade de construir. A distinção não é preciosismo: é a
 * razão de o Caderno existir separado da Bancada.
 *
 * POR QUE SEPARADO DA BANCADA: a Bancada guarda o que o Bruto **produziu** (as
 * aulas). O Caderno guarda o que **você** produziu. É a única coisa nesta
 * extensão que nasce de você, e por isso é a que tem valor duradouro — uma aula
 * se refaz em trinta segundos; uma ideia que passou, não volta.
 *
 * ONDE FICA: `chrome.storage.local`, como a chave e a Bancada. Neste navegador,
 * sem conta, sem nuvem, sem servidor nosso. Não existe servidor nosso.
 */

const CHAVE = "bruto:caderno";

/**
 * Teto alto de propósito. Faísca é texto curto (~200 caracteres) e é o artefato
 * que menos se pode perder — diferente da aula, que se regenera. 300 faíscas
 * ocupam menos de 100 KB num armazenamento de ~10 MB.
 */
const TETO = 300;

export interface Faisca {
  /** Identificador local; nada além desta extensão o conhece. */
  id: string;
  /** O que a pessoa escreveu. É dela — nunca reescrevemos nem "melhoramos". */
  texto: string;
  /** De onde veio a provocação. */
  videoId: string | null;
  tituloDoVideo: string | null;
  urlDoVideo: string | null;
  /** Epoch em ms. */
  em: number;
}

async function lerTudo(): Promise<Faisca[]> {
  try {
    const bruto = await chrome.storage.local.get(CHAVE);
    const lista = bruto[CHAVE];
    return Array.isArray(lista) ? (lista as Faisca[]) : [];
  } catch {
    // Armazenamento indisponível não pode derrubar o popup. Mas note a
    // assimetria com `guardarFaisca`: ali a falha é VISÍVEL, porque perder
    // silenciosamente o que alguém acabou de escrever é inaceitável.
    return [];
  }
}

/** As faíscas, da mais recente para a mais antiga. */
export async function listarFaiscas(): Promise<Faisca[]> {
  return (await lerTudo()).sort((a, b) => b.em - a.em);
}

/**
 * Guarda uma faísca. **Lança** se não conseguir — ao contrário do resto da
 * extensão, que degrada em silêncio. Quem acabou de escrever uma ideia precisa
 * saber se ela foi guardada; um "salvo" falso é pior do que um erro honesto.
 */
export async function guardarFaisca(dados: Omit<Faisca, "id" | "em">): Promise<Faisca> {
  const texto = dados.texto.trim();
  if (texto.length === 0) throw new Error("faísca vazia");

  const faisca: Faisca = {
    ...dados,
    texto,
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    em: Date.now(),
  };

  const atuais = await lerTudo();
  await chrome.storage.local.set({ [CHAVE]: [faisca, ...atuais].slice(0, TETO) });
  return faisca;
}

export async function esquecerFaisca(id: string): Promise<void> {
  try {
    const restantes = (await lerTudo()).filter((f) => f.id !== id);
    await chrome.storage.local.set({ [CHAVE]: restantes });
  } catch {
    /* ver comentário em lerTudo */
  }
}

/** Quantas faíscas estão guardadas — o popup usa para o rótulo do atalho. */
export async function contarFaiscas(): Promise<number> {
  return (await lerTudo()).length;
}
