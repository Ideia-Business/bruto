import { NextResponse } from "next/server";
import { getVideosProntosParaExportar } from "@/db/queries";

/**
 * GET /api/videos/concluidos → `{videoId, jobId}` de todo vídeo pronto para
 * exportar (job `done` mais recente, exclui vídeo com job `queued`/`running`
 * em andamento agora).
 *
 * Somente-leitura, sem efeito e sem custo — não passa pela guarda de cliente
 * conhecido (mesmo critério de `GET /api/videos`). Consumido pelo catch-up de
 * exportação automática (`sincronizarExportacoesPendentes`), para recuperar o
 * vídeo cujo `onDone` do SSE disparou numa página que a pessoa não estava
 * olhando. O `jobId` é o que permite ao cliente saber se já exportou ESTE
 * resultado — reprocessar o vídeo (retry) gera um job novo, e a marca do job
 * antigo não vale mais para ele.
 */
export async function GET() {
  return NextResponse.json({ videos: getVideosProntosParaExportar() });
}
