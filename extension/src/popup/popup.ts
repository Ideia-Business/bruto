/**
 * Bruto — popup.
 *
 * O popup NÃO roda no contexto da página. Para pegar a fala, ele conversa com o
 * content script da aba ativa (`chrome.tabs.sendMessage`). Escolhemos a mensagem
 * em vez de `executeScript({ func })` por dois motivos: (a) uma função injetada
 * é serializada e perde o escopo do módulo — `capturarLegenda` importa helpers e
 * quebraria; (b) pela mensagem o erro chega como objeto simples, então o código
 * de `CapturaError` sobrevive à travessia. Se a aba ainda não tem o content
 * script (instalação recém-feita), injetamos o arquivo com
 * `chrome.scripting.executeScript({ files })` e repetimos o pedido.
 */

import { extrairVideoIdDaUrl } from "../lib/captura";
import type { BrutoCapturado, CapturaError } from "../lib/captura";
import { runLLM, LlmError, verModo } from "../lib/llm";
import {
  AppLocalError,
  APP_BASE,
  enviarLinkAoApp,
  verSaudeDoApp,
  type FalhaDoApp,
  type ResultadoEnvio,
} from "../lib/app-local";
import { guardarAula, listarBancada, esquecerAula, limparBancada } from "../lib/bancada";
import type { AulaGuardada } from "../lib/bancada";
import { guardarFaisca, listarFaiscas, esquecerFaisca } from "../lib/caderno";
import { levarParaLapid } from "../lib/ponte";
import { renderMarkdown } from "../lib/markdown";
import { studyPrompt } from "../../../src/pipeline/prompts/study";
import {
  detectarPlataforma,
  NAO_SUPORTADO,
  PLATAFORMAS,
  PLATAFORMA_POR_ID,
  type PlataformaId,
} from "../../../src/lib/plataformas";

type CodigoCaptura = CapturaError["codigo"];
type CodigoLlm = LlmError["codigo"];

type RespostaCaptura =
  | { ok: true; bruto: BrutoCapturado }
  | { ok: false; codigo: CodigoCaptura; message: string };

type Falha = { titulo: string; saida: string };

const ARQUIVO_CONTENT = "content/captura.js";

// --- elementos --------------------------------------------------------

function el<T extends HTMLElement>(id: string): T {
  const n = document.getElementById(id);
  if (!n) throw new Error(`elemento ausente: ${id}`);
  return n as T;
}

const telas = {
  semConfig: el<HTMLElement>("tela-sem-config"),
  naoYoutube: el<HTMLElement>("tela-nao-youtube"),
  appLocal: el<HTMLElement>("tela-app-local"),
  pronto: el<HTMLElement>("tela-pronto"),
  rodando: el<HTMLElement>("tela-rodando"),
  aula: el<HTMLElement>("tela-aula"),
  bancada: el<HTMLElement>("tela-bancada"),
  caderno: el<HTMLElement>("tela-caderno"),
  erro: el<HTMLElement>("tela-erro"),
} as const;

type NomeTela = keyof typeof telas;

function mostrar(nome: NomeTela): void {
  for (const chave of Object.keys(telas) as NomeTela[]) {
    telas[chave].hidden = chave !== nome;
  }
}

