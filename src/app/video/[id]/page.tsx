import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { VideoDetail } from "@/components/video-detail";
import { getVideoDetail } from "@/db/queries";

export const dynamic = "force-dynamic";

export default async function VideoPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab } = await searchParams;
  const detail = getVideoDetail(id);
  if (!detail) notFound();

  // Serializa para o client component (datas viram string via JSON).
  const data = JSON.parse(JSON.stringify({ ...detail, defaultTab: tab }));

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6">
        <VideoDetail data={data} />
      </main>
    </>
  );
}
