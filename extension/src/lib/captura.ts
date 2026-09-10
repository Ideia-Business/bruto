/**
 * Captura da FALA (transcrição literal) do vídeo que a pessoa já está assistindo no YouTube.
 *
 * ESCOPO DURO: esta extensão NUNCA baixa mídia. Não toca em stream de áudio/vídeo, não
 * monta blob, não chama ferramenta de download. A política da Chrome Web Store proíbe
 * extensão que facilite baixar vídeo do YouTube; ler a legenda que o próprio player
 * oferece é o que é permitido. Se algum dia alguém for mexer aqui: o material que entra
 * no Bruto é o *bruto*, e o bruto desta extensão é texto de legenda — nada além.
 *
 * O fluxo é: achar as faixas de legenda → escolher a melhor → baixar o texto dela → parsear.
 */

export interface BrutoCapturado {
  videoId: string;
  titulo: string;
  canal: string | null;
  duracaoSeg: number | null;
  idioma: string | null; // ex "pt", "en"
  /** Transcrição concatenada, texto corrido, sem timestamps. */
  texto: string;
  /** Como foi obtida — vai para a interface. */
  origem: "legenda-manual" | "legenda-automatica";
}

export class CapturaError extends Error {
  readonly codigo: "NAO_E_YOUTUBE" | "SEM_LEGENDA" | "SEM_ACESSO" | "FALHA";

  constructor(codigo: CapturaError["codigo"], mensagem: string) {
    super(mensagem);
    this.codigo = codigo;
    // `name` legível ajuda no console do navegador; sem isso aparece só "Error".
    this.name = "CapturaError";
  }
}

/** Uma faixa de legenda anunciada pelo player, já normalizada para o que nos importa. */
interface FaixaLegenda {
  baseUrl: string;
  /** Código de idioma do YouTube: "pt", "pt-BR", "en", "en-US"… */
  codigoIdioma: string;
  /** true quando `kind === "asr"` — legenda gerada por reconhecimento de fala. */
  automatica: boolean;
  /** Nome exibido pelo YouTube ("Português (Brasil)"), quando vem. */
  nome: string | null;
}

/** Metadados do vídeo que o próprio player já carregou. */
interface MetadadosVideo {
  videoId: string;
  titulo: string;
  canal: string | null;
  duracaoSeg: number | null;
}

const MARCADOR_PLAYER_RESPONSE = "ytInitialPlayerResponse";

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

/** Roda no CONTEXT SCRIPT, na aba do vídeo. */
export async function capturarLegenda(): Promise<BrutoCapturado> {
  const videoIdDaUrl = extrairVideoIdDaUrl(window.location.href);
  if (videoIdDaUrl === null) {
    throw new CapturaError(
      "NAO_E_YOUTUBE",
      "Esta aba não é um vídeo do YouTube. Abra o vídeo que você quer resumir e tente de novo.",
    );
  }

  const playerResponse = await obterPlayerResponse(videoIdDaUrl);
  const metadados = lerMetadados(playerResponse, videoIdDaUrl);
  const faixas = lerFaixasDeLegenda(playerResponse);

  if (faixas.length === 0) {
    // Vídeo com legenda desligada na interface ainda aparece aqui; lista vazia significa
    // mesmo que o YouTube não tem faixa nenhuma para este vídeo.
    throw new CapturaError(
      "SEM_LEGENDA",
      "Este vídeo não tem legenda disponível. Tente outro, ou use o app local, que transcreve o áudio.",
    );
  }

  const escolhida = escolherFaixa(faixas);
  const texto = await baixarEParsear(escolhida.baseUrl);

  if (texto.length === 0) {
    throw new CapturaError(
      "FALHA",
      "A legenda deste vídeo veio vazia. Recarregue a página e tente de novo; se persistir, use o app local.",
    );
  }

  return {
    ...metadados,
    idioma: escolhida.codigoIdioma,
    texto,
    origem: escolhida.automatica ? "legenda-automatica" : "legenda-manual",
  };
}

