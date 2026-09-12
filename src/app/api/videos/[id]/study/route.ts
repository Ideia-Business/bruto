import fs from "node:fs";
import { NextResponse } from "next/server";
import { recusarSeNaoForChamadaDeCliente } from "@/lib/endpoint-local";
import { getBrutoById } from "@/db/queries";
import { artifactPaths } from "@/pipeline/lib/paths";
import { runStudy } from "@/pipeline/steps/07-study";
import { runExport } from "@/pipeline/steps/06-export";
import { PipelineError } from "@/pipeline/types";
import { ERROR_HINT } from "@/lib/format";

function readOrNull(p: string): string | null {
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
}

// Geração pode levar ~30-120s; sem cache.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/videos/[id]/study → monta a aula didática sob demanda.
 * Síncrona: o cliente espera com estado de carregamento. Retorna o markdown.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const recusa = recusarSeNaoForChamadaDeCliente(req);
  if (recusa) return recusa;

  const { id } = await params;
  const video = getBrutoById(id);
  if (!video) return NextResponse.json({ error: "Vídeo não encontrado" }, { status: 404 });

  const paths = artifactPaths(id);
  if (!fs.existsSync(paths.infoJson) || !fs.existsSync(paths.transcript)) {
    return NextResponse.json(
      { error: "Transcrição indisponível — reprocesse o vídeo antes de estudar." },
      { status: 409 },
    );
  }

  const meta = JSON.parse(fs.readFileSync(paths.infoJson, "utf8"));
  const transcript = fs.readFileSync(paths.transcript, "utf8");

  try {
    const md = await runStudy(meta, transcript);

    // Regenera docx/pdf para incluir a aula recém-criada (best-effort —
    // a aula já está salva mesmo se o re-export falhar).
    try {
      await runExport({
        meta,
        summaryMd: readOrNull(paths.summary),
        studyMd: md,
        mindmapMd: readOrNull(paths.mindmap),
        transcript: readOrNull(paths.transcript),
        transcriptTranslated: readOrNull(`${paths.dir}/transcript.pt-BR.txt`),
      });
    } catch {
      /* re-export best-effort */
    }

    return NextResponse.json({ ok: true, studyMd: md });
  } catch (err) {
    const code = err instanceof PipelineError ? err.code : "UNKNOWN";
    return NextResponse.json({ error: ERROR_HINT[code] ?? "Falha ao gerar a aula." }, { status: 500 });
  }
}
