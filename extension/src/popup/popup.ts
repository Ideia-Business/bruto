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

// --- estado -----------------------------------------------------------

let abaId: number | null = null;
let controle: AbortController | null = null;
let aulaMd = "";
let brutoAtual: BrutoCapturado | null = null;

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
      return {
        titulo: "O YouTube não deixou pegar a fala.",
        saida: "Recarregue a página do vídeo e tente de novo.",
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

async function destrinchar(): Promise<void> {
  if (abaId === null) return;

  controle = new AbortController();
  mostrar("rodando");
  passo("Pegando a fala do vídeo…");

  try {
    const bruto = await pegarBruto(abaId);
    brutoAtual = bruto;

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
el<HTMLButtonElement>("btn-baixar").addEventListener("click", () => {
  const blob = new Blob([aulaMd], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  void chrome.downloads
    .download({
      url,
      filename: nomeArquivo(brutoAtual?.titulo ?? "aula"),
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

