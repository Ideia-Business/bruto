import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { jobs } from "@/db/schema";
import { bus } from "@/pipeline/bus";
import type { ErrorCode, JobProgress, JobStep } from "@/pipeline/types";

// SSE precisa de resposta dinâmica e sem cache.
export const dynamic = "force-dynamic";

/**
 * GET /api/jobs/[id]/events → stream SSE de progresso.
 * Emite snapshot inicial (do SQLite) + eventos do bus; heartbeat a cada 15s.
 * Fecha o stream quando o job chega a done/error.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (data: JobProgress) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        bus.off(`job:${id}`, onProgress);
        try {
          controller.close();
        } catch {
          /* já fechado */
        }
      };

      // Snapshot inicial a partir do banco (fonte de verdade).
      const job = db.select().from(jobs).where(eq(jobs.id, id)).get();
      if (!job) {
        controller.enqueue(encoder.encode(`event: notfound\ndata: {}\n\n`));
        close();
        return;
      }
      const snapshot: JobProgress = {
        jobId: job.id,
        videoId: job.videoId,
        status: job.status as JobProgress["status"],
        step: job.currentStep as JobStep | null,
        progressPct: job.progressPct,
        errorCode: job.errorCode as ErrorCode | null,
        errorMessage: job.errorMessage,
      };
      send(snapshot);
      if (job.status === "done" || job.status === "error") {
        close();
        return;
      }

      const onProgress = (p: JobProgress) => {
        send(p);
        if (p.status === "done" || p.status === "error") close();
      };
      bus.on(`job:${id}`, onProgress);

      const heartbeat = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(`: heartbeat\n\n`));
      }, 15_000);

      // Limpeza quando o cliente desconecta.
      req.signal.addEventListener("abort", close);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
