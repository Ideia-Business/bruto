import fs from "node:fs";
import type { Bruto } from "@/db/schema";
import { artifactPaths } from "@/pipeline/lib/paths";
import { runExport } from "@/pipeline/steps/06-export";
import type { VideoMetadata } from "@/pipeline/types";

/**
 * Reexporta docx/pdf com o título novo — sem isto (achado 4, Grok, 9ª
 * rodada), `setBrutoTitle` já atualizava o banco/catálogo, mas os arquivos em
 * `library/<id>/` continuavam com o título antigo PARA SEMPRE. Best-effort:
 * o título já está salvo no banco de qualquer forma; falha aqui só deixa os
 * arquivos desatualizados até o próximo reprocessamento.
 *
 * Em módulo próprio (fora de `reclassificar-cli.ts`) para ser testável sem
 * disparar o `main()`/`process.exit()` do script — importar o script
 * diretamente executaria o CLI inteiro.
 */
export async function reexportarComTituloNovo(
  bruto: Bruto,
  tituloNovo: string,
  transcriptText: string,
): Promise<void> {
  const paths = artifactPaths(bruto.id);
  const dir = paths.dir;
  const meta: VideoMetadata = {
    id: bruto.id,
    url: bruto.url,
    platform: bruto.platform as VideoMetadata["platform"],
    title: tituloNovo,
    channel: bruto.channel,
    durationSec: bruto.durationSec,
    uploadDate: bruto.uploadDate,
    language: bruto.language,
    description: null,
    chapters: [],
    tags: [],
    subtitleLangs: [],
    autoCaptionLangs: [],
    thumbnailUrl: null,
  };
  try {
    await runExport({
      meta,
      summaryMd: fs.existsSync(paths.summary) ? fs.readFileSync(paths.summary, "utf8") : null,
      studyMd: fs.existsSync(`${dir}/study.md`) ? fs.readFileSync(`${dir}/study.md`, "utf8") : null,
      mindmapMd: fs.existsSync(paths.mindmap) ? fs.readFileSync(paths.mindmap, "utf8") : null,
      transcript: transcriptText,
      transcriptTranslated: fs.existsSync(`${dir}/transcript.pt-BR.txt`)
        ? fs.readFileSync(`${dir}/transcript.pt-BR.txt`, "utf8")
        : null,
    });
  } catch {
    /* re-export best-effort — ver comentário da função */
  }
}