const progresso = el<HTMLParagraphElement>("progresso");
const aulaBox = el<HTMLElement>("aula");
const avisoAula = el<HTMLParagraphElement>("aviso-aula");
const erroMsg = el<HTMLParagraphElement>("erro-msg");
const erroSaida = el<HTMLParagraphElement>("erro-saida");
const prontoTitulo = el<HTMLParagraphElement>("pronto-titulo");
const prontoDado = el<HTMLParagraphElement>("pronto-dado");
const btnDestrinchar = el<HTMLButtonElement>("btn-destrinchar");
const bancadaLista = el<HTMLUListElement>("bancada-lista");
const bancadaVazia = el<HTMLParagraphElement>("bancada-vazia");
const cadernoLista = el<HTMLUListElement>("caderno-lista");
const cadernoVazio = el<HTMLParagraphElement>("caderno-vazio");
const cadernoSobre = el<HTMLParagraphElement>("caderno-sobre");
const cadernoAviso = el<HTMLParagraphElement>("caderno-aviso");
const capturaFaisca = el<HTMLFormElement>("captura-faisca");
const faiscaTexto = el<HTMLTextAreaElement>("faisca-texto");
const faiscaAviso = el<HTMLSpanElement>("faisca-aviso");
const naoYoutubeLista = el<HTMLUListElement>("nao-youtube-lista");
const naoYoutubeNaoSuportado = el<HTMLSpanElement>("nao-youtube-nao-suportado");
const appLocalTitulo = el<HTMLHeadingElement>("app-local-titulo");
const appLocalNota = el<HTMLParagraphElement>("app-local-nota");
const appLocalLista = el<HTMLUListElement>("app-local-lista");
const appLocalEstado = el<HTMLParagraphElement>("app-local-estado");
const btnAppLocal = el<HTMLButtonElement>("btn-app-local");

// --- estado -----------------------------------------------------------

let abaId: number | null = null;
let urlDaAba: string | null = null;
let controle: AbortController | null = null;
/** Trava de reentrada do "Destrinchar" — cada clique extra é uma chamada paga. */
let emAndamento = false;
/** Trava de reentrada do envio ao app local — mesmo motivo do `emAndamento` acima. */
let enviandoAoApp = false;
/**
 * Para onde "Voltar" (da Bancada/Caderno) leva. Não dá para inferir só de
 * `abaId !== null`: a tela de Instagram/TikTok também guarda `abaId`, e
 * `abaId === null ? naoYoutube : pronto` mandaria essas abas de volta para a
 * tela de destrinchar do YouTube, que não é a delas.
 */
let telaInicial: NomeTela = "naoYoutube";
let aulaMd = "";
/** Título da aula em exibição — vem do bruto capturado OU da bancada. */
let tituloAtual = "aula";
/** De qual vídeo é a aula na tela. A faísca precisa saber o que a provocou. */
let origemAtual: { videoId: string | null; titulo: string | null; url: string | null } = {
  videoId: null,
  titulo: null,
  url: null,
};

// --- utilidades -------------------------------------------------------

/**
 * Reusa a MESMA regra da captura, de propósito. Antes havia uma segunda cópia
 * aqui, mais restrita: ela só aceitava `/watch`, então o popup recusava Shorts
 * que o módulo de captura sabia ler perfeitamente. Duas regras para a mesma
 * pergunta divergem — agora existe uma só, e quem a muda muda para os dois.
 */
function ehVideoYoutube(url: string | undefined): boolean {
  return url !== undefined && extrairVideoIdDaUrl(url) !== null;
}

function nomeArquivo(titulo: string): string {
  const base = titulo
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 60);
  return `bruto-${base || "aula"}.md`;
}

// --- compatibilidade de plataformas ------------------------------------

/**
 * A MESMA lista para as duas telas que precisam dela (`tela-nao-youtube` e
 * `tela-app-local`) — gerada uma vez a partir de `PLATAFORMAS`, a fonte
 * única. Duplicar isto em HTML era o defeito que `src/lib/plataformas.ts`
 * existe para acabar.
 */
function montarListaDePlataformas(): DocumentFragment {
  const fragmento = document.createDocumentFragment();
  for (const p of PLATAFORMAS) {
    const li = document.createElement("li");

    const nome = document.createElement("span");
    nome.className = "nome";
    nome.textContent = p.label;

    const onde: string[] = [];
    if (p.naExtensao) onde.push("extensão");
    if (p.noAppLocal) onde.push("app local");

    const local = document.createElement("span");
    local.className = "onde";
    local.textContent = onde.length > 0 ? onde.join(" · ") : "não suportado";

    li.append(nome, local);
    fragmento.append(li);
  }
  return fragmento;
}

