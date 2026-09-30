import { SiteHeader } from "@/components/site-header";
import { ConfiguracoesClient } from "@/components/configuracoes-client";

export const dynamic = "force-dynamic";

export default function ConfiguracoesPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-6 sm:px-6">
        <h1 className="mb-4 text-2xl font-bold tracking-tight">Configurações</h1>
        <ConfiguracoesClient />
      </main>
    </>
  );
}
