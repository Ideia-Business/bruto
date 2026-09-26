"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { sincronizarExportacoesPendentes } from "@/lib/exportar-artefatos";

/** Intervalo do catch-up enquanto a pessoa fica parada numa página (ex.: /configuracoes). */
const INTERVALO_MS = 60_000;

/**
 * Componente invisível montado no layout raiz — roda em toda página, inclusive
 * em navegação client-side (o layout não remonta entre rotas, só o `pathname`
 * muda). Sem isto, um vídeo que termina enquanto a pessoa está em
 * /configuracoes (ligando o interruptor, o lugar óbvio de estar!) nunca é
 * exportado: o `onDone` do SSE só existe enquanto o componente de progresso
 * daquele job está montado, e em /configuracoes ele não está.
 *
 * A troca de rota não é o único gatilho: se a pessoa FICA parada numa página
 * (fica em /configuracoes, ou deixa uma aba do catálogo aberta) enquanto um
 * job termina em segundo plano, só a navegação nunca dispara. O timer é o
 * reforço — leve porque `sincronizarExportacoesPendentes` já retorna cedo,
 * sem rede nenhuma, quando a exportação automática está desligada ou não há
 * pasta configurada.
 */
export function SincronizacaoExportacao() {
  const pathname = usePathname();

  useEffect(() => {
    void sincronizarExportacoesPendentes();
  }, [pathname]);

  useEffect(() => {
    const id = setInterval(() => {
      void sincronizarExportacoesPendentes();
    }, INTERVALO_MS);
    return () => clearInterval(id);
  }, []);

  return null;
}
