/**
 * Captura da FALA (transcrição literal) do vídeo que a pessoa já está assistindo.
 *
 * ESCOPO DURO: esta extensão NUNCA baixa mídia. Não toca em stream de áudio/vídeo, não
 * monta blob, não chama ferramenta de download. A política da Chrome Web Store proíbe
 * extensão que facilite baixar vídeo do YouTube; ler a transcrição que o próprio player
 * oferece é o que é permitido.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE LEMOS O PAINEL, E NÃO O ENDPOINT DE LEGENDA
 *
 * A versão anterior pegava o `baseUrl` das faixas de legenda no `ytInitialPlayerResponse`
 * e buscava o texto em `/api/timedtext`. **Isso deixou de funcionar.** Medido em 10/09/2026
 * contra três vídeos — um Shorts com legenda automática, um `/watch` comum e um TED com 28
 * faixas MANUAIS: os três devolveram **HTTP 200 com zero bytes**. O YouTube fechou o
 * endpoint (passou a exigir token de origem) e recusa em silêncio: status de sucesso, corpo
 * vazio. A rota interna `/youtubei/v1/player` também devolve zero faixas.
 *
 * O que continua funcionando é o painel "Mostrar transcrição" que o próprio YouTube
 * renderiza: ele busca a transcrição com as credenciais da sessão da pessoa e escreve o
 * resultado no DOM. Nós apenas LEMOS o que já está na tela dela — sem token, sem endpoint
 * privado, sem imitar cliente oficial. É também o mais honesto: se a pessoa não consegue
 * ver a transcrição, o Bruto também não deveria.
 *
 * SOBRE SHORTS: a interface de Shorts não tem esse painel — mas o MESMO vídeo, aberto como
 * `/watch?v=<id>`, tem (medido: em `/shorts/` não há botão nem painel; em `/watch` há os
 * dois). Então Shorts não ficam de fora: o popup leva a aba para a rota que funciona antes
 * de pedir a captura.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { reconhecerLink } from "../../../src/lib/plataformas";

export interface BrutoCapturado {
  videoId: string;
  titulo: string;
  canal: string | null;
  duracaoSeg: number | null;
  idioma: string | null;
  /** Transcrição concatenada, texto corrido, sem timestamps. */
  texto: string;
  origem: "legenda-manual" | "legenda-automatica";
}

export class CapturaError extends Error {
  readonly codigo: "NAO_E_YOUTUBE" | "SEM_LEGENDA" | "SEM_ACESSO" | "FALHA";

  constructor(codigo: CapturaError["codigo"], mensagem: string) {
    super(mensagem);
    this.codigo = codigo;
    this.name = "CapturaError";
  }
}

/**
 * O YouTube migrou a transcrição para os componentes de *view model* — e manteve no
 * DOM um painel antigo, VAZIO, com o `target-id` de sempre. Ler só o antigo devolvia
 * 257 caracteres de quebras de linha enquanto 31 segmentos estavam na tela ao lado.
 *
 * Por isso os dois nomes, nesta ordem: o novo primeiro, o antigo como retaguarda para
 * quem ainda receber a interface velha. Quando o YouTube renomear de novo — e vai —,
 * é aqui que se acrescenta a terceira linha.
 */
const PAINEL = [
  "[target-id='PAmodern_transcript_view']",
  "[target-id='engagement-panel-searchable-transcript']",
].join(",");

const SEGMENTO = "transcript-segment-view-model, ytd-transcript-segment-renderer";

/** Quanto esperamos o YouTube popular o painel. Ele busca da rede; 20s cobre folgado. */
const ESPERA_PAINEL_MS = 20_000;

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

/**
 * Aceita `/watch?v=`, `youtu.be/<id>` e `/shorts/<id>`.
 * Exportada porque o popup usa a MESMA regra para decidir se mostra o botão —
 * havia duas cópias, e a do popup, mais restrita, recusava Shorts.
 */
export function extrairVideoIdDaUrl(href: string): string | null {
  // A regra é a da fonte única (`src/lib/plataformas.ts`): watch, youtu.be,
  // shorts, embed e live. Manter uma cópia aqui era o que fazia a extensão
  // recusar rotas que o app e o README aceitam.
  const ref = reconhecerLink(href);
  if (ref === null || ref.plataforma !== "youtube") return null;
  return validarVideoId(ref.id);
}

function validarVideoId(bruto: string): string | null {
  const limpo = bruto.trim();
  return /^[A-Za-z0-9_-]{11}$/.test(limpo) ? limpo : null;
}

