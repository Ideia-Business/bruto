import type { VideoMetadata } from "../types";

function formatDuration(sec: number | null): string {
  if (!sec) return "duração desconhecida";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h${String(m).padStart(2, "0")}min` : `${m}min`;
}

/** Prompt do resumo executivo — a transcrição entra via stdin. */
export function summaryPrompt(meta: VideoMetadata): string {
  const chaptersBlock =
    meta.chapters.length > 0
      ? `\nCapítulos do vídeo (use como âncora da estrutura):\n${meta.chapters
          .map((c) => `- ${c.title}`)
          .join("\n")}\n`
      : "";

  return `Você é um analista que produz resumos executivos em português brasileiro.

O texto recebido via stdin é a transcrição do vídeo "${meta.title}" do canal "${meta.channel ?? "desconhecido"}" (${formatDuration(meta.durationSec)}).
${chaptersBlock}
Produza um resumo em markdown com EXATAMENTE esta estrutura:

## Visão Geral
(2-3 frases: sobre o que é o vídeo e sua tese central)

## Pontos Principais
(5-10 bullets; cada bullet = uma ideia completa e autossuficiente, com dados/números citados quando houver)

## Conceitos e Definições
(termos técnicos explicados no vídeo; omita a seção se não houver)

## Conclusões e Ações
(o que o vídeo conclui/recomenda; passos práticos se houver)

Regras: responda SOMENTE com o markdown do resumo, sem preâmbulo, sem cercas de código.
Não invente informação que não está na transcrição. Escreva em PT-BR mesmo que o vídeo seja em outro idioma.`;
}
