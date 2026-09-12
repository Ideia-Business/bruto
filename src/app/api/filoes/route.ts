import { NextResponse } from "next/server";
import {
  lerJsonLimitado,
  LIMITE_CORPO_PEQUENO,
  recusarSeNaoForChamadaDeCliente,
} from "@/lib/endpoint-local";
import { createFilao, listFiloes } from "@/db/queries";

/** GET /api/filoes → todos os filões com a contagem de brutos de cada um. */
export async function GET() {
  return NextResponse.json({ filoes: listFiloes() });
}

/** POST /api/filoes { name } → cria um filão. */
export async function POST(req: Request) {
  const recusa = recusarSeNaoForChamadaDeCliente(req);
  if (recusa) return recusa;

  const lido = await lerJsonLimitado(req, LIMITE_CORPO_PEQUENO);
  if (!lido.ok) return lido.resposta;
  const body = lido.dados as { name?: string };

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