/** Roda no CONTENT SCRIPT, na aba do vídeo. */
export async function capturarLegenda(): Promise<BrutoCapturado> {
  const videoId = extrairVideoIdDaUrl(window.location.href);
  if (videoId === null) {
    throw new CapturaError(
      "NAO_E_YOUTUBE",
      "Esta aba não é um vídeo do YouTube. Abra o vídeo que você quer destrinchar e clique de novo.",
    );
  }

  if (window.location.pathname.startsWith("/shorts/")) {
    throw new CapturaError(
      "SEM_LEGENDA",
      "Shorts não têm painel de transcrição. O popup abre o mesmo vídeo pela rota /watch antes de chegar aqui — se você está vendo esta mensagem, essa troca não aconteceu. Abra o vídeo como youtube.com/watch?v=<id> e tente de novo.",
    );
  }

  await abrirPainelDeTranscricao();
  const { texto, automatica, idioma } = await lerPainel();

  if (texto.length === 0) {
    throw new CapturaError(
      "SEM_LEGENDA",
      "Este vídeo não tem transcrição publicada pelo YouTube. Tente outro, ou use o app local, que transcreve o áudio.",
    );
  }

  return {
    videoId,
    ...lerMetadados(),
    idioma,
    texto,
    origem: automatica ? "legenda-automatica" : "legenda-manual",
  };
}

// ---------------------------------------------------------------------------
// 1. Abrir o painel
// ---------------------------------------------------------------------------

const espera = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Texto visível de um elemento clicável, para casar por rótulo em qualquer idioma. */
function rotulo(n: Element): string {
  return (n.getAttribute("aria-label") ?? n.textContent ?? "").trim();
}

/**
 * Devolve o elemento que REALMENTE responde ao clique.
 *
 * O YouTube empilha invólucros: `ytd-button-renderer` > `yt-button-shape` > `button`,
 * e os três carregam o mesmo rótulo. Uma busca ingênua acha o de fora primeiro (ordem
 * do DOM) e clicar nele não dispara nada — o ouvinte está no `<button>` interno. Foi
 * exatamente esse o sintoma: painel presente, zero segmentos, nenhum erro.
 *
 * Por isso procuramos `button` antes de tudo, e, se o achado não for um, descemos até
 * encontrar um dentro dele.
 */
function acharBotao(padrao: RegExp): HTMLElement | null {
  const porPrioridade = [
    "button",
    "tp-yt-paper-button",
    "yt-button-shape",
    "ytd-button-renderer",
    "a",
  ];

  for (const seletor of porPrioridade) {
    for (const n of Array.from(document.querySelectorAll<HTMLElement>(seletor))) {
      if (!padrao.test(rotulo(n))) continue;
      const interno = n.tagName === "BUTTON" ? null : n.querySelector<HTMLElement>("button");
      return interno ?? n;
    }
  }
  return null;
}

/**
 * O botão de transcrição vive DENTRO da descrição, que nasce recolhida — então ele
 * existe no DOM mas não é clicável até a descrição abrir. Medido: sem expandir antes,
 * o clique não surte efeito e o painel nunca popula.
 *
 * Os padrões aceitam português e inglês porque a interface do YouTube segue o idioma da
 * conta, e a extensão não tem como forçá-lo.
 */
async function abrirPainelDeTranscricao(): Promise<void> {
  // Já aberto (a pessoa pode ter aberto antes de clicar no Bruto): nada a fazer.
  if (document.querySelector(SEGMENTO) !== null) return;

  const expandir = document.querySelector<HTMLElement>("#description-inline-expander #expand, #expand");
  if (expandir !== null) {
    expandir.click();
    await espera(600);
  }

  const botao = acharBotao(/mostrar transcri|show transcript|transcri[çc][ãa]o|transcript/i);
  if (botao === null) {
    throw new CapturaError(
      "SEM_LEGENDA",
      "Este vídeo não tem transcrição — o YouTube não oferece o botão 'Mostrar transcrição' nele.",
    );
  }

  botao.scrollIntoView({ block: "center" });
  botao.click();

  // Um clique pode não pegar: o YouTube troca o rótulo para "Ocultar transcrição"
  // quando abre, então se ele NÃO trocou em ~2,5s, o clique não surtiu efeito e
  // tentamos de novo. Melhor uma segunda tentativa do que 20s de espera inútil
  // terminando num erro que não diz nada.
  await espera(2500);
  if (document.querySelector(SEGMENTO) !== null) return;

  const aindaFechado = acharBotao(/mostrar transcri|show transcript/i);
  if (aindaFechado !== null) {
    aindaFechado.click();
  }
}

// ---------------------------------------------------------------------------
// 2. Ler o painel
// ---------------------------------------------------------------------------

interface LeituraPainel {
  texto: string;
  automatica: boolean;
  idioma: string | null;
}

/**
 * Espera os segmentos aparecerem e lê. O YouTube popula o painel por rede, então a
 * espera é obrigatória — ler logo após o clique devolve painel vazio, que foi
 * exatamente o sintoma que nos fez investigar.
 */
