import type { MetaDaTranscricao } from "./transcript-organized";

/** Propósito default quando a pessoa não escreve nem escolhe um chip. */
export const PROPOSITO_PADRAO =
  "dar contexto geral sobre o vídeo, para eu poder fazer perguntas ou pedir análises sobre o conteúdo dele";

/**
 * Prompt da "Transcrição para IA" — mesma reorganização por assunto do
 * `transcript-organized.ts` (sem cortar conteúdo), mas o produto final é
 * outro: um bloco de texto pronto para a PESSOA colar em outra sessão de IA
 * (ChatGPT, Claude, etc.), com um preâmbulo que apresenta o documento e diz o
 * que a pessoa quer fazer com ele — para o modelo do outro lado não precisar
 * adivinhar.
 *
 * `proposito` é texto livre da pessoa (ou a frase de um chip pré-definido, ou
 * `PROPOSITO_PADRAO` se ela não escreveu nada). Ele molda o preâmbulo e pode
 * orientar COMO agrupar o conteúdo — nunca o que é incluído: a regra de "não
 * cortar" do prompt organizado vale aqui do mesmo jeito.
 */
export function transcriptLlmPrompt(meta: MetaDaTranscricao, proposito: string): string {
  const prop = proposito.trim() || PROPOSITO_PADRAO;
  return `Você prepara documentos para serem colados como contexto em outra conversa de IA. A partir da TRANSCRIÇÃO CRUA do vídeo "${meta.title}" (canal "${meta.channel ?? "desconhecido"}"), recebida via stdin, produza um documento de contexto completo e bem estruturado.

A pessoa que vai usar este documento disse o que pretende fazer com ele:
"${prop}"

Isso deve influenciar COMO você organiza e agrupa o conteúdo (o que fica em destaque no início, que títulos de seção fazem mais sentido) — mas NUNCA o que é incluído. Todo o conteúdo substantivo da transcrição tem que estar presente; a mesma regra de "reorganizar, não resumir" vale aqui. Cole a informação completa, só arrumada.

Responda SOMENTE com markdown, seguindo esta estrutura:

# Contexto: <título do vídeo>

> **O que é este documento:** transcrição completa do vídeo "<título>" (canal "<canal>"), reorganizada por assunto. Preparado para uso como contexto numa conversa de IA. Propósito informado: ${prop}

## Sumário
(lista com o nome de cada seção temática abaixo)

## <Título do primeiro assunto>
(conteúdo completo, sem cortes; prosa direta, sem decoração — isto vai ser lido por um modelo, não por um humano lendo por prazer)

## <Título do segundo assunto>
(...)

(quantas seções o conteúdo pedir)

---

*Fim da transcrição. Use o conteúdo acima como contexto para: ${prop}*

Regras gerais:
- Português brasileiro.
- Não invente fato, número ou exemplo que não está na transcrição.
- Nada de emoji, nada de floreio — o alvo é um modelo de linguagem, densidade de informação importa mais que estilo.
- Não use cercas de código ao redor da resposta. Comece direto no "# Contexto:".`;
}
