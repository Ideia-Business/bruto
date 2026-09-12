import fs from "node:fs";
import { NextResponse } from "next/server";
import { detalheParaWire } from "@/lib/wire";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { artifacts, jobs, brutos } from "@/db/schema";
import { getBrutoDetail, setBrutoCategory, setBrutoTitle } from "@/db/queries";
import { videoDir } from "@/pipeline/lib/paths";

/** GET /api/videos/[id] → detalhe + conteúdo das abas. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = getBrutoDetail(id);
  if (!detail) return NextResponse.json({ error: "Vídeo não encontrado" }, { status: 404 });
  return NextResponse.json(detalheParaWire(detail));
}

/** PATCH /api/videos/[id] { categoryId } → edita a categoria. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { categoryId?: number; title?: string };

  let touched = false;
  if (typeof body.categoryId === "number") {
    setBrutoCategory(id, body.categoryId);
    touched = true;
  }
  if (typeof body.title === "string") {
    const title = body.title.trim();
    if (!title) return NextResponse.json({ error: "O título não pode ficar vazio." }, { status: 400 });
    setBrutoTitle(id, title.slice(0, 300));
    touched = true;
  }
  if (!touched) {
    return NextResponse.json({ error: "Nada para atualizar (title ou categoryId)." }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}

/** DELETE /api/videos/[id] → remove registro + pasta de artefatos. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Ordem: artifacts → jobs → video (FKs), depois a pasta no disco.
  db.delete(artifacts).where(eq(artifacts.videoId, id)).run();
  db.delete(jobs).where(eq(jobs.videoId, id)).run();
  db.delete(brutos).where(eq(brutos.id, id)).run();
  fs.rmSync(videoDir(id), { recursive: true, force: true });
  return NextResponse.json({ ok: true });
}
