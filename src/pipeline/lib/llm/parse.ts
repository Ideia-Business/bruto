/**
 * Remove cercas de código Markdown (```...```) que envolvem TODO o texto.
 * Aceita tag de linguagem opcional na abertura (```json, ```markdown, etc).
 * Se não houver cerca, devolve o texto apenas com trim.
 *
 * Vale para qualquer provedor: todos tendem a embrulhar a resposta quando o
 * prompt pede markdown ou JSON.
 */
export function stripFences(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```[^\n`]*\n([\s\S]*?)\n?```$/;
  const m = trimmed.match(fenced);
  if (m) return m[1].trim();
  return trimmed;
}
