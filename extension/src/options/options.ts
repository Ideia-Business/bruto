/**
 * Bruto — opções.
 *
 * Escolhe o provedor, guarda a chave e o modelo, testa a credencial. Nada aqui
 * sai do navegador: a chave só viaja quando o provedor escolhido é chamado.
 */

import type { Config } from "../lib/config";
import { PROVEDORES, lerConfig, salvarConfig, limparConfig } from "../lib/config";
import { testarCredencial } from "../lib/llm";

type Provedor = (typeof PROVEDORES)[number];
type ProvedorId = Config["provedor"];

function el<T extends HTMLElement>(id: string): T {
  const n = document.getElementById(id);
  if (!n) throw new Error(`elemento ausente: ${id}`);
  return n as T;
}

const form = el<HTMLFormElement>("form");
const caixaProvedores = el<HTMLDivElement>("provedores");
const linkChave = el<HTMLAnchorElement>("link-chave");
const inputChave = el<HTMLInputElement>("chave");
const btnRevelar = el<HTMLButtonElement>("btn-revelar");
const campoModelo = el<HTMLDivElement>("campo-modelo");
const inputModelo = el<HTMLInputElement>("modelo");
const ajudaModelo = el<HTMLParagraphElement>("ajuda-modelo");
const btnTestar = el<HTMLButtonElement>("btn-testar");
const btnApagar = el<HTMLButtonElement>("btn-apagar");
const estado = el<HTMLParagraphElement>("estado");

let escolhido: Provedor = PROVEDORES[0];

// --- estado visível ---------------------------------------------------

function dizer(texto: string, tom: "" | "ok" | "ruim" | "atencao" = ""): void {
  estado.className = tom ? `estado ${tom}` : "estado";
  estado.textContent = texto;
}

function acharProvedor(id: ProvedorId): Provedor {
  const achado = PROVEDORES.find((p) => p.id === id);
  return achado ?? PROVEDORES[0];
}

function pintarProvedor(): void {
  linkChave.href = escolhido.ondePegar;
  linkChave.textContent = `Onde pegar a chave da ${escolhido.label}`;

  campoModelo.hidden = !escolhido.precisaModelo;
  if (escolhido.precisaModelo) {
    inputModelo.placeholder = escolhido.padraoBalanced;
    ajudaModelo.textContent = `Em branco, o Bruto usa ${escolhido.padraoBalanced}.`;
  } else {
    inputModelo.value = "";
  }
}

function montarProvedores(): void {
  for (const p of PROVEDORES) {
    const linha = document.createElement("div");
    linha.className = "opcao";

    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "provedor";
    radio.id = `provedor-${p.id}`;
    radio.value = p.id;

    const rotulo = document.createElement("label");
    rotulo.htmlFor = radio.id;
    rotulo.textContent = p.label;

    radio.addEventListener("change", () => {
      if (!radio.checked) return;
      escolhido = p;
      pintarProvedor();
      dizer("");
    });

    linha.append(radio, rotulo);
    caixaProvedores.append(linha);
  }
}

function marcar(id: ProvedorId): void {
  const radio = document.getElementById(`provedor-${id}`);
  if (radio instanceof HTMLInputElement) radio.checked = true;
  escolhido = acharProvedor(id);
  pintarProvedor();
}

function configAtual(): Config {
  const modelo = inputModelo.value.trim();
  return {
    provedor: escolhido.id,
    chave: inputChave.value.trim(),
    modelo: escolhido.precisaModelo && modelo !== "" ? modelo : null,
  };
}

// --- ações ------------------------------------------------------------

btnRevelar.addEventListener("click", () => {
  const escondida = inputChave.type === "password";
  inputChave.type = escondida ? "text" : "password";
  btnRevelar.textContent = escondida ? "Esconder" : "Mostrar";
  btnRevelar.setAttribute("aria-pressed", String(escondida));
});

form.addEventListener("submit", (evento) => {
  evento.preventDefault();
  const config = configAtual();
  if (config.chave === "") {
    dizer("Cole a chave antes de salvar.", "ruim");
    inputChave.focus();
    return;
  }
  void salvarConfig(config).then(
    () => dizer("Chave guardada neste navegador.", "ok"),
    () => dizer("Não deu para guardar a chave. Tente de novo.", "ruim"),
  );
});

btnTestar.addEventListener("click", () => {
  const config = configAtual();
  if (config.chave === "") {
    dizer("Cole a chave antes de testar.", "ruim");
    inputChave.focus();
    return;
  }
  btnTestar.disabled = true;
  dizer("Batendo na porta do provedor…", "atencao");
  void testarCredencial(config)
    .then(
      (r) => {
        if (r.ok) dizer("A chave funciona. Pode destrinchar.", "ok");
        else dizer(r.erro, "ruim");
      },
      () => dizer("O teste não completou. Confira a conexão.", "ruim"),
    )
    .finally(() => {
      btnTestar.disabled = false;
    });
});

btnApagar.addEventListener("click", () => {
  void limparConfig().then(
    () => {
      inputChave.value = "";
      inputModelo.value = "";
      dizer("Chave apagada deste navegador.", "ok");
    },
    () => dizer("Não deu para apagar. Tente de novo.", "ruim"),
  );
});

// --- entrada ----------------------------------------------------------

async function iniciar(): Promise<void> {
  montarProvedores();
  const config = await lerConfig();
  if (config) {
    marcar(config.provedor);
    inputChave.value = config.chave;
    if (config.modelo) inputModelo.value = config.modelo;
    dizer("Chave já guardada. Trocar é só colar outra e salvar.");
  } else {
    marcar(PROVEDORES[0].id);
    dizer("Escolha o provedor e cole a chave.");
  }
}

void iniciar().catch(() => {
  dizer("As opções não abriram direito. Recarregue a página.", "ruim");
});
