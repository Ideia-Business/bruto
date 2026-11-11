/**
 * Quais seções a tela de Configurações mostra — a decisão isolada numa
 * função pura (testada em tests/lib/secoes-configuracoes.test.ts) para que
 * a falta de capacidade de UMA seção nunca esconda OUTRA.
 *
 * O caso que motivou: no Safari/Firefox, `suportaPastaLocal()` é falso e um
 * `return` precoce do componente escondia a tela INTEIRA — inclusive a
 * seção do Whisper, cuja instalação roda no SERVIDOR e não precisa da API
 * de pasta do navegador. Aqui, o ramo "navegador sem API de pasta" fica
 * restrito à exportação; o Whisper é decidido de forma independente.
 */

/** Estado da integração com o Whisper, como vem de `/api/ferramentas/whisper`. */
export interface EstadoWhisper {
  suportado: boolean;
  instalado: boolean;
}

export interface SecoesConfiguracoes {
  /**
   * "completa": pasta de exportação + exportar automaticamente.
   * "aviso-navegador": só o aviso de que o navegador não tem a API de pasta.
   */
  exportacao: "completa" | "aviso-navegador";
  /** A seção do Whisper, independente da exportação. */
  whisper: boolean;
}

export function secoesDasConfiguracoes(entrada: {
  suportaPasta: boolean;
  whisper: EstadoWhisper | null;
}): SecoesConfiguracoes {
  return {
    exportacao: entrada.suportaPasta ? "completa" : "aviso-navegador",
    whisper: entrada.whisper?.suportado === true,
  };
}
