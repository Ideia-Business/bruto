"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, Tag as TagIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { HeroBanner } from "./hero-banner";
import { CategoryRow } from "./category-row";
import { ProcessingCard } from "./processing-card";
import { UrlInputDialog } from "./url-input-dialog";
import { Compatibilidade } from "./compatibilidade";
import type { BrutoCard, CatalogResponse, Job, TagRow } from "@/lib/api-types";
import { fetchApp } from "@/lib/fetch-app";

/** Sentinela de "sem filtro" no `<Select>` — nunca pode colidir com um ID de
 *  tag de verdade (nanoid), diferente do slug, que vem de fora e não é um
 *  namespace controlado por nós. */
const SEM_FILTRO = "__todas__";

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

  // Filtro por tag — puramente client-side sobre o catálogo já carregado (as
  // tags de cada vídeo já vêm no payload). Sem tela própria: tag é só filtro.
  // Filtra por ID da tag, nunca pelo slug: slug vem de fora (IA ou nome livre
  // digitado por alguém) e não é um namespace controlado por nós — um slug
  // "todas" colidiria com o valor sentinela de "limpar filtro" se ele fosse o
  // valor comparado. ID gerado por nanoid nunca colide com a sentinela.
  const [tagRows, setTagRows] = useState<TagRow[]>([]);
  const [filtroTagId, setFiltroTagId] = useState<string | null>(null);

  const refetchTags = useCallback(async () => {
    try {
      const res = await fetchApp("/api/tags");
      const d = (await res.json()) as { tags: TagRow[] };
      setTagRows(d.tags);
    } catch {
      /* silencioso — o filtro só some, o catálogo continua funcionando */
    }
  }, []);

  useEffect(() => {
    // Microtask — mesma técnica de `search-command.tsx`: evita que o setState
    // dentro de `refetchTags` seja visto como SÍNCRONO dentro do efeito
    // (react-hooks/set-state-in-effect), o que dispara renders em cascata.
    queueMicrotask(() => void refetchTags());
  }, [refetchTags]);

  const combina = useCallback(
    (v: BrutoCard) => !filtroTagId || v.tags.some((t) => t.id === filtroTagId),
    [filtroTagId],
  );
  const catalogFiltrado = useMemo(
    () =>
      data.catalog
        .map((row) => ({ ...row, videos: row.videos.filter(combina) }))
        .filter((row) => row.videos.length > 0),
    [data.catalog, combina],
  );
  const historicoFiltrado = useMemo(() => data.history.filter(combina), [data.history, combina]);

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
    // Um vídeo que acabou de processar pode ter ganhado tag nova — sem isto o
    // filtro só atualiza quando a página recarrega.
    void refetchTags();
  }, [refetchTags]);

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
      {/* Passa pelo mesmo filtro de tag do resto do catálogo — sem isto, o
          hero "Continue de onde parou" seguia aparecendo mesmo sem a tag
          escolhida, enquanto a lista abaixo dizia "nenhum vídeo com essa
          tag" (achado do Grok, 5ª rodada). */}
      {data.hero && combina(data.hero) && <HeroBanner video={data.hero} />}

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

      {hasContent && tagRows.length > 0 && (
        <div className="flex items-center gap-2 px-1">
          <TagIcon className="size-4 text-muted-foreground" />
          <Select
            value={filtroTagId ?? SEM_FILTRO}
            onValueChange={(v) => setFiltroTagId(v === SEM_FILTRO ? null : v)}
          >
            <SelectTrigger size="sm" className="h-8 w-auto gap-1 border-border bg-secondary text-xs">
              <SelectValue placeholder="Todas as tags" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={SEM_FILTRO}>Todas as tags</SelectItem>
              {tagRows.map(({ tag, count }) => (
                <SelectItem key={tag.id} value={tag.id}>
                  {tag.name} ({count})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {catalogFiltrado.map((row) => (
        <CategoryRow key={row.category.id} title={row.category.name} brutos={row.videos} />
      ))}

      {historicoFiltrado.length > 0 && (
        <CategoryRow title="Histórico" brutos={historicoFiltrado} />
      )}

      {filtroTagId && catalogFiltrado.length === 0 && historicoFiltrado.length === 0 && (
        <p className="py-10 text-center text-sm text-muted-foreground">
          Nenhum vídeo com essa tag ainda.
        </p>
      )}

      {hasContent && <Compatibilidade />}
    </div>
  );
}
