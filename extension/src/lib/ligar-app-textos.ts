/**
 * Os textos do botão "Ligar o app" — aprovados pelo dono na grelha de
 * 06/11/2026, palavra por palavra. Viverem num módulo PURO (sem `chrome`,
 * sem DOM) é o que permite conferir cada frase exata e cada mapeamento
 * resultado → mensagem em teste de unidade, fora do navegador.
 *
 * A regra de linguagem de `CONTEXT.md` vale aqui: quem liga é o **app local**,
 * nunca "o Bruto" (que é o material de entrada). Se um dia um texto precisar
 * mudar, muda com o dono — não no meio de outro assunto.
 */

import type { ResultadoLigar } from "./host-nativo";

/** Texto do botão, nos dois lugares onde aparece. */
export const TEXTO_BOTAO_LIGAR = "Ligar o app";

/** Enquanto `ligarApp()` ainda não resolveu. */
export const TEXTO_LIGANDO = "Ligando o app… na primeira vez pode levar alguns minutos.";

export const TEXTO_PRONTO = "Pronto: o app está ligado.";

export const TEXTO_DEMORA = "Ainda iniciando. Reabra a extensão em 1 minuto.";

export const TEXTO_PERMISSAO_NEGADA =
  "Sem essa permissão a extensão não consegue ligar o app. Abra o app pelo ícone e clique de novo.";

export const TEXTO_HOST_AUSENTE =
  "A extensão ainda não está ligada ao app neste computador. Rode o instalador do Bruto de novo e tente outra vez.";

export const TEXTO_FALHA_AO_LIGAR =
  "O app não subiu. Detalhes no arquivo bruto-server.log, na pasta temporária do sistema.";

export const TEXTO_ERRO = "Algo travou ao ligar o app.";

/** O botão que abre a janela do app já ligado (era "Abrir Bruto"). */
export const TEXTO_ABRIR_O_APP = "Abrir o app";

/** O que a tela precisa saber para mostrar o resultado de `ligarApp()`. */
export interface MensagemDoLigar {
  /** A classe de cor da mensagem: `estado ok | atencao | ruim`. */
  tipo: "ok" | "atencao" | "ruim";
  texto: string;
  /** Só `pronto` confirma o app de pé — os demais pedem nova tentativa. */
  ligado: boolean;
}

/**
 * Resultado da ponte → mensagem de tela. Função pura: mesma entrada, mesma
 * saída, nenhum efeito. O `default` do switch não existe de propósito — um
 * resultado novo em `ResultadoLigar` vira erro de TIPO aqui, não texto errado.
 */
export function mensagemDoLigar(r: ResultadoLigar): MensagemDoLigar {
  switch (r.resultado) {
    case "pronto":
      return { tipo: "ok", texto: TEXTO_PRONTO, ligado: true };
    case "demora":
      return { tipo: "atencao", texto: TEXTO_DEMORA, ligado: false };
    case "permissao-negada":
      return { tipo: "atencao", texto: TEXTO_PERMISSAO_NEGADA, ligado: false };
    case "host-ausente":
      return { tipo: "ruim", texto: TEXTO_HOST_AUSENTE, ligado: false };
    case "falha-ao-ligar":
      return { tipo: "ruim", texto: TEXTO_FALHA_AO_LIGAR, ligado: false };
    case "erro":
      return { tipo: "ruim", texto: TEXTO_ERRO, ligado: false };
  }
}
