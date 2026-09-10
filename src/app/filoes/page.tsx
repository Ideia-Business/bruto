import { SiteHeader } from "@/components/site-header";
import { FiloesClient } from "@/components/filoes-client";
import { listFiloes } from "@/db/queries";
import type { FilaoRow } from "@/lib/api-types";

// Sempre dinâmico: os filões mudam a cada edição.
export const dynamic = "force-dynamic";

export const metadata = { title: "Filões — Bruto" };

export default function FiloesPage() {
  const initial = listFiloes() as unknown as FilaoRow[];

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
        <FiloesClient initial={initial} />
      </main>
    </>
  );
}
