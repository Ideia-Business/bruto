import type { VideoMetadata } from "../types";

/**
 * Prompt que busca REFERÊNCIAS REAIS na web (via WebSearch) sobre o tema do
 * vídeo. Recebe um contexto curto do assunto via stdin (resumo ou termos).
 * Retorna markdown de lista com links verificados — nunca inventados.
 */
export function referencesPrompt(meta: VideoMetadata): string {
  return `Você tem acesso à ferramenta WebSearch. Use-a para encontrar referências REAIS e confiáveis sobre o tema do vídeo "${meta.title}" (canal "${meta.channel ?? "desconhecido"}"). O texto recebido via stdin resume o assunto — use-o para calibrar a busca.

Faça de 1 a 3 buscas e selecione as 4 a 6 melhores fontes para quem quer se aprofundar (priorize: documentação oficial, artigos de referência, organizações reconhecidas, publicações sérias).

Responda SOMENTE com uma lista markdown, um item por linha, EXATAMENTE neste formato:
- [Título real da página](URL real) — uma linha explicando por que vale a pena.

Regras invioláveis:
- Use APENAS URLs que apareceram de fato nos resultados da busca. NÃO invente, adivinhe nem "monte" URLs.
- Se não encontrar boas fontes, responda apenas com a palavra NENHUMA.
- Sem preâmbulo, sem cercas de código, sem seção de "Sources" extra — apenas a lista.
- Pode escrever os títulos/descrições em português; mantenha as URLs exatamente como retornadas.`;
}
