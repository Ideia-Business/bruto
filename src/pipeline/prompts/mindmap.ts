import type { VideoMetadata } from "../types";

export const MINDMAP_FRONTMATTER = `---
markmap:
  maxWidth: 240
  initialExpandLevel: 2
---`;

/** Prompt do mapa mental — a transcrição entra via stdin. */
export function mindmapPrompt(meta: VideoMetadata): string {
  return `Converta a transcrição recebida via stdin (vídeo "${meta.title}") num mapa mental em markdown hierárquico, em português brasileiro.

CONTRATO DE SAÍDA (obrigatório):
- Comece com este frontmatter exato:
${MINDMAP_FRONTMATTER}
- Exatamente UM heading "#" — o título do vídeo (encurte para no máximo 8 palavras).
- De 3 a 7 headings "##" — os temas principais.
- Sob cada "##", bullets "-" aninhados com no máximo 2 níveis (profundidade total 3).
- Cada nó com no máximo 8 palavras. Sem frases longas, sem pontuação final.
- Responda SOMENTE o markdown. Sem cercas de código, sem explicação.`;
}

/**
 * Validador estrutural pós-LLM: nunca crasha (markmap degrada graciosamente),
 * mas garante o mínimo — frontmatter, 1 raiz, ≥1 tema, profundidade ≤3.
 */
export function validateMindmap(raw: string): string {
  let md = raw.trim();

  // Garante frontmatter markmap
  if (!md.startsWith("---")) {
    md = `${MINDMAP_FRONTMATTER}\n${md}`;
  }

  const lines = md.split("\n");
  const out: string[] = [];
  let h1Count = 0;
  let h2Count = 0;

  for (const line of lines) {
    // Headings: rebaixa #s extras para ## (só 1 raiz permitida)
    if (/^#\s/.test(line)) {
      h1Count++;
      out.push(h1Count === 1 ? line : line.replace(/^#/, "##"));
      continue;
    }
    if (/^##\s/.test(line)) {
      h2Count++;
      out.push(line);
      continue;
    }
    // Bullets: clamp de profundidade a 2 níveis de indentação (4 espaços)
    const bullet = line.match(/^(\s*)-\s/);
    if (bullet && bullet[1].length > 4) {
      out.push(`    ${line.trimStart()}`);
      continue;
    }
    out.push(line);
  }

  let result = out.join("\n");
  // Sem nenhum tema? Degrada para um tema único com o conteúdo
  if (h2Count === 0 && h1Count > 0) {
    result += "\n## Ideias principais\n- Conteúdo não estruturado pelo modelo";
  }
  return result;
}
