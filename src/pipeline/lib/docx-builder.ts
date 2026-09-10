import fs from "node:fs";
import {
  AlignmentType,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  TextRun,
  ExternalHyperlink,
} from "docx";
import { parseMarkdownBlocks, studyMdForDocs, type InlineToken } from "./md-blocks";
import { formatDuration } from "@/lib/format";
import type { VideoMetadata } from "@/pipeline/types";

function runs(tokens: InlineToken[]): TextRun[] {
  return tokens.map((t) => new TextRun({ text: t.text, bold: t.bold, italics: t.italic }));
}

/** Converte o markdown do resumo em parágrafos do docx. */
function summaryParagraphs(summaryMd: string): Paragraph[] {
  const out: Paragraph[] = [];
  for (const b of parseMarkdownBlocks(summaryMd)) {
    if (b.type === "h2") {
      out.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: runs(b.tokens), spacing: { before: 240, after: 120 } }));
    } else if (b.type === "h3") {
      out.push(new Paragraph({ heading: HeadingLevel.HEADING_3, children: runs(b.tokens), spacing: { before: 160, after: 80 } }));
    } else if (b.type === "bullet") {
      out.push(new Paragraph({ bullet: { level: b.level }, children: runs(b.tokens), spacing: { after: 60 } }));
    } else {
      out.push(new Paragraph({ children: runs(b.tokens), spacing: { after: 120 } }));
    }
  }
  return out;
}

export interface DocxInput {
  meta: VideoMetadata;
  summaryMd: string | null;
  studyMd: string | null;
  mindmapPngPath: string | null;
  transcript: string | null;
  /** Transcrição traduzida (quando o vídeo não é PT-BR e foi pedida). */
  transcriptTranslated: string | null;
  outPath: string;
}

/** Gera o .docx: capa + resumo + mapa mental (imagem) + transcrição. */
export async function buildDocx(input: DocxInput): Promise<string> {
  const { meta } = input;
  const children: Paragraph[] = [];

  // ── Capa ───────────────────────────────────────────────────────────────
  children.push(
    new Paragraph({ text: meta.title, heading: HeadingLevel.TITLE, spacing: { after: 120 } }),
    new Paragraph({
      children: [
        new TextRun({ text: `${meta.channel ?? "Canal desconhecido"}`, color: "666666" }),
        new TextRun({
          text: meta.durationSec ? `  ·  ${formatDuration(meta.durationSec)}` : "",
          color: "666666",
        }),
      ],
      spacing: { after: 60 },
    }),
    new Paragraph({
      children: [
        new TextRun({ text: "Link: ", color: "666666" }),
        new ExternalHyperlink({
          link: meta.url,
          children: [new TextRun({ text: meta.url, style: "Hyperlink" })],
        }),
      ],
      spacing: { after: 240 },
    }),
  );

  // ── Resumo ─────────────────────────────────────────────────────────────
  if (input.summaryMd) {
    children.push(new Paragraph({ text: "Resumo", heading: HeadingLevel.HEADING_1, spacing: { after: 120 } }));
    children.push(...summaryParagraphs(input.summaryMd));
  }

  // ── Aula de estudo ─────────────────────────────────────────────────────
  if (input.studyMd) {
    children.push(
      new Paragraph({
        text: "Aula de estudo",
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 240, after: 120 },
        pageBreakBefore: true,
      }),
    );
    // studyMdForDocs remove o title "# 🎓 Aula: ..." duplicado? Mantemos, vira H2.
    children.push(...summaryParagraphs(studyMdForDocs(input.studyMd)));
  }

  // ── Mapa mental (imagem) ───────────────────────────────────────────────
  if (input.mindmapPngPath && fs.existsSync(input.mindmapPngPath)) {
    const png = fs.readFileSync(input.mindmapPngPath);
    const { width, height } = pngSize(png);
    // Ajusta para caber na largura útil da página A4 (~600pt).
    const maxW = 600;
    const scale = width > maxW ? maxW / width : 1;
    children.push(
      new Paragraph({ text: "Mapa Mental", heading: HeadingLevel.HEADING_1, spacing: { before: 240, after: 120 }, pageBreakBefore: true }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new ImageRun({
            data: png,
            type: "png",
            transformation: { width: Math.round(width * scale), height: Math.round(height * scale) },
          }),
        ],
      }),
    );
  }

  // ── Transcrição ────────────────────────────────────────────────────────
  const transcript = input.transcriptTranslated ?? input.transcript;
  if (transcript) {
    const label = input.transcriptTranslated ? "Transcrição (PT-BR)" : "Transcrição";
    children.push(
      new Paragraph({ text: label, heading: HeadingLevel.HEADING_1, spacing: { before: 240, after: 120 }, pageBreakBefore: true }),
    );
    for (const para of transcript.split(/\n\n+/)) {
      if (para.trim()) {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: para.replace(/\n/g, " ").trim(), size: 20 })],
            spacing: { after: 100 },
          }),
        );
      }
    }
  }

  const doc = new Document({
    creator: "Bruto",
    title: meta.title,
    description: `Resumo, mapa mental e transcrição de "${meta.title}"`,
    sections: [{ children }],
  });

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(input.outPath, buffer);
  return input.outPath;
}

/** Lê largura/altura de um PNG do header IHDR (bytes 16-24). */
function pngSize(buf: Buffer): { width: number; height: number } {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}
