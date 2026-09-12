import { NextResponse } from "next/server";
import { recusarSeNaoForChamadaDeCliente } from "@/lib/endpoint-local";
import { createFilao, listFiloes } from "@/db/queries";

/** GET /api/filoes → todos os filões com a contagem de brutos de cada um. */
export async function GET() {
  return NextResponse.json({ filoes: listFiloes() });
}

/** POST /api/filoes { name } → cria um filão. */
export async function POST(req: Request) {
  const recusa = recusarSeNaoForChamadaDeCliente(req);
  if (recusa) return recusa;

  let body: { name?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const name = (body.name ?? "").trim();
  if (!name) {
    return NextResponse.json({ error: "Dê um nome ao filão." }, { status: 400 });
  }
  if (name.length > 80) {
    return NextResponse.json(
      { error: "O nome do filão passa de 80 caracteres." },
      { status: 400 },
    );
  }

  return NextResponse.json({ filao: createFilao(name) }, { status: 201 });
}