// ---------------------------------------------------------------------------
// 1. Achar o ytInitialPlayerResponse
// ---------------------------------------------------------------------------

/**
 * POR QUE ASSIM: o content script roda em mundo isolado — ele vê o DOM, mas NÃO vê as
 * variáveis JavaScript da página, então `window.ytInitialPlayerResponse` é sempre
 * `undefined` aqui. Havia três caminhos:
 *
 *  (a) injetar um `<script>` no mundo principal e devolver por `postMessage`;
 *  (b) ler o HTML que já está no documento, onde o YouTube imprime o objeto inline;
 *  (c) re-buscar a página do vídeo com `fetch` e extrair do HTML da resposta.
 *
 * Descartamos (a): o YouTube serve CSP com nonce, então script inline injetado é
 * bloqueado, e `chrome.scripting.executeScript({ world: "MAIN" })` não existe para
 * content script (só para o service worker). Sobraria um vai-e-vem de mensagens só
 * para contornar a CSP.
 *
 * Usamos (b) e, quando (b) não serve, (c). O detalhe que obriga o par: o YouTube é uma
 * SPA — ao navegar de um vídeo para outro, o HTML inline continua sendo o do PRIMEIRO
 * vídeo carregado. Por isso conferimos o `videoId` do objeto contra o da URL; se não
 * bate (ou se nem existe, porque a aba entrou por navegação interna), buscamos o HTML
 * da URL atual. O `fetch` é same-origin: não precisa de permissão de host extra e não
 * baixa mídia nenhuma — é a mesma página HTML que o navegador já renderizou.
 *
 * SE O YOUTUBE MUDAR O FORMATO: a extração devolve `null` e a captura termina em
 * `FALHA` com a mensagem mandando usar o app local. Falha fechada e visível — nunca
 * devolve texto parcial ou inventado. O conserto, nesse dia, mora nesta função e em
 * `lerFaixasDeLegenda`, mais nada.
 */
async function obterPlayerResponse(videoIdDaUrl: string): Promise<Record<string, unknown>> {
  const doHtmlAtual = extrairPlayerResponseDe(document.documentElement.innerHTML);
  if (doHtmlAtual !== null && lerTexto(comoRegistro(doHtmlAtual["videoDetails"]), "videoId") === videoIdDaUrl) {
    return doHtmlAtual;
  }

  let html: string;
  try {
    const resposta = await fetch(window.location.href, { credentials: "include" });
    if (!resposta.ok) {
      throw new CapturaError(
        "SEM_ACESSO",
        `O YouTube respondeu ${resposta.status} ao reler esta página. Recarregue a aba e tente de novo.`,
      );
    }
    html = await resposta.text();
  } catch (erro) {
    if (erro instanceof CapturaError) throw erro;
    throw new CapturaError(
      "SEM_ACESSO",
      "Não foi possível reler a página do vídeo (conexão ou sessão do YouTube). Recarregue a aba e tente de novo.",
    );
  }

  const doFetch = extrairPlayerResponseDe(html);
  if (doFetch === null) {
    throw new CapturaError(
      "FALHA",
      "Não encontrei os dados de legenda nesta página — o YouTube pode ter mudado o formato. Use o app local, que transcreve o áudio.",
    );
  }
  return doFetch;
}

/** Acha `ytInitialPlayerResponse = {...}` num HTML e devolve o objeto já parseado. */
function extrairPlayerResponseDe(html: string): Record<string, unknown> | null {
  const json = recortarObjetoJsonDepoisDe(html, MARCADOR_PLAYER_RESPONSE);
  if (json === null) return null;
  try {
    return comoRegistro(JSON.parse(json));
  } catch {
    return null;
  }
}

