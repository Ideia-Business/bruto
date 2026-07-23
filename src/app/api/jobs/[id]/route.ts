import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { jobs } from "@/db/schema";

/** GET /api/jobs/[id] → snapshot do job (fallback de polling do SSE). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = db.select().from(jobs).where(eq(jobs.id, id)).get();
  if (!job) return NextResponse.json({ error: "Job não encontrado" }, { status: 404 });
  return NextResponse.json(job);
}
