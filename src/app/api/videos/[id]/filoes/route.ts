import { NextResponse } from "next/server";
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
  const { id } = await ctx.params;

  let body: { filaoIds?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

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
