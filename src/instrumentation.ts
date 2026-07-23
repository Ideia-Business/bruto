/**
 * Hook de boot do Next.js — roda uma vez quando o servidor inicia.
 * Re-enfileira jobs órfãos (que ficaram `running`/`queued` num crash/restart)
 * para que nenhum processamento fique preso.
 */
export async function register(): Promise<void> {
  // Só no runtime Node (não no edge).
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { recoverOrphans } = await import("@/pipeline/runner");
  const n = recoverOrphans();
  if (n > 0) console.log(`[resume-video] ${n} job(s) órfão(s) re-enfileirado(s) no boot.`);
}
