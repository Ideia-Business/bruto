import type { VideoMetadata } from "../types";

/**
 * O mínimo que este prompt precisa saber sobre o bruto — mesmo recorte do
 * `MetaDaAula` (`study.ts`), pelo mesmo motivo: a extensão do navegador não
 * tem o `VideoMetadata` inteiro, só título e canal.
 */
export type MetaDaTranscricao = Pick<VideoMetadata, "title" | "channel">;

/**
 * Prompt da "Transcrição organizada" — reorganiza a transcrição CRUA por
 * assunto, para leitura humana. A diferença que importa em relação à Aula
 * (`study.ts`): a Aula ENSINA (destila, explica do zero, usa analogia); esta
 * reorganiza sem cortar — todo ponto substantivo da fala original continua
 * presente, só agrupado sob um título temático em vez de disperso na ordem
 * cronológica da fala.
 */
export function transcriptOrganizedPrompt(meta: MetaDaTranscricao): string {
  return `Você é um editor de texto cuidadoso. A partir da TRANSCRIÇÃO CRUA do vídeo "${meta.title}" (canal "${meta.channel ?? "desconhecido"}"), recebida via stdin, reorganize o conteúdo por ASSUNTO — sem resumir, sem cortar nenhum ponto substantivo.

A diferença entre isto e um resumo: um resumo escolhe o que manter e descarta o resto. Aqui NADA de conteúdo é descartado — você só está reagrupando o que já foi dito, tirando-o da ordem cronológica da fala (que pula de assunto e volta) e organizando por tema.

O que PODE ser removido, porque não é conteúdo:
- Repetições literais da mesma frase (comum em legenda automática).
- Vícios de fala puros sem informação ("né", "tipo assim", "então... é...", gagueira de auto-correção).
- Falsos começos que o próprio orador corrigiu na frase seguinte.

O que NUNCA pode ser removido:
- Qualquer fato, número, exemplo, opinião, ressalva ou explicação que o vídeo contém — mesmo que pareça secundário.
- Se o orador volta a um assunto três vezes ao longo do vídeo, as três passagens entram na seção daquele assunto (fundidas, sem repetir a mesma frase duas vezes).

Responda SOMENTE com markdown, seguindo esta estrutura:

# 📋 Transcrição organizada: <título do vídeo>

## Sumário
(lista com o nome de cada seção temática que você vai criar abaixo, na ordem em que aparecem)

## <Título do primeiro assunto>
(todo o conteúdo relacionado a este assunto, em prosa corrida ou com sub-bullets quando o original já for uma lista; escreva em português brasileiro, mesmo que o vídeo seja em outro idioma — traduza sem perder nuance)

## <Título do segundo assunto>
(...)

(Quantas seções o conteúdo pedir — não force um número fixo. Um vídeo de um assunto só pode ter 2 seções; um vídeo denso pode ter 8.)

Regras gerais:
- Português brasileiro.
- Não invente fato, número ou exemplo que não está na transcrição.
- Não use cercas de código ao redor da resposta. Comece direto no "# 📋 Transcrição organizada:".`;
}
