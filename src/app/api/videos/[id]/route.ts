import fs from "node:fs";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { artifacts, jobs, videos } from "@/db/schema";
import { getVideoDetail, setVideoCategory } from "@/db/queries";
import { videoDir } from "@/pipeline/lib/paths";

/** GET /api/videos/[id] → detalhe + conteúdo das abas. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = getVideoDetail(id);
  if (!detail) return NextResponse.json({ error: "Vídeo não encontrado" }, { status: 404 });
  return NextResponse.json(detail);
}

/** PATCH /api/videos/[id] { categoryId } → edita a categoria. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { categoryId?: number };
  if (typeof body.categoryId !== "number") {
    return NextResponse.json({ error: "categoryId obrigatório" }, { status: 400 });
  }
  setVideoCategory(id, body.categoryId);
  return NextResponse.json({ ok: true });
}

/** DELETE /api/videos/[id] → remove registro + pasta de artefatos. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Ordem: artifacts → jobs → video (FKs), depois a pasta no disco.
  db.delete(artifacts).where(eq(artifacts.videoId, id)).run();
  db.delete(jobs).where(eq(jobs.videoId, id)).run();
  db.delete(videos).where(eq(videos.id, id)).run();
  fs.rmSync(videoDir(id), { recursive: true, force: true });
  return NextResponse.json({ ok: true });
}
