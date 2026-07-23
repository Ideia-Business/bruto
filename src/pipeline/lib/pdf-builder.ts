import fs from "node:fs";
import { getBrowser } from "./browser";
import { parseMarkdownBlocks, escapeHtml, type InlineToken } from "./md-blocks";
import { formatDuration, formatUploadDate } from "@/lib/format";
import type { VideoMetadata } from "@/pipeline/types";

function inlineHtml(tokens: InlineToken[]): string {
  return tokens
    .map((t) => {
      const safe = escapeHtml(t.text);
      if (t.bold) return `<strong>${safe}</strong>`;
      if (t.italic) return `<em>${safe}</em>`;
      return safe;
    })
    .join("");
}

function summaryHtml(md: string): string {
  const parts: string[] = [];
  let inList = false;
  const closeList = () => {
    if (inList) {
      parts.push("</ul>");
      inList = false;
    }
  };
  for (const b of parseMarkdownBlocks(md)) {
    if (b.type === "bullet") {
      if (!inList) {
        parts.push("<ul>");
        inList = true;
      }
      parts.push(`<li>${inlineHtml(b.tokens)}</li>`);
    } else {
      closeList();
      if (b.type === "h2") parts.push(`<h2>${inlineHtml(b.tokens)}</h2>`);
      else if (b.type === "h3") parts.push(`<h3>${inlineHtml(b.tokens)}</h3>`);
      else parts.push(`<p>${inlineHtml(b.tokens)}</p>`);
    }
  }
  closeList();
  return parts.join("\n");
}

function transcriptHtml(text: string): string {
  return text
    .split(/\n\n+/)
    .filter((p) => p.trim())
    .map((p) => `<p class="tr">${escapeHtml(p.replace(/\n/g, " ").trim())}</p>`)
    .join("\n");
}

export interface PdfInput {
  meta: VideoMetadata;
  summaryMd: string | null;
  mindmapPngPath: string | null;
  transcript: string | null;
  transcriptTranslated: string | null;
  outPath: string;
}

/** Gera o .pdf imprimindo um template HTML (acentuação PT-BR perfeita via Chromium). */
export async function buildPdf(input: PdfInput): Promise<string> {
  const { meta } = input;
  const transcript = input.transcriptTranslated ?? input.transcript;
  const transcriptLabel = input.transcriptTranslated ? "Transcrição (PT-BR)" : "Transcrição";

  let mindmapImg = "";
  if (input.mindmapPngPath && fs.existsSync(input.mindmapPngPath)) {
    const b64 = fs.readFileSync(input.mindmapPngPath).toString("base64");
    mindmapImg = `<section class="page-break"><h1>Mapa Mental</h1>
      <img class="mindmap" src="data:image/png;base64,${b64}" alt="Mapa mental" /></section>`;
  }

  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
  <style>
    @page { size: A4; margin: 18mm 16mm; }
    * { box-sizing: border-box; }
    body { font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #1a1a1a; font-size: 11pt; line-height: 1.5; }
    .cover { border-bottom: 3px solid #e11d48; padding-bottom: 16px; margin-bottom: 24px; }
    .cover h1 { font-size: 24pt; margin: 0 0 6px; line-height: 1.15; }
    .cover .meta { color: #666; font-size: 10pt; }
    .cover a { color: #2563eb; word-break: break-all; }
    h1 { font-size: 16pt; margin: 20px 0 10px; color: #111; }
    h2 { font-size: 13pt; margin: 16px 0 6px; border-bottom: 1px solid #eee; padding-bottom: 3px; }
    h3 { font-size: 11.5pt; margin: 12px 0 4px; }
    p { margin: 0 0 8px; }
    ul { margin: 0 0 10px; padding-left: 20px; }
    li { margin-bottom: 4px; }
    .page-break { page-break-before: always; }
    .mindmap { max-width: 100%; height: auto; display: block; margin: 12px auto; }
    .tr { font-size: 10pt; color: #333; text-align: justify; }
    section { break-inside: auto; }
  </style></head><body>
    <div class="cover">
      <h1>${escapeHtml(meta.title)}</h1>
      <div class="meta">
        ${escapeHtml(meta.channel ?? "Canal desconhecido")}
        ${meta.durationSec ? ` &middot; ${formatDuration(meta.durationSec)}` : ""}
        ${meta.uploadDate ? ` &middot; ${formatUploadDate(meta.uploadDate)}` : ""}
      </div>
      <div class="meta">Link: <a href="${escapeHtml(meta.url)}">${escapeHtml(meta.url)}</a></div>
    </div>
    ${input.summaryMd ? `<section><h1>Resumo</h1>${summaryHtml(input.summaryMd)}</section>` : ""}
    ${mindmapImg}
    ${transcript ? `<section class="page-break"><h1>${transcriptLabel}</h1>${transcriptHtml(transcript)}</section>` : ""}
  </body></html>`;

  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "load" });
    await page.pdf({
      path: input.outPath,
      format: "A4",
      printBackground: true,
      margin: { top: "18mm", bottom: "18mm", left: "16mm", right: "16mm" },
      displayHeaderFooter: true,
      headerTemplate: "<div></div>",
      footerTemplate: `<div style="width:100%;font-size:8px;color:#999;text-align:center;padding:0 10mm;">
        <span class="title"></span> — página <span class="pageNumber"></span>/<span class="totalPages"></span>
      </div>`,
    });
  } finally {
    await page.close();
  }
  return input.outPath;
}
