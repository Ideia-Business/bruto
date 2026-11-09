"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { JobProgressBar, useJobProgress } from "./job-progress";
import { CancelarJobBotao } from "./cancelar-job-botao";
import { textoDoErro } from "@/lib/format";
import { ESTILO_DE_STATUS, ROTULO_DE_STATUS, statusEfetivo, textoDeCancelado } from "@/lib/job-status-ui";
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
    onCanceled: () => {
      onFinished();
      router.refresh();
    },
  });

  const status = statusEfetivo(progress?.status, job.status);

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
        <>
          <JobProgressBar progress={progress} />
          <div className="mt-2 flex justify-end">
            {/* O botão decide pelo status VIVO (SSE), não pela prop que pode
                estar velha — senão um job `queued` que virou `running` cancela
                direto, sem a confirmação de job rodando (E1c). */}
            <CancelarJobBotao job={{ ...job, status }} onCanceled={onFinished} />
          </div>
        </>
      ) : status === "error" ? (
        <p className="text-xs text-destructive">{textoDoErro(job.errorCode, job.errorMessage)}</p>
      ) : status === "canceled" ? (
        <p className="text-xs text-muted-foreground">
          {textoDeCancelado(progress?.errorMessage ?? job.errorMessage)}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">Concluído</p>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
        ESTILO_DE_STATUS[status as keyof typeof ESTILO_DE_STATUS] ?? ESTILO_DE_STATUS.queued
      }`}
    >
      {ROTULO_DE_STATUS[status as keyof typeof ROTULO_DE_STATUS] ?? status}
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
