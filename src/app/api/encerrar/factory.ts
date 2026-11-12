/**
 * A casca do `POST /api/encerrar` como FÁBRICA — o "porquê" do arquivo:
 *
 * A injeção de dependências existia direto na assinatura exportada
 * (`POST(req, ctx?: { deps?: … })`) e o `next build` recusava: o contrato de
 * rota do Next só aceita `{ params: Promise<…> }` como segundo parâmetro
 * (TS2344 em `.next/types/validator.ts`) — e o `tsc --noEmit`/testes não
 * pegavam porque não incluem os tipos GERADOS pelo Next. Sem build, não há
 * `.dmg`. A fábrica mora num módulo que não é `route.ts`, onde assinatura
 * nenhuma precisa agradar o validador de rotas; o `route.ts` só faz
 * `export const POST = criarPostEncerrar()`, e o TESTE injeta as deps
 * perigosas (agendar/exit) pela fábrica — mesmo poder, zero contrato quebrado.
 *
 * A lógica (decisão 202×409, morte dos filhos, regra do pid, exit) continua
 * injetável em `src/lib/encerrar.ts`.
 */
import { NextResponse } from "next/server";
import {
  lerJsonLimitado,
  LIMITE_CORPO_PEQUENO,
  recusarSeNaoForJson,
  recusarSeNaoForLocal,
} from "@/lib/endpoint-local";
import {
  depsDeEncerramento,
  origemRecusada,
  pedirEncerramento,
  type DepsEncerrar,
} from "@/lib/encerrar";
import { getActiveJobs } from "@/db/queries";

/**
 * Cria o handler do POST. Em produção, sem argumento; o TESTE injeta as deps
 * perigosas — o exit real e o agendamento real nunca rodam em teste.
 */
export function criarPostEncerrar(depsParciais?: Partial<DepsEncerrar>) {
  return async function POST(req: Request): Promise<NextResponse> {
    // Antes de QUALQUER outra decisão: só atende Host de loopback — a mesma
    // trava das rotas `/api/llm*`. Barra o IP da máquina na rede local (o
    // vizinho de wifi) e o DNS rebinding (domínio de fora que resolve para
    // 127.0.0.1 e chega como "same-origin" com o Host do atacante).
    const recusaLocal = recusarSeNaoForLocal(req);
    if (recusaLocal) return recusaLocal;

    const porta = portaDoServidor();
    if (
      origemRecusada(
        {
          origin: req.headers.get("origin"),
          secFetchSite: req.headers.get("sec-fetch-site"),
          host: req.headers.get("host"),
        },
        porta,
      )
    ) {
      return NextResponse.json({ ok: false, code: "origem-recusada" } as const, { status: 403 });
    }

    const recusaJson = recusarSeNaoForJson(req);
    if (recusaJson) return recusaJson;

    const lido = await lerJsonLimitado(req, LIMITE_CORPO_PEQUENO);
    if (!lido.ok) return lido.resposta;
    const corpo = (lido.dados ?? {}) as { confirmar?: unknown };

    const deps = depsDeEncerramento({
      contarJobsAtivos: () => getActiveJobs().length,
      ...depsParciais,
    });
    const resposta = pedirEncerramento({ confirmar: corpo.confirmar === true }, deps);
    return NextResponse.json(resposta.corpo, { status: resposta.status });
  };
}

/** A porta em que ESTE servidor atende (o lançador exporta `PORT`). */
function portaDoServidor(): number {
  const porta = Number(process.env.PORT ?? 3000);
  return Number.isFinite(porta) && porta > 0 ? porta : 3000;
}
