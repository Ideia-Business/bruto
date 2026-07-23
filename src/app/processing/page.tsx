import { SiteHeader } from "@/components/site-header";
import { ProcessingList } from "@/components/processing-list";
import { getAllJobs } from "@/db/queries";
import type { Job } from "@/lib/api-types";

export const dynamic = "force-dynamic";

export default function ProcessingPage() {
  const jobs = JSON.parse(JSON.stringify(getAllJobs())) as Job[];
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 sm:px-6">
        <h1 className="mb-4 text-2xl font-bold tracking-tight">Fila de processamento</h1>
        <ProcessingList initial={jobs} />
      </main>
    </>
  );
}
