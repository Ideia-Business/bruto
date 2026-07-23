import fs from "node:fs";
import { renderMindmap } from "@/pipeline/lib/markmap-export";
import { buildDocx } from "@/pipeline/lib/docx-builder";
import { buildPdf } from "@/pipeline/lib/pdf-builder";
import { artifactPaths } from "@/pipeline/lib/paths";
import { recordArtifact } from "@/pipeline/lib/artifacts";
import type { VideoMetadata } from "@/pipeline/types";

export interface ExportInput {
  meta: VideoMetadata;
  summaryMd: string | null;
  mindmapMd: string | null;
  transcript: string | null;
  transcriptTranslated: string | null;
  onTick?: (pct: number, detail: string) => void;
}

/**
 * Etapa 6 — export. Ordem: imagem do mapa (docx/pdf a embutem) → docx → pdf.
 * Registra todos os artefatos gerados. Falha em um formato não impede o outro.
 */
export async function runExport(input: ExportInput): Promise<void> {
  const { meta } = input;
  const paths = artifactPaths(meta.id);
  const tick = input.onTick ?? (() => {});

  // 1) Mapa mental → SVG + PNG (se houver mindmap).
  let mindmapPngPath: string | null = null;
  if (input.mindmapMd) {
    tick(5, "Renderizando mapa mental");
    try {
      await renderMindmap(input.mindmapMd, {
        svgPath: paths.mindmapSvg,
        pngPath: paths.mindmapPng,
      });
      if (fs.existsSync(paths.mindmapSvg)) recordArtifact(meta.id, "mindmap_svg", paths.mindmapSvg);
      if (fs.existsSync(paths.mindmapPng)) {
        recordArtifact(meta.id, "mindmap_png", paths.mindmapPng);
        mindmapPngPath = paths.mindmapPng;
      }
    } catch (err) {
      console.warn(`[export] falha ao renderizar mapa mental de ${meta.id}:`, err);
    }
  }

  // 2) DOCX.
  tick(45, "Gerando documento Word");
  try {
    await buildDocx({
      meta,
      summaryMd: input.summaryMd,
      mindmapPngPath,
      transcript: input.transcript,
      transcriptTranslated: input.transcriptTranslated,
      outPath: paths.docx,
    });
    if (fs.existsSync(paths.docx)) recordArtifact(meta.id, "docx", paths.docx);
  } catch (err) {
    console.warn(`[export] falha ao gerar docx de ${meta.id}:`, err);
  }

  // 3) PDF.
  tick(75, "Gerando PDF");
  try {
    await buildPdf({
      meta,
      summaryMd: input.summaryMd,
      mindmapPngPath,
      transcript: input.transcript,
      transcriptTranslated: input.transcriptTranslated,
      outPath: paths.pdf,
    });
    if (fs.existsSync(paths.pdf)) recordArtifact(meta.id, "pdf", paths.pdf);
  } catch (err) {
    console.warn(`[export] falha ao gerar pdf de ${meta.id}:`, err);
  }

  tick(100, "Exportações concluídas");
}