/**
 * Recorta o primeiro objeto JSON que aparece depois de `marcador`, contando chaves.
 * Regex não serve aqui: o objeto tem chaves aninhadas e chaves dentro de strings, e
 * expressão regular não equilibra delimitador. A varredura ignora `{`/`}` dentro de
 * string e respeita escape — é o mínimo para não recortar no lugar errado.
 */
function recortarObjetoJsonDepoisDe(html: string, marcador: string): string | null {
  const posMarcador = html.indexOf(marcador);
  if (posMarcador < 0) return null;

  const inicio = html.indexOf("{", posMarcador);
  if (inicio < 0) return null;

  let profundidade = 0;
  let dentroDeString = false;
  let escapando = false;

  for (let i = inicio; i < html.length; i++) {
    const c = html[i];

    if (dentroDeString) {
      if (escapando) escapando = false;
      else if (c === "\\") escapando = true;
      else if (c === '"') dentroDeString = false;
      continue;
    }

    if (c === '"') dentroDeString = true;
    else if (c === "{") profundidade++;
    else if (c === "}") {
      profundidade--;
      if (profundidade === 0) return html.slice(inicio, i + 1);
    }
  }

  return null; // objeto truncado — HTML cortado no meio
}

// ---------------------------------------------------------------------------
// 2. Escolher a faixa
// ---------------------------------------------------------------------------

function lerFaixasDeLegenda(playerResponse: Record<string, unknown>): FaixaLegenda[] {
  const captions = comoRegistro(playerResponse["captions"]);
  const renderer = comoRegistro(captions?.["playerCaptionsTracklistRenderer"]);
  const lista = comoLista(renderer?.["captionTracks"]);
  if (lista === null) return [];

  const faixas: FaixaLegenda[] = [];
  for (const item of lista) {
    const faixa = comoRegistro(item);
    if (faixa === null) continue;

    const baseUrl = lerTexto(faixa, "baseUrl");
    const codigoIdioma = lerTexto(faixa, "languageCode");
    if (baseUrl === null || codigoIdioma === null) continue;

    faixas.push({
      baseUrl,
      codigoIdioma,
      automatica: lerTexto(faixa, "kind") === "asr",
      // `name` é um objeto de texto do YouTube ({ simpleText } ou { runs: [...] }).
      nome: lerTextoExibido(faixa["name"]),
    });
  }
  return faixas;
}

/**
 * Ordem de preferência, e POR QUE:
 *
 *  1. manual em português — legenda escrita por humano é muito melhor que ASR
 *     (pontuação, nomes próprios, números), e o resumo sai em português sem tradução;
 *  2. manual em qualquer outro idioma — ainda ganha de ASR; o resumo traduz depois;
 *  3. automática em português;
 *  4. automática em qualquer idioma.
 *
 * Manual vence idioma porque erro de transcrição é irrecuperável no resumo, enquanto
 * idioma diferente é só uma tradução a mais. Dentro do mesmo nível, a ordem original
 * da lista decide — o YouTube lista a faixa do idioma do vídeo primeiro, então isso
 * dá "senão a original" sem precisarmos adivinhar qual é a original.
 */
function escolherFaixa(faixas: FaixaLegenda[]): FaixaLegenda {
  const pontuar = (faixa: FaixaLegenda): number => {
    const pontoManual = faixa.automatica ? 0 : 2;
    const pontoPortugues = ehPortugues(faixa.codigoIdioma) ? 1 : 0;
    return pontoManual + pontoPortugues;
  };

  let melhor = faixas[0];
  for (const faixa of faixas) {
    if (pontuar(faixa) > pontuar(melhor)) melhor = faixa;
  }
  return melhor;
}

/** Cobre "pt", "pt-BR", "pt-PT" — o YouTube usa as três grafias. */
function ehPortugues(codigoIdioma: string): boolean {
  return codigoIdioma.toLowerCase().startsWith("pt");
}

// ---------------------------------------------------------------------------
// 3. Baixar e parsear a legenda
// ---------------------------------------------------------------------------

