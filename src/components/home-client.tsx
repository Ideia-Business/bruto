"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HeroBanner } from "./hero-banner";
import { CategoryRow } from "./category-row";
import { ProcessingCard } from "./processing-card";
import { UrlInputDialog } from "./url-input-dialog";
import { Compatibilidade } from "./compatibilidade";
import type { CatalogResponse, Job } from "@/lib/api-types";
import { fetchApp } from "@/lib/fetch-app";

/**
 * Orquestra a home: renderiza o catálogo inicial (do servidor) e mantém a row
 * "Em processamento" viva. Cada card de job assina seu próprio SSE; ao terminar,
 * re-buscamos o catálogo para o vídeo aparecer na row da categoria.
 */
export function HomeClient({ initial }: { initial: CatalogResponse }) {
  const [data, setData] = useState<CatalogResponse>(initial);
  const [activeJobs, setActiveJobs] = useState<Job[]>(initial.activeJobs);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Debounce reduz QUANTAS vezes buscamos, mas não impede uma busca antiga
  // de responder DEPOIS de uma mais nova (duas em voo ao mesmo tempo — o
  // `clearTimeout` só cancela o disparo, nunca um fetch já em andamento).
  // Geração: só a resposta da busca mais recente é aplicada (achado de
  // Codex e Grok, 4ª rodada do multi-link).
  const geracaoRef = useRef(0);

  const refetch = useCallback(async () => {
    const minhaGeracao = ++geracaoRef.current;
    try {
      const res = await fetchApp("/api/videos");
      const fresh = (await res.json()) as CatalogResponse;
      if (minhaGeracao !== geracaoRef.current) return; // superada por outra busca
      setData(fresh);
      setActiveJobs(fresh.activeJobs);
    } catch {
      /* silencioso — próxima tentativa cobre */
    }
  }, []);

  // Debounce do refetch quando um job termina (evita rajada com vários jobs).
  const scheduleRefetch = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(refetch, 600);
  }, [refetch]);

  // Quando um job é enfileirado pelo dialog, buscamos o novo job da API.
  // Pelo scheduleRefetch (debounce), não refetch() direto: dois envios do
  // multi-link em sequência rápida podiam ter a resposta do mais velho
  // chegar depois da do mais novo e sobrescrever o estado com um retrato
  // mais antigo (achado do Grok, revisão de multi-link) — coalescido, só a
  // última chamada agendada de fato busca, e ela reflete o catálogo atual.
  const onQueued = useCallback(() => {
    scheduleRefetch();
  }, [scheduleRefetch]);

  useEffect(() => {
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, []);

  const hasContent = data.catalog.length > 0 || activeJobs.length > 0;

  return (
    <div className="space-y-8">
      {data.hero && <HeroBanner video={data.hero} />}

      {/* `hidden`, nunca desmontar: um lote com link inválido deixa o diálogo
          aberto pedindo correção, e o primeiro link válido já enfileirado
          vira `hasContent`. Desmontar aqui (o `{!hasContent && ...}` de
          antes) apagava o resumo e o texto no meio da correção, com o
          diálogo ainda aberto (achado do Codex, revisão final). */}
      <div
        hidden={hasContent}
        className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-border py-20 text-center"
      >
        <p className="text-2xl">🎬</p>
        <div>
          <h2 className="text-lg font-semibold">Seu catálogo está vazio</h2>
        </div>
        <UrlInputDialog
          onQueued={onQueued}
          trigger={
            <Button className="gap-1.5">
              <Plus className="size-4" />
              Adicionar vídeo
            </Button>
          }
        />
        <div className="w-full max-w-3xl px-4">
          <Compatibilidade />
        </div>
      </div>

      {activeJobs.length > 0 && (
        <section className="space-y-2">
          <h2 className="px-1 text-lg font-bold tracking-tight">Em processamento</h2>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {activeJobs.map((job) => (
              <ProcessingCard key={job.id} job={job} onFinished={scheduleRefetch} />
            ))}
          </div>
        </section>
      )}

      {data.catalog.map((row) => (
        <CategoryRow key={row.category.id} title={row.category.name} brutos={row.videos} />
      ))}

      {data.history.length > 0 && (
        <CategoryRow title="Histórico" brutos={data.history} />
      )}

      {hasContent && <Compatibilidade />}
    </div>
  );
}
