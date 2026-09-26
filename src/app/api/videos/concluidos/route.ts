import { NextResponse } from "next/server";
import { getDoneVideoIds } from "@/db/queries";

/**
 * GET /api/videos/concluidos → IDs de todo vídeo com job `done`.
 *
 * Somente-leitura, sem efeito e sem custo — não passa pela guarda de cliente
 * conhecido (mesmo critério de `GET /api/videos`). Consumido pelo catch-up de
 * exportação automática (`sincronizarExportacoesPendentes`), para recuperar o
 * vídeo cujo `onDone` do SSE disparou numa página que a pessoa não estava
 * olhando.
 */
export async function GET() {
  return NextResponse.json({ videoIds: getDoneVideoIds() });
}
