"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { sincronizarExportacoesPendentes } from "@/lib/exportar-artefatos";

/**
 * Componente invisível montado no layout raiz — roda em toda página, inclusive
 * em navegação client-side (o layout não remonta entre rotas, só o `pathname`
 * muda). Sem isto, um vídeo que termina enquanto a pessoa está em
 * /configuracoes (ligando o interruptor, o lugar óbvio de estar!) nunca é
 * exportado: o `onDone` do SSE só existe enquanto o componente de progresso
 * daquele job está montado, e em /configuracoes ele não está.
 */
export function SincronizacaoExportacao() {
  const pathname = usePathname();

  useEffect(() => {
    void sincronizarExportacoesPendentes();
  }, [pathname]);

  return null;
}
