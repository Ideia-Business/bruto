import { Skeleton } from "@/components/ui/skeleton";

/**
 * Skeleton da home durante navegações do App Router (percepção de rapidez).
 * Escopado ao route group `(home)` — só cobre `/`, nunca as rotas dinâmicas
 * que podem dar 404 (ver debt removido de filao/[slug]/page.tsx).
 */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-7xl flex-1 space-y-8 px-4 py-6 sm:px-6">
      <Skeleton className="h-[300px] w-full rounded-xl sm:h-[360px]" />
      {[0, 1].map((row) => (
        <div key={row} className="space-y-2">
          <Skeleton className="h-6 w-40" />
          <div className="flex gap-2">
            {[0, 1, 2, 3, 4].map((c) => (
              <Skeleton key={c} className="aspect-video basis-1/2 rounded-md sm:basis-1/3 lg:basis-1/5" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
