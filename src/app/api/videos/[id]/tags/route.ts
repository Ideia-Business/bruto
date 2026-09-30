import { NextResponse } from "next/server";
import {
  lerJsonLimitado,
  LIMITE_CORPO_PEQUENO,
  recusarSeNaoForChamadaDeCliente,
} from "@/lib/endpoint-local";
import { getTagIdsForBruto, setTagIdsForBruto } from "@/db/queries";

/** GET /api/videos/:id/tags → ids das tags deste bruto. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return NextResponse.json({ tagIds: getTagIdsForBruto(id) });
}

/**
 * PUT /api/videos/:id/tags { tagIds }
 * Define o conjunto inteiro de uma vez — mesmo contrato de /api/videos/:id/filoes.
 */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const recusa = recusarSeNaoForChamadaDeCliente(req);
  if (recusa) return recusa;

  const { id } = await ctx.params;

  const lido = await lerJsonLimitado(req, LIMITE_CORPO_PEQUENO);
  if (!lido.ok) return lido.resposta;
  const body = lido.dados as { tagIds?: unknown };

  const raw = body.tagIds;
  if (!Array.isArray(raw) || raw.some((v) => typeof v !== "string")) {
    return NextResponse.json({ error: "tagIds deve ser uma lista de ids." }, { status: 400 });
  }

  setTagIdsForBruto(id, raw as string[]);
  return NextResponse.json({ tagIds: getTagIdsForBruto(id) });
}
