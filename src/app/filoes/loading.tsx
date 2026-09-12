import { Skeleton } from "@/components/ui/skeleton";

/** Skeleton da lista de filões durante navegações do App Router. */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-7xl flex-1 space-y-6 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-9 w-48" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((c) => (
          <Skeleton key={c} className="h-16 w-full rounded-md" />
        ))}
      </div>
    </div>
  );
}
