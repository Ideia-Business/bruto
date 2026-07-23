"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { JobProgressBar, useJobProgress } from "./job-progress";
import { ERROR_HINT } from "@/lib/format";
import type { Job } from "@/lib/api-types";

/** Linha de um job na página /processing — status ao vivo via SSE. */
function JobRow({ job, onFinished }: { job: Job; onFinished: () => void }) {
  const router = useRouter();
  const isActive = job.status === "queued" || job.status === "running";
  const progress = useJobProgress(isActive ? job.id : null, {
    onDone: () => {
      onFinished();
      router.refresh();
    },
    onError: () => {
      onFinished();
      router.refresh();
    },
  });

  const status = progress?.status ?? job.status;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="min-w-0 flex-1 truncate text-sm">
          {job.videoId ? (
            <Link href={`/video/${job.videoId}`} className="hover:underline">
              {job.url}
            </Link>
          ) : (
            job.url
          )}
        </p>
        <StatusPill status={status} />
      </div>
      {isActive ? (
        <JobProgressBar progress={progress} />
      ) : status === "error" ? (
        <p className="text-xs text-destructive">{ERROR_HINT[job.errorCode ?? "UNKNOWN"]}</p>
      ) : (
        <p className="text-xs text-muted-foreground">Concluído</p>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    queued: "bg-muted text-muted-foreground",
    running: "bg-primary/20 text-primary",
    done: "bg-emerald-500/20 text-emerald-400",
    error: "bg-destructive/20 text-destructive",
  };
  const label: Record<string, string> = {
    queued: "Na fila",
    running: "Processando",
    done: "Concluído",
    error: "Erro",
  };
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${map[status] ?? map.queued}`}>
      {label[status] ?? status}
    </span>
  );
}

export function ProcessingList({ initial }: { initial: Job[] }) {
  const router = useRouter();
  if (initial.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border py-16 text-center text-sm text-muted-foreground">
        Nenhum job ainda. Adicione um vídeo pelo catálogo.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {initial.map((job) => (
        <JobRow key={job.id} job={job} onFinished={() => router.refresh()} />
      ))}
    </div>
  );
}
