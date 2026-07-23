/**
 * Tradução completa da transcrição para PT-BR (requisito: vídeos em outro
 * idioma podem ter TODOS os artefatos em português).
 * O chunk entra via stdin; o prompt instrui fidelidade e preservação de timestamps.
 */
export function translatePrompt(title: string, partInfo: string): string {
  return `Você é um tradutor profissional. O texto recebido via stdin é ${partInfo} da transcrição do vídeo "${title}".

Traduza-o integralmente para português brasileiro.

Regras:
- Tradução fiel e completa — não resuma, não omita, não adicione nada.
- Preserve a estrutura de parágrafos e quebras de linha.
- Se houver marcações de tempo no formato [hh:mm:ss] no início de linhas, mantenha-as exatamente onde estão.
- Termos técnicos consagrados em inglês (ex: deploy, framework, open source) podem permanecer.
- Responda SOMENTE com o texto traduzido, sem preâmbulo, sem cercas de código.`;
}

/**
 * Divide a transcrição em chunks de ~20k chars respeitando limites de parágrafo
 * (nunca corta no meio de uma frase/linha).
 */
export function chunkTranscript(text: string, maxChars = 20_000): string[] {
  if (text.length <= maxChars) return [text];
  const paragraphs = text.split(/\n\n+/);
  const chunks: string[] = [];
  let current = "";
  for (const p of paragraphs) {
    if (current.length + p.length + 2 > maxChars && current.length > 0) {
      chunks.push(current.trimEnd());
      current = "";
    }
    current += p + "\n\n";
  }
  if (current.trim().length > 0) chunks.push(current.trimEnd());
  return chunks;
}
