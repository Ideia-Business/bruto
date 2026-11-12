/**
 * POST /api/encerrar — o botão "Encerrar o Bruto" (demanda 43fe2879).
 *
 * Desliga o servidor do PRÓPRIO Bruto e libera a porta. A lógica (decisão
 * 202×409, morte dos filhos, regra do pid, exit) vive injetável em
 * `src/lib/encerrar.ts`; esta rota é casca fina.
 *
 * Segurança — esta é a única rota do app que derruba o processo:
 *   - origem: só `Sec-Fetch-Site: same-origin` (a janela do app) ou `Origin`
 *     exatamente igual à origem do próprio servidor (`http://127.0.0.1:<porta>`
 *     ou `http://localhost:<porta>`). Qualquer outro caso → 403
 *     `{ok:false, code:"origem-recusada"}` — um site aberto num separador não
 *     encerra o Bruto de ninguém;
 *   - corpo JSON obrigatório (`Content-Type: application/json`), o que obriga
 *     preflight em pedido cross-site de navegador.
 *
 * Respostas:
 *   202 {ok:true}                          encerra ~300 ms depois de responder
 *   409 {ok:false, code:"processamento-em-andamento", ativos:n}
 *                                          job running/queued sem {"confirmar":true}
 *
 * O segundo parâmetro (deps parciais) existe para o TESTE — o exit real e o
 * agendamento real nunca rodam em teste; em produção o Next não o passa.
 */
import { NextResponse } from "next/server";
import { lerJsonLimitado, LIMITE_CORPO_PEQUENO, recusarSeNaoForJson } from "@/lib/endpoint-local";
import {
  depsDeEncerramento,
  origemRecusada,
  pedirEncerramento,
  type DepsEncerrar,
} from "@/lib/encerrar";
import { getActiveJobs } from "@/db/queries";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  ctx?: { deps?: Partial<DepsEncerrar> },
): Promise<NextResponse> {
  const porta = portaDoServidor();
  if (
    origemRecusada(
      { origin: req.headers.get("origin"), secFetchSite: req.headers.get("sec-fetch-site") },
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
    ...ctx?.deps,
  });
  const resposta = pedirEncerramento({ confirmar: corpo.confirmar === true }, deps);
  return NextResponse.json(resposta.corpo, { status: resposta.status });
}

/** A porta em que ESTE servidor atende (o lançador exporta `PORT`). */
function portaDoServidor(): number {
  const porta = Number(process.env.PORT ?? 3000);
  return Number.isFinite(porta) && porta > 0 ? porta : 3000;
}
