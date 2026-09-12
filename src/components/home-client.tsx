"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HeroBanner } from "./hero-banner";
import { CategoryRow } from "./category-row";
import { ProcessingCard } from "./processing-card";
import { UrlInputDialog } from "./url-input-dialog";
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

  const refetch = useCallback(async () => {
    try {
      const res = await fetchApp("/api/videos");
      const fresh = (await res.json()) as CatalogResponse;
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
  const onQueued = useCallback(() => {
    void refetch();
  }, [refetch]);

  useEffect(() => {
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, []);

  const hasContent = data.catalog.length > 0 || activeJobs.length > 0;

  return (
    <div className="space-y-8">
      {data.hero && <HeroBanner video={data.hero} />}

      {!hasContent && (
        <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-border py-20 text-center">
          <p className="text-2xl">🎬</p>
          <div>
            <h2 className="text-lg font-semibold">Seu catálogo está vazio</h2>
            <p className="text-sm text-muted-foreground">
              Cole um link do YouTube, Instagram ou TikTok e destrinche o primeiro.
            </p>
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
        </div>
      )}

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
    </div>
  );
}
