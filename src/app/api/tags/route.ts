import { NextResponse } from "next/server";
import {
  lerJsonLimitado,
  LIMITE_CORPO_PEQUENO,
  recusarSeNaoForChamadaDeCliente,
} from "@/lib/endpoint-local";
import { createTag, listTags } from "@/db/queries";

/** GET /api/tags → todas as tags com a contagem de brutos de cada uma. */
export async function GET() {
  return NextResponse.json({ tags: listTags() });
}

/** POST /api/tags { name } → cria a tag, ou reaproveita se já existe por slug. */
export async function POST(req: Request) {
  const recusa = recusarSeNaoForChamadaDeCliente(req);
  if (recusa) return recusa;

  const lido = await lerJsonLimitado(req, LIMITE_CORPO_PEQUENO);
  if (!lido.ok) return lido.resposta;
  const body = lido.dados as { name?: string };

  const name = (body.name ?? "").trim();
  if (!name) {
    return NextResponse.json({ error: "Dê um nome à tag." }, { status: 400 });
  }
  if (name.length > 40) {
    return NextResponse.json({ error: "O nome da tag passa de 40 caracteres." }, { status: 400 });
  }

  return NextResponse.json({ tag: createTag(name) }, { status: 201 });
}
