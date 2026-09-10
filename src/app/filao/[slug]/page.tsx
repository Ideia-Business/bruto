import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { VideoCard } from "@/components/video-card";
import { getFilaoBrutos, getFilaoBySlug } from "@/db/queries";
import type { VideoCard as VideoCardData } from "@/lib/api-types";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const filao = getFilaoBySlug(slug);
  return { title: filao ? `${filao.name} — Bruto` : "Filão — Bruto" };
}

export default async function FilaoPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const filao = getFilaoBySlug(slug);
  // debt: o conteúdo de 404 renderiza certo e o `noindex` é injetado, mas o
  // status HTTP sai 200. Causa: `src/app/loading.tsx` na raiz é um limite de
  // Suspense acima de toda página — o stream começa pelo fallback e o servidor
  // já se comprometeu com 200 antes de qualquer `notFound()` rodar (ver
  // node_modules/next/dist/docs/01-app/02-guides/streaming.md, "Status codes").
  // Vale para o app inteiro, não só aqui: /video/<id-inexistente> também dá 200.
  // Cura real: tirar o loading.tsx da raiz e pôr um por rota que precise dele —
  // decisão de UX do app, não desta feature.
  if (!filao) notFound();

  const brutos = getFilaoBrutos(filao.id) as unknown as VideoCardData[];

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
        <div className="space-y-6">
          <div>
            <Link
              href="/filoes"
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="size-4" />
              Filões
            </Link>
            <h1 className="mt-2 font-heading text-2xl font-semibold tracking-tight">
              {filao.name}
            </h1>
            <p className="text-sm tabular-nums text-muted-foreground">
              {brutos.length === 0
                ? "nenhum bruto ainda"
                : brutos.length === 1
                  ? "1 bruto"
                  : `${brutos.length} brutos`}
            </p>
          </div>

          {brutos.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border py-16 text-center">
              <h2 className="text-lg font-semibold">Filão vazio</h2>
              <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                Abra um bruto que você já destrinchou e escolha este filão em
                &ldquo;Filões&rdquo;, no topo da página.
              </p>
            </div>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {brutos.map((v) => (
                <li key={v.id}>
                  <VideoCard video={v} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    </>
  );
}
