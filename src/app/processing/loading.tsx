import { Skeleton } from "@/components/ui/skeleton";

/** Skeleton da fila de processamento durante navegações do App Router. */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-3xl flex-1 space-y-4 px-4 py-6 sm:px-6">
      <Skeleton className="h-8 w-56" />
      {[0, 1, 2].map((row) => (
        <Skeleton key={row} className="h-16 w-full rounded-md" />
      ))}
    </div>
  );
}
