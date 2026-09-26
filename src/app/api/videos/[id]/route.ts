import fs from "node:fs";
import { NextResponse } from "next/server";
import {
  lerJsonLimitado,
  LIMITE_CORPO_PEQUENO,
  recusarSeNaoForChamadaDeCliente,
} from "@/lib/endpoint-local";
import { detalheParaWire } from "@/lib/wire";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { artifacts, jobs, brutos } from "@/db/schema";
import { getBrutoById, getBrutoDetail, setBrutoCategory, setBrutoTitle } from "@/db/queries";
import { artifactPaths, videoDir } from "@/pipeline/lib/paths";
import { reexportarComTituloNovo } from "@/pipeline/lib/reexportar-titulo";

/** GET /api/videos/[id] → detalhe + conteúdo das abas. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = getBrutoDetail(id);
  if (!detail) return NextResponse.json({ error: "Vídeo não encontrado" }, { status: 404 });
  return NextResponse.json(detalheParaWire(detail));
}

/** PATCH /api/videos/[id] { categoryId } → edita a categoria. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const recusa = recusarSeNaoForChamadaDeCliente(req);
  if (recusa) return recusa;

  const { id } = await params;
  const lido = await lerJsonLimitado(req, LIMITE_CORPO_PEQUENO);
  if (!lido.ok) return lido.resposta;
  const body = (lido.dados ?? {}) as { categoryId?: number; title?: string };

  let touched = false;
  if (typeof body.categoryId === "number") {
    setBrutoCategory(id, body.categoryId);
    touched = true;
  }
  if (typeof body.title === "string") {
    const title = body.title.trim();
    if (!title) return NextResponse.json({ error: "O título não pode ficar vazio." }, { status: 400 });
    const tituloFinal = title.slice(0, 300);
    setBrutoTitle(id, tituloFinal);
    touched = true;

    // Sem isto, o catálogo mostrava o nome novo mas o docx/pdf em
    // library/<id>/ continuavam com o título antigo pra sempre — renomear
    // manualmente na tela é bem mais comum que rodar `reclassificar-cli`
    // (o único outro lugar que chamava isto até aqui). Best-effort: a
    // função já engole os próprios erros, e sem transcrição em disco não
    // há o que reexportar ainda.
    const bruto = getBrutoById(id);
    const paths = artifactPaths(id);
    if (bruto && fs.existsSync(paths.transcript)) {
      await reexportarComTituloNovo(bruto, tituloFinal, fs.readFileSync(paths.transcript, "utf8"));
    }
  }
  if (!touched) {
    return NextResponse.json({ error: "Nada para atualizar (title ou categoryId)." }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}

/** DELETE /api/videos/[id] → remove registro + pasta de artefatos. */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const recusa = recusarSeNaoForChamadaDeCliente(req);
  if (recusa) return recusa;

  const { id } = await params;
  // Ordem: artifacts → jobs → video (FKs), depois a pasta no disco.
  db.delete(artifacts).where(eq(artifacts.videoId, id)).run();
  db.delete(jobs).where(eq(jobs.videoId, id)).run();
  db.delete(brutos).where(eq(brutos.id, id)).run();
  fs.rmSync(videoDir(id), { recursive: true, force: true });
  return NextResponse.json({ ok: true });
}
