/**
 * Testes da página de opções (`extension/src/options/options.ts`) — o aviso de
 * modo reage a salvar e apagar a chave.
 *
 * ORIGEM: demanda 857dae37 (12/11/2026). Na tela de opções, depois de Salvar
 * ("Chave guardada neste navegador"), o aviso do topo continuava "Usando o
 * modo grátis do Bruto — Grátis: restam 3 de 3 aulas hoje…" até a página ser
 * recarregada. Quem salvava achava que não tinha funcionado, quando o popup já
 * usava a chave na hora. O mesmo valia ao Apagar chave: o aviso tinha de
 * voltar ao modo grátis e não voltava.
 *
 * A CLASSE do defeito: o aviso de modo é RECALCULADO depois de toda ação que
 * muda o modo (salvar, apagar), pela MESMA função que o pinta ao carregar a
 * página — nunca um texto mantido à mão em paralelo. E o recálculo não pode
 * disparar consulta à toa: a cota do modo grátis só é consultada quando o modo
 * resultante É o grátis (contabilizada aqui em `cotaConsultas`).
 *
 * COMO SE TESTA UMA PÁGINA num processo de Node: com os mesmos dublês que os
 * demais testes da extensão usam (`chrome.storage` em memória, `fetch`
 * interceptado) mais um `document` de mentira — só o que options.ts toca:
 * `getElementById`, `createElement` e os campos de elemento que ele lê e
 * escreve. O módulo é importado DEPOIS de os dublês estarem instalados,
 * porque a página inteira roda no import.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

const CHAVE_FALSA = "AIza-teste-nao-e-chave";
const MODO_GRATIS = "Usando o modo grátis do Bruto";
const MODO_CHAVE = "Usando chave de API — você paga por uso";

/** O evento que options.ts de fato usa — só `preventDefault`. */
interface EventoFake {
  preventDefault(): void;
}

/** Onde vivem os nós por id — o que `getElementById` consulta. */
const porId = new Map<string, NoFake>();

class NoFake {
  readonly tagName: string;
  className = "";
  textContent = "";
  hidden = false;
  href = "";
  value = "";
  type = "";
  name = "";
  placeholder = "";
  htmlFor = "";
  disabled = false;
  checked = false;
  readonly atributos: Record<string, string> = {};

  #id = "";
  get id(): string {
    return this.#id;
  }
  set id(novo: string) {
    this.#id = novo;
    porId.set(novo, this);
  }

  private readonly ouvintes = new Map<string, Array<(e: EventoFake) => void>>();

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  addEventListener(tipo: string, fn: (e: EventoFake) => void): void {
    const lista = this.ouvintes.get(tipo) ?? [];
    lista.push(fn);
    this.ouvintes.set(tipo, lista);
  }

  /** Dispara como o navegador dispararia. Só o teste chama. */
  disparar(tipo: string): void {
    for (const fn of this.ouvintes.get(tipo) ?? []) fn({ preventDefault() {} });
  }

  setAttribute(nome: string, valor: string): void {
    this.atributos[nome] = valor;
  }

  append(...filhos: NoFake[]): void {
    void filhos; // a página nunca lê os filhos de volta; só não pode lançar
  }

  focus(): void {
    /* o teste não afirma foco */
  }
}

/** Só para `radio instanceof HTMLInputElement` (usado por `marcar`) dar certo. */
class EntradaFake extends NoFake {}

/** Cria um nó base da página (os ids vêm do options.html). */
function no(id: string, tagName: string): NoFake {
  const n = new NoFake(tagName);
  n.id = id;
  return n;
}

const memoriaStorage: Record<string, unknown> = {
  // A cota do grátis lê o UUID da instalação antes de consultar o servidor.
  "bruto.instalacao": "0f1e2d3c-4b5a-4978-8765-1234567890ab",
};

let fetchReal: typeof fetch;
let cotaConsultas = 0;

/**
 * Espera a condição virar verdadeira — a página é toda assíncrona (storage,
 * fetch, promessas), e dormir um valor fixo seria teste cego e lento.
 */
