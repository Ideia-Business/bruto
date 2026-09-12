import { NextResponse } from "next/server";
import { recusarSeNaoForChamadaDeCliente } from "@/lib/endpoint-local";
import { getBrutoById } from "@/db/queries";
import { enqueue } from "@/pipeline/runner";

/**
 * POST /api/videos/[id]/retry?whisper=1&traduzir=1
 * Re-enfileira o processamento do vídeo (usa a URL já conhecida).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const recusa = recusarSeNaoForChamadaDeCliente(req);
  if (recusa) return recusa;

  const { id } = await params;
  const video = getBrutoById(id);
  if (!video) return NextResponse.json({ error: "Vídeo não encontrado" }, { status: 404 });

  const { searchParams } = new URL(req.url);
  const jobId = enqueue(video.url, {
    forceWhisper: searchParams.get("whisper") === "1",
    translate: searchParams.get("traduzir") === "1",
  });
  return NextResponse.json({ jobId, videoId: id }, { status: 202 });
}
