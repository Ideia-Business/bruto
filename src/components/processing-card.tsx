"use client";

import { useRouter } from "next/navigation";
import { Thumb } from "./thumb";
import { JobProgressBar, useJobProgress } from "./job-progress";
import { CancelarJobBotao } from "./cancelar-job-botao";
import type { Job } from "@/lib/api-types";

/**
 * Card de um job em processamento — thumb (se já tem videoId) + barra SSE.
 * Ao concluir (ou cancelar), dispara o refresh do catálogo (via callback).
 */
export function ProcessingCard({
  job,
  onFinished,
}: {
  job: Job;
  onFinished: () => void;
}) {
  const router = useRouter();
  const progress = useJobProgress(job.id, {
    onDone: () => {
      onFinished();
      router.refresh();
    },
    onError: () => onFinished(),
    onCanceled: () => onFinished(),
  });
  const videoId = progress?.videoId ?? job.videoId;

  return (
    <div className="w-64 shrink-0 space-y-2 rounded-md border border-border bg-card p-2.5">
      <div className="relative aspect-video overflow-hidden rounded bg-muted">
        {videoId ? (
          <Thumb videoId={videoId} alt="Processando" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-3xl text-muted-foreground">
            ⏳
          </div>
        )}
      </div>
      <JobProgressBar progress={progress} />
      <div className="flex justify-end">
        <CancelarJobBotao job={job} onCanceled={onFinished} />
      </div>
    </div>
  );
}
