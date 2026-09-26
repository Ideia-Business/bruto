"use client";

import { useEffect, useState } from "react";
import { Progress } from "@/components/ui/progress";
import { STEP_LABEL, textoDoErro } from "@/lib/format";
import type { JobProgressEvent } from "@/lib/api-types";

/**
 * Assina o SSE de um job e renderiza a barra de progresso + etapa atual.
 * Chama onDone/onError quando o job termina (para a UI re-buscar o catálogo).
 */
export function useJobProgress(
  jobId: string | null,
  handlers?: { onDone?: (videoId: string | null) => void; onError?: () => void },
) {
  const [progress, setProgress] = useState<JobProgressEvent | null>(null);

  useEffect(() => {
    if (!jobId) return;
    const es = new EventSource(`/api/jobs/${jobId}/events`);
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as JobProgressEvent;
        setProgress(data);
        if (data.status === "done") {
          es.close();
          handlers?.onDone?.(data.videoId);
        } else if (data.status === "error") {
          es.close();
          handlers?.onError?.();
        }
      } catch {
        /* ignora linhas de heartbeat */
      }
    };
    es.onerror = () => es.close();
    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  return progress;
}

export function JobProgressBar({ progress }: { progress: JobProgressEvent | null }) {
  if (!progress) {
    return <Progress value={5} className="h-1.5" />;
  }
  if (progress.status === "error") {
    return (
      <div className="space-y-1">
        <div className="h-1.5 w-full rounded-full bg-destructive/30">
          <div className="h-full rounded-full bg-destructive" style={{ width: "100%" }} />
        </div>
        <p className="text-xs text-destructive">
          {textoDoErro(progress.errorCode, progress.errorMessage)}
        </p>
      </div>
    );
  }
  const label =
    progress.status === "done"
      ? "Concluído"
      : (STEP_LABEL[progress.step ?? ""] ?? "Processando");
  return (
    <div className="space-y-1">
      <Progress value={progress.progressPct} className="h-1.5" />
      <p className="flex justify-between text-xs text-muted-foreground">
        <span>{label}…</span>
        <span className="tabular-nums">{progress.progressPct}%</span>
      </p>
    </div>
  );
}
