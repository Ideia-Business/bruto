import { NextResponse } from "next/server";
import { recusarSeNaoForChamadaDeCliente } from "@/lib/endpoint-local";
import { getBrutoById, getJobAtivoDoVideo } from "@/db/queries";
import { enqueue } from "@/pipeline/runner";

/**
 * POST /api/videos/[id]/retry?whisper=1&traduzir=1
 * Re-enfileira o processamento do vídeo (usa a URL já conhecida).
 *
 * Vídeo cujo último job foi `canceled` PODE tentar de novo (cancelamento não
 * conclui vídeo nenhum). Vídeo com job `queued`/`running` NÃO pode: é a mesma
 * duplicata ativa do POST /api/videos — o mesmo contrato de resposta.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const recusa = recusarSeNaoForChamadaDeCliente(req);
  if (recusa) return recusa;

  const { id } = await params;
  const video = getBrutoById(id);
  if (!video) return NextResponse.json({ error: "Vídeo não encontrado" }, { status: 404 });

  const ativo = getJobAtivoDoVideo(id);
  if (ativo) {
    return NextResponse.json(
      { error: "Esse vídeo já está na fila", duplicate: true, jobId: ativo.id, videoId: id },
      { status: 409 },
    );
  }

  const { searchParams } = new URL(req.url);
  const jobId = enqueue(video.url, {
    forceWhisper: searchParams.get("whisper") === "1",
    translate: searchParams.get("traduzir") === "1",
  });
  return NextResponse.json({ jobId, videoId: id }, { status: 202 });
}
