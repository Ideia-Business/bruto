import fs from "node:fs";
import { NextResponse } from "next/server";
import { recusarSeNaoForChamadaDeCliente } from "@/lib/endpoint-local";
import { getBrutoById } from "@/db/queries";
import { artifactPaths } from "@/pipeline/lib/paths";
import { runTranscriptOrganized } from "@/pipeline/steps/08-transcript-variants";
import { PipelineError } from "@/pipeline/types";
import { ERROR_HINT } from "@/lib/format";

// Geração pode levar ~30-120s, igual à Aula; sem cache.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/videos/[id]/transcript-organized → reorganiza a transcrição por
 * assunto, para leitura humana, sob demanda. Síncrona: o cliente espera com
 * estado de carregamento. Retorna o markdown.
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
      { error: "Transcrição indisponível — reprocesse o vídeo antes de organizar." },
      { status: 409 },
    );
  }

  const meta = JSON.parse(fs.readFileSync(paths.infoJson, "utf8"));
  const transcript = fs.readFileSync(paths.transcript, "utf8");

  try {
    const md = await runTranscriptOrganized(meta, transcript);
    return NextResponse.json({ ok: true, transcriptOrganizedMd: md });
  } catch (err) {
    const code = err instanceof PipelineError ? err.code : "UNKNOWN";
    return NextResponse.json(
      { error: ERROR_HINT[code] ?? "Falha ao organizar a transcrição." },
      { status: 500 },
    );
  }
}
