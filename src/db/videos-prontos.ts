/**
 * Decisão pura de quais vídeos estão prontos para a exportação automática
 * recuperar. Vive num módulo próprio, sem `./client` (que abre
 * `~/.bruto/bruto.db` de verdade em WAL ao ser importado) — achado da 5ª
 * revisão cross-vendor (Grok): testar esta função pura através de
 * `@/db/queries` puxava esse efeito colateral à toa, já que qualquer import
 * do módulo executa o arquivo inteiro, `./client` incluso.
 */

export interface VideoProntoParaExportar {
  videoId: string;
  /** O job DONE mais recente daquele vídeo — a chave que invalida a marca de "já exportado" quando o vídeo é reprocessado. */
  jobId: string;
}

export interface JobResumido {
  id: string;
  videoId: string | null;
  status: string;
  createdAt: Date;
}

/**
 * Dado um conjunto de jobs (qualquer status), decide o par (videoId, jobId)
 * do job DONE mais recente de cada vídeo. Exclui vídeo com job
 * `queued`/`running` EM ANDAMENTO agora — sem isso, o catch-up pegaria o
 * resultado "done" antigo enquanto um job novo pro mesmo vídeo (retry) ainda
 * está rodando, e exportaria o conteúdo desatualizado no meio do reprocesso.
 */
export function videosProntosParaExportar(jobsTodos: JobResumido[]): VideoProntoParaExportar[] {
  const emAndamento = new Set(
    jobsTodos
      .filter((j) => j.videoId && (j.status === "queued" || j.status === "running"))
      .map((j) => j.videoId as string),
  );
  const done = jobsTodos
    .filter((j) => j.videoId && j.status === "done" && !emAndamento.has(j.videoId))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const jobIdPorVideo = new Map<string, string>();
  for (const j of done) {
    const videoId = j.videoId as string;
    if (!jobIdPorVideo.has(videoId)) jobIdPorVideo.set(videoId, j.id);
  }
  return Array.from(jobIdPorVideo, ([videoId, jobId]) => ({ videoId, jobId }));
}
