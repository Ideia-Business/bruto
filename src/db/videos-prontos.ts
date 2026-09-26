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
  /** Só existe pra job que já rodou até o fim (done/error) — é `runner.ts` quem grava, na hora exata da transição. */
  finishedAt: Date | null;
}

/**
 * Ordena do mais recente pro mais antigo. `finishedAt` (não `createdAt`) é o
 * critério primário — achado da 7ª revisão (Grok): `createdAt` grava em
 * SEGUNDOS, e dois jobs do MESMO vídeo criados dentro do mesmo segundo
 * (reprocessar rápido, corrida de duplo POST) empatavam, e o desempate caía
 * na ordem que o SELECT sem `ORDER BY` devolvia — podia escolher o job MAIS
 * VELHO como "o mais recente". `finishedAt` é bem mais confiável: a fila do
 * pipeline é SERIAL (um job de cada vez), então dois jobs do mesmo vídeo só
 * terminam ao mesmo tempo numa coincidência bem mais estreita que "criados
 * no mesmo segundo". `id` como ÚLTIMO recurso não é uma alegação de "é o
 * job mais novo" (nanoid não é ordenável cronologicamente) — só garante uma
 * ordem determinística em vez de depender da ordem não especificada do
 * SELECT, no caso (nunca visto) de os dois critérios de tempo também
 * empatarem.
 */
function porRecencia(a: JobResumido, b: JobResumido): number {
  const tA = (a.finishedAt ?? a.createdAt).getTime();
  const tB = (b.finishedAt ?? b.createdAt).getTime();
  if (tA !== tB) return tB - tA;
  return b.id.localeCompare(a.id);
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
    .sort(porRecencia);
  const jobIdPorVideo = new Map<string, string>();
  for (const j of done) {
    const videoId = j.videoId as string;
    if (!jobIdPorVideo.has(videoId)) jobIdPorVideo.set(videoId, j.id);
  }
  return Array.from(jobIdPorVideo, ([videoId, jobId]) => ({ videoId, jobId }));
}
