import { NextResponse } from "next/server";
import {
  lerJsonLimitado,
  LIMITE_CORPO_PEQUENO,
  recusarSeNaoForChamadaDeCliente,
} from "@/lib/endpoint-local";
import { deleteFilao, renameFilao } from "@/db/queries";

/** PATCH /api/filoes/:id { name } → renomeia. O slug não muda (links seguem valendo). */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const recusa = recusarSeNaoForChamadaDeCliente(req);
  if (recusa) return recusa;

  const { id } = await ctx.params;

  const lido = await lerJsonLimitado(req, LIMITE_CORPO_PEQUENO);
  if (!lido.ok) return lido.resposta;
  const body = lido.dados as { name?: string };

  const name = (body.name ?? "").trim();
  if (!name) {
    return NextResponse.json({ error: "Dê um nome ao filão." }, { status: 400 });
  }

  renameFilao(id, name);
  return NextResponse.json({ ok: true });
}

/** DELETE /api/filoes/:id → apaga o filão. Os brutos continuam na biblioteca. */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const recusa = recusarSeNaoForChamadaDeCliente(req);
  if (recusa) return recusa;

  const { id } = await ctx.params;
  deleteFilao(id);
  return NextResponse.json({ ok: true });
}
