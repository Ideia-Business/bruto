/**
 * Bruto — opções.
 *
 * Escolhe o provedor, guarda a chave e o modelo, testa a credencial. Nada aqui
 * sai do navegador: a chave só viaja quando o provedor escolhido é chamado.
 */

import type { Config } from "../lib/config";
import { PROVEDORES, lerConfig, salvarConfig, limparConfig } from "../lib/config";
import { testarCredencial, verModo } from "../lib/llm";
import { verCotaGratis } from "../lib/gratis";

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
const caixaModo = el<HTMLElement>("modo");
const modoTitulo = el<HTMLParagraphElement>("modo-titulo");
const modoPorque = el<HTMLParagraphElement>("modo-porque");
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

  // O campo existe para TODO provedor, não só para os de catálogo grande.
  // Motivo: quando o modelo padrão sai do ar (o Gemini 2.0 Flash foi aposentado
  // em março de 2026), o erro manda ajustar o modelo — e não havia onde. Errar o
  // padrão é inevitável com o tempo; deixar a pessoa sem saída, não.
  campoModelo.hidden = false;
  inputModelo.placeholder = escolhido.padraoBalanced;
  ajudaModelo.textContent = escolhido.precisaModelo
    ? `O catálogo da ${escolhido.label} é grande e muda — preencha. Ex.: ${escolhido.padraoBalanced}.`
    : `Em branco, o Bruto usa ${escolhido.padraoBalanced}. Preencha se esse modelo não existir mais na sua conta.`;
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
    modelo: modelo !== "" ? modelo : null,
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

/**
 * Diz em qual modo a extensão está e POR QUÊ.
 *
 * O silêncio aqui seria a pior opção: quem instalou o Bruto para usar o plano
 * que já assina, e está de fato pagando por token porque o app não subiu, não
 * teria como saber. O motivo vem do próprio app quando ele o fornece — se ele
 * sabe dizer "o `claude` não está instalado", isso vale mais que qualquer texto
 * genérico que a extensão invente.
 */
async function pintarModo(): Promise<void> {
  const modo = await verModo();
  caixaModo.hidden = false;

  if (modo.qual === "app") {
    const plano = modo.saude?.provedores.find((p) => p.plano && p.disponivel);
    caixaModo.className = "modo ok";
    modoTitulo.textContent = `Usando o seu plano${plano ? ` — ${plano.label}` : ""}`;
    modoPorque.textContent =
      "O app do Bruto está aberto nesta máquina e o consumo sai da assinatura que você já paga. Não é preciso chave, e o que estiver guardado abaixo não vai ser usado.";
    return;
  }

  if (modo.qual === "chave") {
    caixaModo.className = "modo";
    modoTitulo.textContent = "Usando chave de API — você paga por uso";
    const indisponiveis = (modo.saude?.provedores ?? []).filter((p) => p.plano && !p.disponivel);
    const motivo = indisponiveis.find((p) => typeof p.motivo === "string")?.motivo;
    modoPorque.textContent =
      modo.saude === null
        ? "O app do Bruto não está aberto nesta máquina. Com ele aberto, o consumo sairia do plano que você já assina, sem chave e sem cobrança por token."
        : `O app do Bruto está aberto, mas nenhum provedor de plano está pronto nele${motivo ? `: ${motivo}` : "."}`;
    return;
  }

  // modo.qual === "gratis": nem app com plano, nem chave configurada.
  caixaModo.className = "modo";
  modoTitulo.textContent = "Usando o modo grátis do Bruto";
  const cota = await verCotaGratis();
  modoPorque.textContent =
    (cota ? `Grátis: restam ${cota.restantes} de ${cota.limite} aulas hoje. ` : "") +
    "Sem app com plano e sem chave, o Bruto usa uma cota diária grátis, paga pelo dono da extensão. Cole uma chave abaixo, ou abra o app do Bruto nesta máquina, para sair do modo grátis.";
}

async function iniciar(): Promise<void> {
  montarProvedores();
  void pintarModo();
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
