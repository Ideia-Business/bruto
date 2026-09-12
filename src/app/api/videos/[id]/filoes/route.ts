import { NextResponse } from "next/server";
import {
  lerJsonLimitado,
  LIMITE_CORPO_PEQUENO,
  recusarSeNaoForChamadaDeCliente,
} from "@/lib/endpoint-local";
import { getFiloesForBruto, setFiloesForBruto } from "@/db/queries";

/** GET /api/videos/:id/filoes → ids dos filões em que este bruto está. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return NextResponse.json({ filaoIds: getFiloesForBruto(id) });
}

/**
 * PUT /api/videos/:id/filoes { filaoIds }
 * Define o conjunto inteiro de uma vez — o seletor manda o estado final, não
 * um delta. Idempotente: reenviar o mesmo conjunto não muda nada.
 */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const recusa = recusarSeNaoForChamadaDeCliente(req);
  if (recusa) return recusa;

  const { id } = await ctx.params;

  const lido = await lerJsonLimitado(req, LIMITE_CORPO_PEQUENO);
  if (!lido.ok) return lido.resposta;
  const body = lido.dados as { filaoIds?: unknown };

  const raw = body.filaoIds;
  if (!Array.isArray(raw) || raw.some((v) => typeof v !== "string")) {
    return NextResponse.json(
      { error: "filaoIds deve ser uma lista de ids." },
      { status: 400 },
    );
  }

  setFiloesForBruto(id, raw as string[]);
  return NextResponse.json({ filaoIds: getFiloesForBruto(id) });
}
