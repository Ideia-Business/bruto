/**
 * Parser leve de markdown → blocos estruturados. Cobre o que o resumo usa:
 * headings (##/###), bullets (- , com um nível de indentação) e parágrafos,
 * preservando **negrito** inline. Suficiente para docx e para o HTML do PDF.
 */

export type InlineToken = { text: string; bold: boolean; italic?: boolean };

export type MdBlock =
  | { type: "h2"; tokens: InlineToken[] }
  | { type: "h3"; tokens: InlineToken[] }
  | { type: "bullet"; level: number; tokens: InlineToken[] }
  | { type: "para"; tokens: InlineToken[] };

/**
 * Divide uma linha em tokens preservando **negrito** e *itálico*.
 * Marcadores não fechados ficam como texto normal (sem vazar os asteriscos).
 */
export function parseInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  // Ordem importa: ** antes de * para o negrito ter prioridade.
  const re = /\*\*(.+?)\*\*|\*(.+?)\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) tokens.push({ text: text.slice(last, m.index), bold: false });
    if (m[1] !== undefined) tokens.push({ text: m[1], bold: true });
    else tokens.push({ text: m[2], bold: false, italic: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) tokens.push({ text: text.slice(last), bold: false });
  return tokens.length > 0 ? tokens : [{ text, bold: false }];
}

export function parseMarkdownBlocks(md: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  for (const rawLine of md.split("\n")) {
    const line = rawLine.replace(/\s+$/, "");
    if (!line.trim()) continue;

    if (line.startsWith("### ")) {
      blocks.push({ type: "h3", tokens: parseInline(line.slice(4)) });
    } else if (line.startsWith("## ")) {
      blocks.push({ type: "h2", tokens: parseInline(line.slice(3)) });
    } else if (line.startsWith("# ")) {
      blocks.push({ type: "h2", tokens: parseInline(line.slice(2)) });
    } else {
      const bullet = line.match(/^(\s*)[-*]\s+(.*)$/);
      if (bullet) {
        const level = Math.min(1, Math.floor(bullet[1].length / 2));
        blocks.push({ type: "bullet", level, tokens: parseInline(bullet[2]) });
      } else {
        blocks.push({ type: "para", tokens: parseInline(line) });
      }
    }
  }
  return blocks;
}

/** Escapa texto para HTML (usado no template do PDF). */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
