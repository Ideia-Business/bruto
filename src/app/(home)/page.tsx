import { SiteHeader } from "@/components/site-header";
import { HomeClient } from "@/components/home-client";
import { getCatalog, getHistory, getHeroVideo, getActiveJobs } from "@/db/queries";
import type { CatalogResponse } from "@/lib/api-types";

// Sempre dinâmico: o catálogo muda a cada processamento.
export const dynamic = "force-dynamic";

export default function HomePage() {
  const initial = {
    hero: getHeroVideo(),
    catalog: getCatalog(),
    history: getHistory(),
    activeJobs: getActiveJobs(),
  } as unknown as CatalogResponse;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
        <HomeClient initial={initial} />
      </main>
    </>
  );
}
