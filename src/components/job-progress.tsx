"use client";

import { useEffect, useState } from "react";
import { Progress } from "@/components/ui/progress";
import { STEP_LABEL, textoDoErro } from "@/lib/format";
import { textoDeCancelado, progressoDoJob } from "@/lib/job-status-ui";
import { exportarVideoAutomaticamente } from "@/lib/exportar-artefatos";
import type { JobProgressEvent } from "@/lib/api-types";

/**
 * Assina o SSE de um job e renderiza a barra de progresso + etapa atual.
 * Chama onDone/onError/onCanceled quando o job termina (para a UI
 * re-buscar o catálogo) — `onCanceled` NÃO exporta nada: cancelamento
 * não conclui vídeo, e o fetch de exportação automática é só do `done`.
 */
export function useJobProgress(
  jobId: string | null,
  handlers?: {
    onDone?: (videoId: string | null) => void;
    onError?: () => void;
    onCanceled?: () => void;
  },
) {
  const [progress, setProgress] = useState<JobProgressEvent | null>(null);
  const [jobIdAnterior, setJobIdAnterior] = useState(jobId);

  // Trocou de job (ou desligou): o progresso do job anterior — inclusive o
  // evento TERMINAL dele — não pode vazar para o novo (INVARIANTE P1). O
  // reset acontece DURANTE o render (padrão do React para "ajustar state
  // quando a prop muda"), sem setState síncrono no corpo do efeito.
  if (jobIdAnterior !== jobId) {
    setJobIdAnterior(jobId);
    setProgress(null);
  }

  useEffect(() => {
    if (!jobId) return;
    // Cleanup fecha o ES e cala o onmessage: evento tardio de um
    // EventSource antigo não escreve estado depois da troca.
    let vivo = true;
    const es = new EventSource(`/api/jobs/${jobId}/events`);
    es.onmessage = (e) => {
      if (!vivo) return;
      try {
        const data = JSON.parse(e.data) as JobProgressEvent;
        // Só evento do job DESTA assinatura: de outro job é ruído.
        if (data.jobId !== jobId) return;
        setProgress(data);
        if (data.status === "done") {
          es.close();
          handlers?.onDone?.(data.videoId);
          void exportarVideoAutomaticamente(data.videoId, data.jobId);
        } else if (data.status === "error") {
          es.close();
          handlers?.onError?.();
        } else if (data.status === "canceled") {
          es.close();
          handlers?.onCanceled?.();
        }
      } catch {
        /* ignora linhas de heartbeat */
      }
    };
    es.onerror = () => es.close();
    return () => {
      vivo = false;
      es.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  // Cinto e suspensório: o valor devolvido é sempre do jobId pedido —
  // nem que um evento de outro job tenha escapado do guarda do onmessage.
  return progressoDoJob(progress, jobId);
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
  if (progress.status === "canceled") {
    return (
      <div className="space-y-1">
        <div className="h-1.5 w-full rounded-full bg-muted">
          <div className="h-full rounded-full bg-muted-foreground/40" style={{ width: "100%" }} />
        </div>
        <p className="text-xs text-muted-foreground">{textoDeCancelado(progress.errorMessage)}</p>
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