// A lista é estática (não depende de estado da aba) — monta uma vez, no
// carregamento do popup, e as duas telas compartilham o resultado.
naoYoutubeLista.replaceChildren(montarListaDePlataformas());
naoYoutubeNaoSuportado.textContent = NAO_SUPORTADO.join(" · ");
appLocalLista.replaceChildren(montarListaDePlataformas());

function tituloAppLocal(plataforma: "instagram" | "tiktok"): string {
  return plataforma === "instagram"
    ? "Isto é um Reel do Instagram"
    : "Isto é um vídeo do TikTok";
}

/**
 * Monta a tela de Instagram/TikTok e sonda o app ANTES de deixar clicar —
 * sem app de pé, o POST falharia de todo jeito, e é melhor dizer isso na
 * hora de abrir a tela do que só depois do clique.
 */
async function prepararTelaAppLocal(plataforma: "instagram" | "tiktok"): Promise<void> {
  const p = PLATAFORMA_POR_ID[plataforma];
  appLocalTitulo.textContent = tituloAppLocal(plataforma);
  appLocalNota.textContent = p.nota;
  appLocalEstado.hidden = true;
  btnAppLocal.disabled = true;
  telaInicial = "appLocal";
  mostrar("appLocal");

  const saude = await verSaudeDoApp();
  if (saude === null) {
    appLocalEstado.hidden = false;
    appLocalEstado.className = "estado atencao";
    appLocalEstado.textContent =
      "O app do Bruto não está aberto. Abra-o (npm run app) e clique de novo.";
    return;
  }
  btnAppLocal.disabled = false;
}

function mostrarResultadoDoEnvio(resultado: ResultadoEnvio): void {
  if (resultado.resultado === "recusado") {
    appLocalEstado.hidden = false;
    appLocalEstado.className = "estado ruim";
    appLocalEstado.textContent = resultado.motivo;
    return;
  }
  const destino =
    resultado.resultado === "enfileirado"
      ? `${APP_BASE}/processing`
      : `${APP_BASE}/video/${resultado.videoId}`;
  void chrome.tabs.create({ url: destino });
}

async function enviarParaAppLocal(): Promise<void> {
  if (urlDaAba === null || enviandoAoApp) return;
  enviandoAoApp = true;
  btnAppLocal.disabled = true;
  appLocalEstado.hidden = true;

  try {
    const resultado = await enviarLinkAoApp(urlDaAba);
    mostrarResultadoDoEnvio(resultado);
  } catch {
    appLocalEstado.hidden = false;
    appLocalEstado.className = "estado ruim";
    appLocalEstado.textContent = "Algo travou ao enviar para o app.";
  } finally {
    enviandoAoApp = false;
    btnAppLocal.disabled = false;
  }
}

btnAppLocal.addEventListener("click", () => {
  void enviarParaAppLocal();
});

// --- captura ----------------------------------------------------------

async function pedirBruto(tabId: number): Promise<RespostaCaptura> {
  return (await chrome.tabs.sendMessage(tabId, {
    tipo: "bruto:capturar",
  })) as RespostaCaptura;
}

async function pegarBruto(tabId: number): Promise<BrutoCapturado> {
  let resposta: RespostaCaptura;
  try {
    resposta = await pedirBruto(tabId);
  } catch {
    // Content script ainda não está na aba: injeta e pergunta de novo.
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [ARQUIVO_CONTENT],
    });
    resposta = await pedirBruto(tabId);
  }

  if (resposta.ok) return resposta.bruto;
  throw { codigo: resposta.codigo, message: resposta.message };
}

// --- bancada ----------------------------------------------------------