/**
 * POR QUE `fmt=json3` PRIMEIRO: a `baseUrl` sem parâmetro devolve XML
 * (`<transcript><text start=… dur=…>…`) cujo texto vem com entidade HTML ESCAPADA DUAS
 * VEZES — um apóstrofo chega como `&amp;#39;`, e decodificar uma vez só deixa `&#39;`
 * visível no resumo. O `json3` entrega o texto já em UTF-8 limpo em `events[].segs[].utf8`,
 * então não há dupla decodificação para errar. Mantemos o XML como segundo caminho porque
 * `json3` é parâmetro não documentado: se ele sair do ar, a captura continua funcionando
 * com a decodificação dupla explícita em `decodificarEntidades`.
 */
async function baixarEParsear(baseUrl: string): Promise<string> {
  const json = await buscarTexto(comUrlFmt(baseUrl, "json3"));
  const deJson = parsearJson3(json);
  if (deJson.length > 0) return deJson;

  const xml = await buscarTexto(baseUrl);
  return parsearXml(xml);
}

function comUrlFmt(baseUrl: string, fmt: string): string {
  const separador = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}${separador}fmt=${fmt}`;
}

async function buscarTexto(url: string): Promise<string> {
  try {
    const resposta = await fetch(url, { credentials: "include" });
    if (!resposta.ok) {
      throw new CapturaError(
        "SEM_ACESSO",
        `O YouTube recusou a legenda deste vídeo (${resposta.status}). Recarregue a aba; se persistir, use o app local, que transcreve o áudio.`,
      );
    }
    return await resposta.text();
  } catch (erro) {
    if (erro instanceof CapturaError) throw erro;
    throw new CapturaError(
      "SEM_ACESSO",
      "Não foi possível baixar a legenda (conexão ou sessão do YouTube). Recarregue a aba e tente de novo.",
    );
  }
}

/** json3: `{ events: [ { segs: [ { utf8: "..." } ] } ] }`. */
function parsearJson3(corpo: string): string {
  let raiz: unknown;
  try {
    raiz = JSON.parse(corpo);
  } catch {
    return ""; // resposta não era json3 — o chamador cai no XML
  }

  const eventos = comoLista(comoRegistro(raiz)?.["events"]);
  if (eventos === null) return "";

  const pedacos: string[] = [];
  for (const evento of eventos) {
    const segs = comoLista(comoRegistro(evento)?.["segs"]);
    if (segs === null) continue;
    for (const seg of segs) {
      const utf8 = lerTexto(comoRegistro(seg), "utf8");
      if (utf8 !== null) pedacos.push(utf8);
    }
  }
  return normalizarEspacos(pedacos.join(" "));
}

/**
 * XML `<transcript><text start="0" dur="3.2">fala</text>…`.
 * Parseamos com DOMParser (nativo, já disponível no content script) em vez de regex,
 * porque o conteúdo de `<text>` pode ter `<br>` e entidades que regex trata mal.
 */
function parsearXml(corpo: string): string {
  const doc = new DOMParser().parseFromString(corpo, "text/xml");
  if (doc.querySelector("parsererror") !== null) return "";

  const pedacos: string[] = [];
  for (const no of Array.from(doc.getElementsByTagName("text"))) {
    const bruto = no.textContent;
    if (bruto === null) continue;
    pedacos.push(decodificarEntidades(bruto));
  }
  return normalizarEspacos(pedacos.join(" "));
}

/**
 * Decodifica entidade HTML DUAS VEZES, de propósito: no XML do YouTube o apóstrofo
 * chega como `&amp;#39;`. O `textContent` do DOMParser resolve o XML (`&amp;` → `&`),
 * sobrando `&#39;` como texto literal — é essa segunda camada que tratamos aqui.
 * `&amp;` fica por último para `&amp;lt;` não virar `<` por acidente.
 */
