import { NextResponse } from "next/server";
import { recusarSeNaoForChamadaDeCliente } from "@/lib/endpoint-local";
import { cancelarJob } from "@/pipeline/runner";

/**
 * POST /api/jobs/[id]/cancel — cancela o processamento de um job.
 *
 *   200 { jobId, status: "canceled" }  job estava queued/running e foi cancelado
 *   404                                 job não existe
 *   409 { error, status }               job já done/error/canceled — terminal é
 *                                       terminal; segundo cancelamento NÃO é
 *                                       200 silencioso (idempotência explícita)
 *
 * Cancelar job running mata de verdade os processos daquele job (yt-dlp,
 * whisper, `claude`, `codex`, Chromium) e aborta o fetch de LLM em andamento;
 * o que já foi salvo até ali, salvo fica. A fila segue para o próximo job.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const recusa = recusarSeNaoForChamadaDeCliente(req);
  if (recusa) return recusa;

  const { id } = await params;
  const resultado = await cancelarJob(id);

  if (resultado.resultado === "inexistente") {
    return NextResponse.json({ error: "Job não encontrado" }, { status: 404 });
  }
  if (resultado.resultado === "terminal") {
    const frases: Record<string, string> = {
      done: "Job já concluído",
      error: "Job já terminou com erro",
      canceled: "Job já cancelado",
    };
    return NextResponse.json(
      { error: frases[resultado.status] ?? "Job já finalizado", status: resultado.status },
      { status: 409 },
    );
  }
  return NextResponse.json({ jobId: id, status: "canceled" }, { status: 200 });
}
