/**
 * Hook de boot do Next.js — roda uma vez quando o servidor inicia.
 * Re-enfileira jobs órfãos (que ficaram `running`/`queued` num crash/restart)
 * para que nenhum processamento fique preso.
 *
 * Modo pacote (`BRUTO_EMPACOTADO=1`, contrato do instalador): aplica as
 * migrações e o seed ANTES de re-enfileirar órfãos — INVARIANTE F4: o boot
 * empacotado nunca sobe sem schema. Falha de migração derruba o boot com
 * mensagem clara no log (rethrow: o Next não sobe um servidor sem tabelas).
 *
 * Ainda no modo pacote, ANTES de tudo: carrega o `.env` da pessoa
 * (`$BRUTO_DATA_ROOT/.env`, default `~/.bruto/.env`) — no pacote não existe
 * `.env` editável, e sem esta carga o caminho "chave de API" simplesmente
 * não existiria no app instalado. Nunca derruba o boot (ver env-usuario.ts).
 */
export async function register(): Promise<void> {
  // Só no runtime Node (não no edge).
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  if (process.env.BRUTO_EMPACOTADO === "1") {
    const { carregarEnvDoUsuario } = await import("@/lib/env-usuario");
    carregarEnvDoUsuario();
    try {
      const { aplicarMigracoes } = await import("@/db/migrate");
      aplicarMigracoes();
      const { aplicarSeed } = await import("@/db/seed");
      aplicarSeed();
    } catch (err) {
      console.error(
        "[bruto] FALHA DE BOOT: não foi possível aplicar as migrações/seed do banco. " +
          "O servidor NÃO vai subir sem schema.",
        err,
      );
      throw err;
    }
  }

  const { recoverOrphans } = await import("@/pipeline/runner");
  const n = recoverOrphans();
  if (n > 0) console.log(`[bruto] ${n} job(s) órfão(s) re-enfileirado(s) no boot.`);
}
