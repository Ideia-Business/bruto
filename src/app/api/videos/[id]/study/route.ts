import fs from "node:fs";
import { NextResponse } from "next/server";
import { getVideoById } from "@/db/queries";
import { artifactPaths } from "@/pipeline/lib/paths";
import { runStudy } from "@/pipeline/steps/07-study";
import { PipelineError } from "@/pipeline/types";
import { ERROR_HINT } from "@/lib/format";

// Geração pode levar ~30-120s; sem cache.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/videos/[id]/study → monta a aula didática sob demanda.
 * Síncrona: o cliente espera com estado de carregamento. Retorna o markdown.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const video = getVideoById(id);
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
    return NextResponse.json({ ok: true, studyMd: md });
  } catch (err) {
    const code = err instanceof PipelineError ? err.code : "UNKNOWN";
    return NextResponse.json({ error: ERROR_HINT[code] ?? "Falha ao gerar a aula." }, { status: 500 });
  }
}
