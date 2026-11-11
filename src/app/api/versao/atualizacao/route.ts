/**
 * GET /api/versao/atualizacao → { "nova": "1.2.3" | null, "url": "…" | null }
 *
 * O que o aviso de versão nova (header) lê. Só tem conteúdo em modo pacote;
 * em modo clone é sempre silêncio. Leitura pública local — a consulta à rede
 * acontece no SERVIDOR, no máximo uma vez por dia (ver
 * `pipeline/lib/atualizacao.ts`).
 */
import { NextResponse } from "next/server";
import { verificarAtualizacao } from "@/pipeline/lib/atualizacao";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(await verificarAtualizacao());
}