function decodificarEntidades(entrada: string): string {
  const umaPassada = (s: string): string =>
    s
      .replace(/&nbsp;/g, " ")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
      .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
      .replace(/&amp;/g, "&");

  return umaPassada(umaPassada(entrada));
}

/** Texto corrido: sem quebra de linha, sem espaço duplo, sem espaço antes de pontuação. */
function normalizarEspacos(texto: string): string {
  return texto
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

// ---------------------------------------------------------------------------
// 4. Metadados
// ---------------------------------------------------------------------------

function lerMetadados(playerResponse: Record<string, unknown>, videoIdDaUrl: string): MetadadosVideo {
  const detalhes = comoRegistro(playerResponse["videoDetails"]);
  const duracaoTexto = lerTexto(detalhes, "lengthSeconds"); // o YouTube manda como string
  const duracao = duracaoTexto === null ? NaN : Number(duracaoTexto);

  return {
    videoId: lerTexto(detalhes, "videoId") ?? videoIdDaUrl,
    // Título sempre existe no player; o fallback é para o caso de o campo sumir num
    // redesenho — interface sem título é ruim, mas melhor que a captura inteira falhar.
    titulo: lerTexto(detalhes, "title") ?? document.title.replace(/ - YouTube$/, ""),
    canal: lerTexto(detalhes, "author"),
    duracaoSeg: Number.isFinite(duracao) && duracao > 0 ? duracao : null,
  };
}

/**
 * Aceita as três formas de URL de vídeo: `/watch?v=`, `youtu.be/<id>` e `/shorts/<id>`.
 * Devolve `null` para qualquer outra coisa (inclusive outro domínio), e é esse `null`
 * que vira `NAO_E_YOUTUBE`.
 */
function extrairVideoIdDaUrl(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^(www|m|music)\./, "");

  if (host === "youtu.be") {
    return validarVideoId(url.pathname.slice(1));
  }

  if (host !== "youtube.com") return null;

  const daQuery = url.searchParams.get("v");
  if (daQuery !== null) return validarVideoId(daQuery);

  const shorts = /^\/shorts\/([^/]+)/.exec(url.pathname);
  if (shorts !== null) return validarVideoId(shorts[1]);

  return null;
}

/** Id de vídeo do YouTube: 11 caracteres do alfabeto base64-url. */
function validarVideoId(candidato: string): string | null {
  return /^[A-Za-z0-9_-]{11}$/.test(candidato) ? candidato : null;
}

// ---------------------------------------------------------------------------
// Leitura defensiva de JSON de terceiro
// ---------------------------------------------------------------------------
// O playerResponse é JSON de fora do nosso controle: o formato muda sem aviso. Em vez de
// declarar um tipo grande e afirmar com `as` que a realidade obedece (mentira que o
// compilador aceita), descemos de `unknown` campo por campo. Onde o YouTube mudar, o
// valor vira `null` e o erro aparece no lugar certo.

function comoRegistro(valor: unknown): Record<string, unknown> | null {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : null;
}

function comoLista(valor: unknown): unknown[] | null {
  return Array.isArray(valor) ? valor : null;
}

function lerTexto(objeto: Record<string, unknown> | null, chave: string): string | null {
  if (objeto === null) return null;
  const valor = objeto[chave];
  return typeof valor === "string" && valor.length > 0 ? valor : null;
}

/** Texto exibível do YouTube: `{ simpleText }` ou `{ runs: [{ text }] }`. */
function lerTextoExibido(valor: unknown): string | null {
  const objeto = comoRegistro(valor);
  if (objeto === null) return null;

  const simples = lerTexto(objeto, "simpleText");
  if (simples !== null) return simples;

  const runs = comoLista(objeto["runs"]);
  if (runs === null) return null;

  const partes: string[] = [];
  for (const run of runs) {
    const texto = lerTexto(comoRegistro(run), "text");
    if (texto !== null) partes.push(texto);
  }
  return partes.length > 0 ? partes.join("") : null;
}
