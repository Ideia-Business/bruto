/**
 * GET /api/llm/saude — o que a extensão pergunta antes de oferecer o botão.
 *
 * Devolve todos os provedores com `plano` (autentica pela assinatura já paga,
 * sem chave de API) e `disponivel` (medido de verdade nesta máquina). Quando
 * indisponível, vem `motivo` — é o texto que a extensão mostra à pessoa, e é o
 * que diz se ela precisa INSTALAR algo ou só FAZER LOGIN.
 *
 * **Sem CORS, de propósito** — a explicação inteira está em
 * `src/lib/endpoint-local.ts`. Não acrescente cabeçalho de origem aqui.
 *
 * Cache curto porque `availability()` de um provedor de CLI é um subprocesso
 * (`codex login status`, `claude --version`): responder rápido importa, e o
 * estado de instalação não muda de segundo em segundo. As medições correm em
 * paralelo — em série, cada provedor somaria o seu spawn ao tempo de resposta.
 */
import { NextResponse } from "next/server";
import { listarProvedores } from "@/pipeline/lib/llm";
import { recusarSeNaoForLocal } from "@/lib/endpoint-local";

export const dynamic = "force-dynamic";

interface ProvedorNaSaude {
  id: string;
  label: string;
  plano: boolean;
  disponivel: boolean;
  motivo?: string;
}

const CACHE_MS = 15_000;
let cache: { em: number; provedores: ProvedorNaSaude[] } | null = null;

async function medir(): Promise<ProvedorNaSaude[]> {
  const agora = Date.now();
  if (cache && agora - cache.em < CACHE_MS) return cache.provedores;

  const provedores = await Promise.all(
    listarProvedores().map(async (p): Promise<ProvedorNaSaude> => {
      const d = await p.availability();
      return {
        id: p.id,
        label: p.label,
        plano: p.envVar === null,
        disponivel: d.ok,
        ...(d.ok ? {} : { motivo: d.reason }),
      };
    }),
  );

  cache = { em: agora, provedores };
  return provedores;
}

export async function GET(req: Request) {
  const recusa = recusarSeNaoForLocal(req);
  if (recusa) return recusa;

  return NextResponse.json({ ok: true, provedores: await medir() });
}