async function esperar(condicao: () => boolean, mensagem: string): Promise<void> {
  for (let i = 0; i < 300 && !condicao(); i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.ok(condicao(), mensagem);
}

describe("página de opções — o aviso de modo reage a salvar e apagar a chave", () => {
  let form: NoFake;
  let inputChave: NoFake;
  let btnApagar: NoFake;
  let modoTitulo: NoFake;
  let modoPorque: NoFake;
  let estado: NoFake;

  before(async () => {
    // Os elementos que options.ts exige no import (ids do options.html).
    const ids: Array<[string, string]> = [
      ["form", "form"],
      ["provedores", "div"],
      ["link-chave", "a"],
      ["chave", "input"],
      ["btn-revelar", "button"],
      ["campo-modelo", "div"],
      ["modelo", "input"],
      ["ajuda-modelo", "p"],
      ["modo", "section"],
      ["modo-titulo", "p"],
      ["modo-porque", "p"],
      ["btn-testar", "button"],
      ["btn-apagar", "button"],
      ["estado", "p"],
    ];
    for (const [id, tag] of ids) no(id, tag);
    form = porId.get("form")!;
    inputChave = porId.get("chave")!;
    btnApagar = porId.get("btn-apagar")!;
    modoTitulo = porId.get("modo-titulo")!;
    modoPorque = porId.get("modo-porque")!;
    estado = porId.get("estado")!;

    (globalThis as { document?: unknown }).document = {
      getElementById: (id: string): NoFake | null => porId.get(id) ?? null,
      createElement: (tag: string): NoFake =>
        tag === "input" ? new EntradaFake(tag) : new NoFake(tag),
    };
    (globalThis as { HTMLInputElement?: unknown }).HTMLInputElement = EntradaFake;

    (globalThis as { chrome?: unknown }).chrome = {
      storage: {
        local: {
          get: async (chaves: string[]): Promise<Record<string, unknown>> =>
            Object.fromEntries(chaves.map((c) => [c, memoriaStorage[c]])),
          set: async (itens: Record<string, unknown>): Promise<void> => {
            Object.assign(memoriaStorage, itens);
          },
          remove: async (chaves: string[]): Promise<void> => {
            for (const c of chaves) delete memoriaStorage[c];
          },
        },
      },
    };

    fetchReal = globalThis.fetch;
    globalThis.fetch = (async (entrada: string | URL | Request): Promise<Response> => {
      const url = String(entrada);
      // O app local não está de pé — o cenário de quem só tem a extensão
      // instalada (é o do dono no relato da 857dae37).
      if (url.startsWith("http://127.0.0.1:3000/")) throw new TypeError("fetch failed");
      if (url === "https://bruto-gratis.vercel.app/api/cota") {
        cotaConsultas++;
        return new Response(JSON.stringify({ restantes: 3, limite: 3 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      // Nada aqui pode falar com provedor de chave nenhum: a chave é falsa e o
      // teste não clica em "Testar credencial". Se chegar aqui, é bug.
      throw new Error(`fetch inesperado nesta página de opções: ${url}`);
    }) as typeof fetch;

    // A página roda inteira no import — dublês primeiro, importar depois.
    await import("../../extension/src/options/options");
    await esperar(() => modoTitulo.textContent !== "", "a página não pintou o aviso de modo");
  });

  after(() => {
    globalThis.fetch = fetchReal;
    delete (globalThis as { chrome?: unknown }).chrome;
    delete (globalThis as { document?: unknown }).document;
    delete (globalThis as { HTMLInputElement?: unknown }).HTMLInputElement;
  });

  test("carregar sem chave → aviso do modo grátis, com a cota do dia", () => {
    assert.equal(modoTitulo.textContent, MODO_GRATIS);
    assert.match(
      modoPorque.textContent,
      /Grátis: restam 3 de 3 aulas hoje/,
      "o motivo carrega a cota que o servidor grátis respondeu",
    );
    assert.equal(cotaConsultas, 1, "uma única consulta de cota ao abrir a página");
  });

  test("salvar → aviso passa ao de chave (sem consultar cota à toa); apagar → volta ao grátis", async () => {
    inputChave.value = CHAVE_FALSA;
    form.disparar("submit");

    await esperar(
      () => estado.textContent === "Chave guardada neste navegador.",
      "o Salvar não confirmou — o fluxo de gravar a chave não completou",
    );
    await esperar(
      () => modoTitulo.textContent === MODO_CHAVE,
      "DEPOIS DE SALVAR o aviso de modo continua o do modo grátis — ele só " +
        "muda recarregando a página (o defeito da demanda 857dae37). O aviso " +
        "tem de ser recalculado pela mesma função que o pinta ao carregar.",
    );
    assert.equal(
      cotaConsultas,
      1,
      "modo resultante é o de CHAVE: nenhuma consulta de cota a mais pode ter saído",
    );

    btnApagar.disparar("click");

    await esperar(
      () => estado.textContent === "Chave apagada deste navegador.",
      "o Apagar não confirmou — o fluxo de remover a chave não completou",
    );
    await esperar(
      () => modoTitulo.textContent === MODO_GRATIS,
      "DEPOIS DE APAGAR o aviso de modo tinha de voltar ao modo grátis",
    );
    assert.equal(
      cotaConsultas,
      2,
      "agora sim: o modo resultante é o GRÁTIS, e só ele consulta a cota",
    );
    assert.match(
      modoPorque.textContent,
      /Grátis: restam 3 de 3 aulas hoje/,
      "o motivo do modo grátis volta a carregar a cota do dia",
    );
  });
});
