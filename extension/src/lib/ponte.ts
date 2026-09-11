/**
 * A ponte — leva uma faísca do Caderno para o Lapid.ai.
 *
 * O QUE ATRAVESSA: a anotação de quem escreveu, e **só ela**. Não o resumo do
 * vídeo. O Lapid trabalha a ideia da PESSOA; mandar para lá o resumo de um vídeo
 * alheio produziria uma especificação do produto *do vídeo* — plausível, inútil,
 * e gastando o primeiro dos créditos gratuitos dela exatamente no momento que
 * deveria provar valor.
 *
 * POR QUE DOIS MECANISMOS: hoje o Lapid recebe a ideia por `location.state` do
 * React Router (`src/pages/Lapidar.tsx`), que só existe em navegação interna —
 * um link vindo daqui não consegue passar. Então fazemos as duas coisas:
 *
 *  1. **Área de transferência** — funciona HOJE. A pessoa chega lá com a ideia
 *     copiada e cola. É o caminho real enquanto o outro não existir.
 *  2. **A URL com `?ideia=`** — não faz nada hoje, e é de propósito. No dia em
 *     que o Lapid passar a ler esse parâmetro, a ponte melhora sozinha, sem
 *     tocar nesta extensão nem pedir a ninguém que atualize nada. Parâmetro
 *     ignorado não quebra página nenhuma.
 *
 * A alternativa seria esperar o Lapid mudar para então entregar a ponte. Não
 * vale: prende uma entrega deste produto a um deploy de outro.
 */

const BASE = "https://lapid.ai/lapidar";

/**
 * Limite do texto na URL. Navegadores toleram bem mais, mas faísca é anotação
 * curta — acima disso o excesso é ruído, e o texto íntegro vai pela área de
 * transferência de qualquer forma.
 */
const MAX_URL = 1200;

export interface ResultadoPonte {
  /** A ideia foi para a área de transferência? Se não, a pessoa precisa saber. */
  copiada: boolean;
  url: string;
}

export function montarUrl(texto: string): string {
  const u = new URL(BASE);
  u.searchParams.set("ideia", texto.slice(0, MAX_URL));
  // Identifica a origem sem carregar nada da pessoa — serve para o Lapid saber
  // de onde o tráfego vem, se um dia quiser medir.
  u.searchParams.set("de", "bruto");
  return u.toString();
}

/**
 * Copia a faísca e abre o Lapid numa aba nova.
 *
 * A cópia é tentada ANTES de abrir: se falhar, a pessoa ainda está aqui e pode
 * ser avisada. Abrir primeiro e falhar depois deixaria alguém numa página vazia
 * sem saber por quê.
 */
export async function levarParaLapid(texto: string): Promise<ResultadoPonte> {
  const url = montarUrl(texto);

  let copiada = false;
  try {
    await navigator.clipboard.writeText(texto);
    copiada = true;
  } catch {
    // Sem permissão de área de transferência, ou contexto não-seguro. Não é
    // fatal: a aba abre do mesmo jeito e a pessoa reescreve. Mas ela precisa
    // saber que vai ter de reescrever.
    copiada = false;
  }

  await chrome.tabs.create({ url });
  return { copiada, url };
}
