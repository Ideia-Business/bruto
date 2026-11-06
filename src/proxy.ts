import { NextResponse, type NextRequest } from "next/server";
import { hostEhLoopback } from "@/lib/endpoint-local";

/**
 * Porta única de `/api/*`: só atende pedido cujo Host é a própria máquina.
 *
 * Por que aqui e não em cada rota: `recusarSeNaoForLocal` já protegia as rotas
 * de mutação, mas os GETs (índice de vídeos concluídos, detalhe com as
 * transcrições, tags, artefatos) ficavam abertos a DNS rebinding — um site
 * malicioso aponta o próprio domínio para 127.0.0.1, o navegador o trata como
 * mesma origem e lê a biblioteca inteira, sem escrever nada. Rota que alguém
 * esquecer de proteger agora cai nesta checagem de qualquer jeito (achado de
 * segurança de 05/11/2026).
 *
 * Não depende de cabeçalho de origem: o Host é o que o atacante não controla
 * quando o pedido vem de uma página no navegador.
 */
export function proxy(req: NextRequest) {
  if (hostEhLoopback(req.headers.get("host"))) return NextResponse.next();
  return NextResponse.json({ error: "Este endpoint só atende a máquina local." }, { status: 403 });
}

export const config = {
  matcher: "/api/:path*",
};