function quando(em: number): string {
  const min = Math.round((Date.now() - em) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  return new Date(em).toLocaleDateString("pt-BR");
}

function mostrarAulaGuardada(a: AulaGuardada): void {
  aulaMd = a.markdown;
  tituloAtual = a.titulo;
  origemAtual = { videoId: a.videoId, titulo: a.titulo, url: a.url };
  faiscaTexto.value = "";
  faiscaAviso.hidden = true;
  aulaBox.innerHTML = renderMarkdown(a.markdown);
  avisoAula.hidden = true;
  mostrar("aula");
}

async function pintarBancada(): Promise<void> {
  const aulas = await listarBancada();
  bancadaLista.replaceChildren();
  bancadaVazia.hidden = aulas.length > 0;

  for (const a of aulas) {
    const li = document.createElement("li");

    const abrir = document.createElement("button");
    abrir.type = "button";
    abrir.className = "abrir";
    const t = document.createElement("span");
    t.className = "titulo";
    t.textContent = a.titulo;
    const m = document.createElement("span");
    m.className = "meta";
    m.textContent = [a.canal, quando(a.em)].filter(Boolean).join(" · ");
    abrir.append(t, m);
    abrir.addEventListener("click", () => mostrarAulaGuardada(a));

    const esquecer = document.createElement("button");
    esquecer.type = "button";
    esquecer.className = "esquecer";
    esquecer.textContent = "Esquecer";
    esquecer.setAttribute("aria-label", `Esquecer ${a.titulo}`);
    esquecer.addEventListener("click", () => {
      void esquecerAula(a.videoId).then(pintarBancada);
    });

    li.append(abrir, esquecer);
    bancadaLista.append(li);
  }
}

// --- caderno de ideias ------------------------------------------------

function avisarCaderno(texto: string, ok: boolean): void {
  cadernoAviso.textContent = texto;
  cadernoAviso.className = ok ? "estado ok" : "estado ruim";
  cadernoAviso.hidden = false;
}

async function pintarCaderno(): Promise<void> {
  const faiscas = await listarFaiscas();
  cadernoLista.replaceChildren();
  cadernoVazio.hidden = faiscas.length > 0;
  // A explicação do que é o Lapid aparece uma vez, no topo, e só quando há
  // faísca — não repetida em cada botão, e nunca antes de existir o que levar.
  cadernoSobre.hidden = faiscas.length === 0;
  cadernoAviso.hidden = true;

  for (const f of faiscas) {
    const li = document.createElement("li");

    const conteudo = document.createElement("div");
    conteudo.className = "conteudo";

    const texto = document.createElement("span");
    texto.className = "texto";
    texto.textContent = f.texto;

    const origem = document.createElement("span");
    origem.className = "origem";
    if (f.urlDoVideo !== null && f.tituloDoVideo !== null) {
      const link = document.createElement("a");
      link.href = f.urlDoVideo;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = f.tituloDoVideo;
      origem.append(quando(f.em) + " · de ", link);
    } else {
      origem.textContent = quando(f.em);
    }

    conteudo.append(texto, origem);

    // A ponte é um CONVITE ligado ao que a pessoa produziu, por faísca — nunca
    // um banner interrompendo outra coisa. É a única menção ao produto pago
    // dentro da extensão, e só aparece aqui, no Caderno.
    const lapidar = document.createElement("button");
    lapidar.type = "button";
    lapidar.className = "lapidar";
    lapidar.textContent = "Lapidar";
    lapidar.title = "Levar esta ideia para o Lapid.ai";
    lapidar.addEventListener("click", () => {
      void levarParaLapid(f.texto).then(({ copiada }) => {
        avisarCaderno(
          copiada
            ? "Ideia copiada. Cole lá no Lapid para começar."
            : "Abri o Lapid, mas não consegui copiar — reescreva a ideia por lá.",
          copiada,
        );
      });
    });

    const esquecer = document.createElement("button");
    esquecer.type = "button";
    esquecer.className = "esquecer";
    esquecer.textContent = "Esquecer";
    esquecer.setAttribute("aria-label", "Esquecer esta faísca");
    esquecer.addEventListener("click", () => {
      void esquecerFaisca(f.id).then(pintarCaderno);
    });

    li.append(conteudo, lapidar, esquecer);
    cadernoLista.append(li);
  }
}

function avisarFaisca(texto: string, ok: boolean): void {
  faiscaAviso.textContent = texto;
  faiscaAviso.className = ok ? "estado ok" : "estado ruim";
  faiscaAviso.hidden = false;
}

capturaFaisca.addEventListener("submit", (e) => {
  e.preventDefault();
  const texto = faiscaTexto.value.trim();
  if (texto.length === 0) {
    avisarFaisca("Escreva a ideia antes de guardar.", false);
    return;
  }
  void guardarFaisca({
    texto,
    videoId: origemAtual.videoId,
    tituloDoVideo: origemAtual.titulo,
    urlDoVideo: origemAtual.url,
  })
    .then(() => {
      faiscaTexto.value = "";
      avisarFaisca("Guardado no caderno.", true);
    })
    .catch(() => {
      // Falha aqui é VISÍVEL de propósito: o texto continua no campo, então
      // ninguém perde o que escreveu por causa de um "salvo" que mentiu.
      avisarFaisca("Não deu para guardar. Copie o texto antes de fechar.", false);
    });
});

// --- mensagens de falha ----------------------------------------------

function falhaDeCaptura(codigo: CodigoCaptura, msg: string): Falha {
  switch (codigo) {
    case "NAO_E_YOUTUBE":
      return {
        titulo: "Essa aba não tem um vídeo do YouTube.",
        saida: "Abra o vídeo e clique no Bruto de novo.",
      };
    case "SEM_LEGENDA":
      return {
        titulo: "Esse vídeo não tem fala escrita.",
        saida:
          "O YouTube não publicou legenda para ele. Tente outro vídeo do mesmo canal.",
      };
    case "SEM_ACESSO":
      // Mostra a mensagem real, não um texto genérico: ela carrega o diagnóstico
      // (quanto esperou, em que estado o botão ficou) que distingue "o clique não
      // pegou" de "o YouTube não respondeu". Sem isso, o relato que chega é "travou".
      return {
        titulo: msg || "O YouTube não deixou pegar a fala.",
        saida: "Se repetir, abra a transcrição na página e clique no Bruto de novo.",
      };
    default:
      return {
        titulo: msg || "A captura da fala falhou.",
        saida: "Recarregue a página e tente de novo.",
      };
  }
}

/**
 * Falha do app local. A saída NÃO é "tente de novo" em todos os casos: repetir
 * um vídeo longo demais dá o mesmo 413 para sempre, e repetir um 415 esconde um
 * defeito nosso atrás da impressão de instabilidade.
 */
function falhaDoApp(causa: FalhaDoApp, msg: string): Falha {
  switch (causa) {
    case "GRANDE_DEMAIS":
      return { titulo: msg, saida: "Repetir não muda — o vídeo é que é grande demais." };
    case "TIPO_RECUSADO":
    case "PEDIDO_INVALIDO":
      return { titulo: msg, saida: "Enquanto isso, uma chave de API nas opções faz a aula sair." };
    case "SEM_PLANO":
      return {
        titulo: msg,
        saida: "Confira o provedor de plano no app, ou ponha uma chave nas opções.",
      };
    case "RESPOSTA_INVALIDA":
      return { titulo: msg, saida: "Atualize o app do Bruto — ele e a extensão não estão falando a mesma língua." };
    case "INDISPONIVEL":
      return { titulo: msg, saida: "O app caiu no meio do caminho. Suba-o de novo e tente outra vez." };
  }
}

function falhaDoModelo(codigo: CodigoLlm, msg: string): Falha {
  switch (codigo) {
    case "SEM_CONFIG":
      return {
        titulo: "Falta a sua chave.",
        saida: "Abra as opções e coloque a chave do seu provedor.",
      };
    case "CREDENCIAL":
      return {
        titulo: "O provedor recusou a chave.",
        saida: "Confira a chave nas opções e use Testar credencial.",
      };
    case "COTA":
      return {
        titulo: "Sua cota no provedor acabou.",
        saida: "Recarregue crédito na conta do provedor e volte aqui.",
      };
    case "FORA_DO_AR":
      return {
        titulo: "O provedor está fora do ar.",
        saida: "Espere uns minutos e tente de novo.",
      };
    default:
      return {
        titulo: msg || "O modelo não respondeu.",
        saida: "Tente de novo. Se repetir, troque de provedor nas opções.",
      };
  }
}

function ehErroDeCaptura(e: unknown): e is { codigo: CodigoCaptura; message: string } {
  if (typeof e !== "object" || e === null) return false;
  const codigo = (e as { codigo?: unknown }).codigo;
  return (
    codigo === "NAO_E_YOUTUBE" ||
    codigo === "SEM_LEGENDA" ||
    codigo === "SEM_ACESSO" ||
    codigo === "FALHA"
  );
}

function mostrarFalha(f: Falha): void {
  erroMsg.textContent = f.titulo;
  erroSaida.textContent = f.saida;
  mostrar("erro");
}

// --- fluxo ------------------------------------------------------------

function passo(texto: string): void {
  progresso.textContent = texto;
}

/**
 * Shorts não têm o painel de transcrição — mas o MESMO vídeo, aberto como
 * `/watch?v=<id>`, tem. Medido em 10/09/2026: em `/shorts/` não há botão nem
 * painel; em `/watch` há os dois. Então, em vez de recusar Shorts, levamos a aba
 * para a rota que funciona.
 *
 * Mudar a aba de quem clicou é intrusivo, então é anunciado no passo a passo em
 * vez de acontecer calado — e só depois do clique em "Destrinchar", nunca antes.
 */
async function levarParaRotaComTranscricao(tabId: number, url: string): Promise<void> {
  const id = extrairVideoIdDaUrl(url);
  if (id === null) return;
  if (!new URL(url).pathname.startsWith("/shorts/")) return;

  passo("Shorts não tem transcrição — abrindo o mesmo vídeo pela rota normal…");
  await chrome.tabs.update(tabId, { url: `https://www.youtube.com/watch?v=${id}` });

  // Espera a navegação terminar. Sem isso, injetamos o content script na página
  // antiga e ele lê o DOM errado.
  const limite = Date.now() + 20_000;
  while (Date.now() < limite) {
    await new Promise((r) => setTimeout(r, 400));
    const aba = await chrome.tabs.get(tabId);
    if (aba.status === "complete" && (aba.url ?? "").includes("/watch")) break;
  }
  // O YouTube ainda monta a página depois do "complete"; um respiro evita
  // procurar o botão antes de ele existir.
  await new Promise((r) => setTimeout(r, 1500));
}

async function destrinchar(): Promise<void> {
  if (abaId === null) return;

  // GUARDA DE REENTRADA. Sem ela, dois cliques rápidos disparam duas capturas e
  // **duas chamadas pagas** na chave de quem usa — e a segunda sobrescrevia
  // `controle`, deixando o Cancelar apontando para a execução errada. Desabilitar
  // o botão não basta: clique de teclado e duplo clique chegam aqui antes.
  if (emAndamento) return;
  emAndamento = true;
  btnDestrinchar.disabled = true;

  // Controlador LOCAL a esta execução; `controle` guarda só a referência do que
  // corre agora, para o Cancelar alcançar.
  const meuControle = new AbortController();
  controle = meuControle;
  mostrar("rodando");
  passo("Pegando a fala do vídeo…");

  try {
    if (urlDaAba !== null) await levarParaRotaComTranscricao(abaId, urlDaAba);
    if (meuControle.signal.aborted) return;
    const bruto = await pegarBruto(abaId);
    tituloAtual = bruto.titulo;
    origemAtual = {
      videoId: bruto.videoId,
      titulo: bruto.titulo,
      url: `https://www.youtube.com/watch?v=${bruto.videoId}`,
    };
    faiscaTexto.value = "";
    faiscaAviso.hidden = true;

    if (meuControle.signal.aborted) return;
    passo(`Fala pega: ${bruto.texto.length.toLocaleString("pt-BR")} caracteres. Destrinchando…`);

    // O prompt é o MESMO que o app local usa — vem de src/pipeline/prompts.
    // É o da AULA, não o do resumo: objetivos, conceitos do zero, glossário e
    // teste de fixação. É o que a extensão promete na Loja e o que o BRAND.md
    // define como Aula — antes daqui saía um resumo executivo com esse nome.
    const prompt = studyPrompt({ title: bruto.titulo, channel: bruto.canal });

    const md = await runLLM({
      prompt,
      input: bruto.texto,
      tier: "balanced",
      timeoutMs: 180_000,
      signal: meuControle.signal,
    });

    if (meuControle.signal.aborted) return;

    aulaMd = md.trim();
    aulaBox.innerHTML = renderMarkdown(aulaMd);
    avisoAula.hidden = true;
    mostrar("aula");

    // Guarda ANTES de qualquer outra coisa: produzir isto consumiu o plano ou a
    // chave da pessoa, e fechar o popup não pode significar perder o trabalho.
    const modoAgora = await verModo();
    void guardarAula({
      videoId: bruto.videoId,
      titulo: bruto.titulo,
      canal: bruto.canal,
      url: `https://www.youtube.com/watch?v=${bruto.videoId}`,
      markdown: aulaMd,
      em: Date.now(),
      // Registra de onde a aula veio: no modo app é o plano, e guardar o nome de
      // um provedor de chave aqui seria registro falso.
      provedor: modoAgora.qual === "app" ? "app-local" : (modoAgora.config?.provedor ?? null),
    });
  } catch (e: unknown) {
    if (meuControle.signal.aborted) {
      mostrar("pronto");
      return;
    }
    if (e instanceof LlmError) {
      mostrarFalha(falhaDoModelo(e.codigo, e.message));
      return;
    }
    if (e instanceof AppLocalError) {
      mostrarFalha(falhaDoApp(e.causa, e.message));
      return;
    }
    if (ehErroDeCaptura(e)) {
      mostrarFalha(falhaDeCaptura(e.codigo, e.message));
      return;
    }
    mostrarFalha({
      titulo: e instanceof Error ? e.message : "Algo travou no caminho.",
      saida: "Tente de novo.",
    });
  } finally {
    // Libera SEMPRE — sucesso, erro ou cancelamento. Guarda que não se solta em
    // algum caminho trava o botão para sempre, e o sintoma seria "o Bruto parou
    // de funcionar", sem erro nenhum na tela.
    if (controle === meuControle) controle = null;
    emAndamento = false;
    btnDestrinchar.disabled = false;
  }
}

// --- ações ------------------------------------------------------------

function abrirOpcoes(): void {
  chrome.runtime.openOptionsPage();
}

el<HTMLButtonElement>("btn-abrir-opcoes").addEventListener("click", abrirOpcoes);
el<HTMLButtonElement>("btn-opcoes-erro").addEventListener("click", abrirOpcoes);

btnDestrinchar.addEventListener("click", () => {
  void destrinchar();
});

el<HTMLButtonElement>("btn-tentar").addEventListener("click", () => {
  void destrinchar();
});

el<HTMLButtonElement>("btn-cancelar").addEventListener("click", () => {
  // `controle` só aponta para o que corre AGORA (o `finally` o zera). Sem esta
  // checagem, cancelar depois de pronto abortaria um controlador morto e jogaria
  // a tela de volta para "pronto" por cima do resultado.
  if (controle === null) return;
  controle.abort();
  passo("Cancelado.");
  mostrar("pronto");
});

el<HTMLButtonElement>("btn-de-novo").addEventListener("click", () => {
  mostrar("pronto");
});

el<HTMLButtonElement>("btn-copiar").addEventListener("click", () => {
  void navigator.clipboard.writeText(aulaMd).then(
    () => {
      avisoAula.hidden = false;
      avisoAula.className = "estado ok";
      avisoAula.textContent = "Aula copiada.";
    },
    () => {
      avisoAula.hidden = false;
      avisoAula.className = "estado ruim";
      avisoAula.textContent = "O navegador bloqueou a cópia. Selecione o texto e copie.";
    },
  );
});

// Download: link `<a download>` é inerte dentro do popup, então geramos um blob
// URL na própria extensão e entregamos ao `chrome.downloads` (permissão já
// declarada no manifest). O URL é revogado quando o popup fecha.
el<HTMLButtonElement>("btn-caderno").addEventListener("click", () => {
  void pintarCaderno().then(() => mostrar("caderno"));
});

el<HTMLButtonElement>("btn-voltar-caderno").addEventListener("click", () => {
  mostrar(telaInicial);
});

el<HTMLButtonElement>("btn-bancada").addEventListener("click", () => {
  void pintarBancada().then(() => mostrar("bancada"));
});

el<HTMLButtonElement>("btn-voltar").addEventListener("click", () => {
  // Volta para onde dava para trabalhar: destrinchar (YouTube), app local
  // (Instagram/TikTok) ou o aviso de que a aba não tem vídeo reconhecido.
  mostrar(telaInicial);
});

el<HTMLButtonElement>("btn-limpar-bancada").addEventListener("click", () => {
  if (!confirm("Esvaziar a bancada? As aulas guardadas neste navegador somem.")) return;
  void limparBancada().then(pintarBancada);
});

el<HTMLButtonElement>("btn-baixar").addEventListener("click", () => {
  const blob = new Blob([aulaMd], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  void chrome.downloads
    .download({
      url,
      filename: nomeArquivo(tituloAtual),
      saveAs: false,
    })
    .then(
      () => {
        avisoAula.hidden = false;
        avisoAula.className = "estado ok";
        avisoAula.textContent = "Aula baixada.";
      },
      () => {
        avisoAula.hidden = false;
        avisoAula.className = "estado ruim";
        avisoAula.textContent = "O download não saiu. Use Copiar e cole num arquivo.";
      },
    );
  window.addEventListener("unload", () => URL.revokeObjectURL(url), { once: true });
});

// --- entrada ----------------------------------------------------------

async function iniciar(): Promise<void> {
  const [aba] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!aba || typeof aba.id !== "number" || aba.url === undefined) {
    mostrar("naoYoutube");
    return;
  }

  // Caso 1: Instagram/TikTok — a extensão não lê, mas sabe dizer isso e
  // oferece o app local. Vem ANTES da checagem de chave: aqui quem trabalha é
  // o app local, e pedir chave para uma aba que a extensão nem vai destrinchar
  // seria cobrar por um serviço que não é dela. `detectarPlataforma` também
  // reconhece o YouTube (home, canal — sem ID de vídeo); esses caem no caso 3.
  const plataforma: PlataformaId | null = detectarPlataforma(aba.url);
  if (plataforma === "instagram" || plataforma === "tiktok") {
    abaId = aba.id;
    urlDaAba = aba.url;
    await prepararTelaAppLocal(plataforma);
    return;
  }

  // A chave só é exigida no modo `chave`. Com o app local de pé e um provedor de
  // plano, não há chave nenhuma para pedir — mandar alguém configurar uma seria
  // empurrá-lo a pagar por token justamente por cima do plano que ele assina.
  const modo = await verModo();
  if (modo.qual === "chave" && !modo.config) {
    mostrar("semConfig");
    return;
  }

  // Caso 2: vídeo do YouTube — fluxo de sempre, intacto.
  if (ehVideoYoutube(aba.url)) {
    abaId = aba.id;
    urlDaAba = aba.url;
    telaInicial = "pronto";
    prontoTitulo.textContent = aba.title ?? "Vídeo do YouTube";
    prontoDado.textContent = "Clique e o Bruto pega a fala e monta a aula.";
    mostrar("pronto");
    return;
  }

  // Caso 3: YouTube sem vídeo (home, canal) ou host que o Bruto não conhece.
  telaInicial = "naoYoutube";
  mostrar("naoYoutube");
}

void iniciar().catch(() => {
  mostrarFalha({
    titulo: "O Bruto não conseguiu ler a aba.",
    saida: "Feche e abra o popup de novo.",
  });
});

