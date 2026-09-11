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
import { runLLM, LlmError } from "../lib/llm";
import { lerConfig } from "../lib/config";
import { guardarAula, listarBancada, esquecerAula, limparBancada } from "../lib/bancada";
import type { AulaGuardada } from "../lib/bancada";
import { summaryPrompt } from "../../../src/pipeline/prompts/summary";

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
  pronto: el<HTMLElement>("tela-pronto"),
  rodando: el<HTMLElement>("tela-rodando"),
  aula: el<HTMLElement>("tela-aula"),
  bancada: el<HTMLElement>("tela-bancada"),
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

// --- estado -----------------------------------------------------------

let abaId: number | null = null;
let urlDaAba: string | null = null;
let controle: AbortController | null = null;
let aulaMd = "";
/** Título da aula em exibição — vem do bruto capturado OU da bancada. */
let tituloAtual = "aula";

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

function escapar(t: string): string {
  return t
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Markdown à mão: títulos, negrito, itálico, código, listas e parágrafos. */
function renderMarkdown(md: string): string {
  const linhas = md.replace(/\r\n/g, "\n").split("\n");
  const saida: string[] = [];
  let lista: "ul" | "ol" | null = null;
  let paragrafo: string[] = [];

  const inline = (t: string): string =>
    escapar(t)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");

  const fecharParagrafo = (): void => {
    if (paragrafo.length > 0) {
      saida.push(`<p>${inline(paragrafo.join(" "))}</p>`);
      paragrafo = [];
    }
  };

  const fecharLista = (): void => {
    if (lista) {
      saida.push(`</${lista}>`);
      lista = null;
    }
  };

  for (const linha of linhas) {
    const bruta = linha.trim();

    if (bruta === "") {
      fecharParagrafo();
      fecharLista();
      continue;
    }

    const titulo = /^(#{1,3})\s+(.*)$/.exec(bruta);
    if (titulo) {
      fecharParagrafo();
      fecharLista();
      const nivel = titulo[1].length;
      saida.push(`<h${nivel}>${inline(titulo[2])}</h${nivel}>`);
      continue;
    }

    const item = /^[-*]\s+(.*)$/.exec(bruta);
    if (item) {
      fecharParagrafo();
      if (lista !== "ul") {
        fecharLista();
        saida.push("<ul>");
        lista = "ul";
      }
      saida.push(`<li>${inline(item[1])}</li>`);
      continue;
    }

    const numerado = /^\d+[.)]\s+(.*)$/.exec(bruta);
    if (numerado) {
      fecharParagrafo();
      if (lista !== "ol") {
        fecharLista();
        saida.push("<ol>");
        lista = "ol";
      }
      saida.push(`<li>${inline(numerado[1])}</li>`);
      continue;
    }

    fecharLista();
    paragrafo.push(bruta);
  }

  fecharParagrafo();
  fecharLista();
  return saida.join("");
}

function nomeArquivo(titulo: string): string {
  const base = titulo
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 60);
  return `bruto-${base || "aula"}.md`;
}

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

  controle = new AbortController();
  mostrar("rodando");
  passo("Pegando a fala do vídeo…");

  try {
    if (urlDaAba !== null) await levarParaRotaComTranscricao(abaId, urlDaAba);
    if (controle.signal.aborted) return;
    const bruto = await pegarBruto(abaId);
    tituloAtual = bruto.titulo;

    if (controle.signal.aborted) return;
    passo(`Fala pega: ${bruto.texto.length.toLocaleString("pt-BR")} caracteres. Destrinchando…`);

    // O prompt é o MESMO que o app local usa — vem de src/pipeline/prompts.
    // `chapters` vazio porque a legenda da aba não traz capítulos; o prompt
    // trata a ausência omitindo a seção, em vez de inventar estrutura.
    const prompt = summaryPrompt({
      title: bruto.titulo,
      channel: bruto.canal,
      durationSec: bruto.duracaoSeg,
      chapters: [],
    });

    const md = await runLLM({
      prompt,
      input: bruto.texto,
      tier: "balanced",
      timeoutMs: 180_000,
      signal: controle.signal,
    });

    if (controle.signal.aborted) return;

    aulaMd = md.trim();
    aulaBox.innerHTML = renderMarkdown(aulaMd);
    avisoAula.hidden = true;
    mostrar("aula");

    // Guarda ANTES de qualquer outra coisa: a pessoa gastou a chave dela para
    // produzir isto, e fechar o popup não pode significar perder o trabalho.
    void guardarAula({
      videoId: bruto.videoId,
      titulo: bruto.titulo,
      canal: bruto.canal,
      url: `https://www.youtube.com/watch?v=${bruto.videoId}`,
      markdown: aulaMd,
      em: Date.now(),
      provedor: (await lerConfig())?.provedor ?? null,
    });
  } catch (e: unknown) {
    if (controle?.signal.aborted) {
      mostrar("pronto");
      return;
    }
    if (e instanceof LlmError) {
      mostrarFalha(falhaDoModelo(e.codigo, e.message));
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
    controle = null;
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
  controle?.abort();
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
el<HTMLButtonElement>("btn-bancada").addEventListener("click", () => {
  void pintarBancada().then(() => mostrar("bancada"));
});

el<HTMLButtonElement>("btn-voltar").addEventListener("click", () => {
  // Volta para onde dava para trabalhar: a tela de destrinchar se a aba tem
  // vídeo, senão o aviso de que não tem.
  mostrar(abaId === null ? "naoYoutube" : "pronto");
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
  const config = await lerConfig();
  if (!config) {
    mostrar("semConfig");
    return;
  }

  const [aba] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!aba || typeof aba.id !== "number" || !ehVideoYoutube(aba.url)) {
    mostrar("naoYoutube");
    return;
  }

  abaId = aba.id;
  urlDaAba = aba.url ?? null;
  prontoTitulo.textContent = aba.title ?? "Vídeo do YouTube";
  prontoDado.textContent = "Clique e o Bruto pega a fala e monta a aula.";
  mostrar("pronto");
}

void iniciar().catch(() => {
  mostrarFalha({
    titulo: "O Bruto não conseguiu ler a aba.",
    saida: "Feche e abra o popup de novo.",
  });
});

