import { SiteHeader } from "@/components/site-header";
import { HomeClient } from "@/components/home-client";
import { getCatalog, getHistory, getHeroBruto, getActiveJobs } from "@/db/queries";
import { catalogoParaWire } from "@/lib/wire";

// Sempre dinâmico: o catálogo muda a cada processamento.
export const dynamic = "force-dynamic";

export default function HomePage() {
  // Mesma conversão da rota: o HomeClient recebe o payload do servidor e, no
  // refetch, o da rota — as duas formas TÊM de ser a mesma.
  const initial = catalogoParaWire({
    hero: getHeroBruto(),
    catalog: getCatalog(),
    history: getHistory(),
    activeJobs: getActiveJobs(),
  });

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
        <HomeClient initial={initial} />
      </main>
    </>
  );
}