async function lerPainel(): Promise<LeituraPainel> {
  const limite = Date.now() + ESPERA_PAINEL_MS;
  let segmentos: HTMLElement[] = [];

  while (Date.now() < limite) {
    segmentos = Array.from(document.querySelectorAll<HTMLElement>(SEGMENTO));
    if (segmentos.length > 0) break;
    await espera(300);
  }

  if (segmentos.length === 0) {
    // Pode ser vídeo sem transcrição, ou o YouTube não ter respondido. Distinguimos
    // pelo painel: se ele nem existe, o vídeo não oferece transcrição.
    const painel = document.querySelector(PAINEL);
    if (painel === null) {
      throw new CapturaError(
        "SEM_LEGENDA",
        "Este vídeo não tem transcrição publicada pelo YouTube. Tente outro, ou use o app local.",
      );
    }
    // Diagnóstico embutido na mensagem: sem ele, o relato que chega é só "travou",
    // e a causa (clique que não pegou × YouTube que não respondeu) fica indistinguível.
    const rotuloAtual = acharBotao(/transcri|transcript/i);
    const estado = rotuloAtual === null ? "botão sumiu" : `botão diz "${rotulo(rotuloAtual)}"`;
    throw new CapturaError(
      "SEM_ACESSO",
      `O YouTube abriu a transcrição mas não a carregou em ${ESPERA_PAINEL_MS / 1000}s (${estado}). ` +
        "Abra a transcrição você mesmo na página, pelo botão da descrição, e clique no Bruto de novo.",
    );
  }

  const pedacos: string[] = [];
  for (const seg of segmentos) {
    const t = textoDoSegmento(seg);
    if (t.length > 0) pedacos.push(t);
  }

  return {
    texto: normalizarEspacos(pedacos.join(" ")),
    ...lerRodapeDoPainel(),
  };
}

/**
 * O rodapé do painel nomeia a faixa — "Português (gerada automaticamente)" ou
 * "Português". É de lá que sai a origem e o idioma, porque o DOM do painel não expõe
 * o código de idioma em atributo.
 */
function lerRodapeDoPainel(): { automatica: boolean; idioma: string | null } {
  const painel = document.querySelector(PAINEL);
  const texto = painel?.textContent ?? "";
  const automatica = /gerada automaticamente|auto-generated|automatic/i.test(texto);

  // O seletor de faixa aparece como botão/dropdown no rodapé.
  const seletor = painel?.querySelector("yt-dropdown-menu, tp-yt-paper-listbox, #footer");
  const nome = (seletor?.textContent ?? "").trim().split("\n")[0]?.trim() ?? "";
  const idioma = nome.length > 0 && nome.length < 60 ? nome : null;

  return { automatica, idioma };
}

// ---------------------------------------------------------------------------
// 3. Metadados
// ---------------------------------------------------------------------------

/**
 * Lidos do DOM, não do `ytInitialPlayerResponse`. Motivo: o JSON embutido é do PRIMEIRO
 * vídeo que a aba carregou (o YouTube é SPA), então navegar entre vídeos o deixa velho —
 * e contorná-lo exigia re-buscar a página inteira. O DOM sempre reflete o vídeo atual.
 */
function lerMetadados(): { titulo: string; canal: string | null; duracaoSeg: number | null } {
  const h1 = document.querySelector("h1.ytd-watch-metadata, #title h1");
  const tituloDom = (h1?.textContent ?? "").trim();
  const titulo =
    tituloDom.length > 0 ? tituloDom : document.title.replace(/\s*-\s*YouTube\s*$/, "").trim();

  const canalNo = document.querySelector("#owner #channel-name a, ytd-channel-name a");
  const canal = (canalNo?.textContent ?? "").trim() || null;

  const video = document.querySelector("video");
  const bruta = video?.duration;
  const duracaoSeg =
    typeof bruta === "number" && Number.isFinite(bruta) && bruta > 0 ? Math.round(bruta) : null;

  return { titulo: titulo || "Vídeo do YouTube", canal, duracaoSeg };
}

/**
 * Texto de um segmento, SEM o timestamp.
 *
 * Não dependemos do nome da classe do nó de texto — ele já mudou uma vez
 * (`.segment-text` → componentes `ytw*`) e vai mudar de novo. Em vez disso, removemos
 * o que É timestamp e ficamos com o resto: mais estável, porque a marcação de tempo é
 * reconhecível pelo formato (`0:06`), não pelo nome que o YouTube deu a ela hoje.
 */
function textoDoSegmento(seg: Element): string {
  const copia = seg.cloneNode(true) as HTMLElement;

  // Remove por classe (funciona nas duas gerações) e, por garantia, qualquer folha
  // que seja só um horário.
  for (const n of Array.from(copia.querySelectorAll<HTMLElement>("*"))) {
    const classe = typeof n.className === "string" ? n.className : "";
    const ehFolha = n.children.length === 0;
    if (/timestamp/i.test(classe) || (ehFolha && /^\d{1,2}:\d{2}(:\d{2})?$/.test((n.textContent ?? "").trim()))) {
      n.remove();
    }
  }

  return normalizarEspacos(copia.textContent ?? "");
}

function normalizarEspacos(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}
