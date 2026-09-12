/**
 * POST /api/llm — a porta pela qual a extensão usa os provedores de PLANO.
 *
 * Por que existe: uma extensão MV3 não executa binário, então ela jamais
 * alcançaria sozinha o `claude` ou o `codex` instalados na máquina — e são eles
 * que consomem a assinatura que a pessoa já paga, em vez de exigir chave de API
 * cobrada por token. O app tem o processo; a extensão tem a tela. Esta rota é a
 * costura entre os dois.
 *
 * **Sem CORS, de propósito.** A explicação está por extenso em
 * `src/lib/endpoint-local.ts` e resume-se a isto: este endpoint gasta o dinheiro
 * da pessoa, e a ausência de cabeçalho de origem é o que impede que qualquer
 * página aberta no navegador dela o chame. Não há handler de `OPTIONS` pelo
 * mesmo motivo. Não acrescente nenhum dos dois.
 *
 * A outra regra que o desenho carrega: **nunca cair num provedor por chave.**
 * Sem provedor de plano disponível, a resposta é 503 — não uma geração que a
 * pessoa não pediu, paga por token, com uma chave que nem é dela.
 */
import { NextResponse } from "next/server";
import { PipelineError } from "@/pipeline/types";
import { provedorPorId, provedoresDePlano, runLLMComProvedor } from "@/pipeline/lib/llm";
import type { LlmProvider, LlmRequest } from "@/pipeline/lib/llm";
import {
  lerCorpoLimitado,
  recusarSeNaoForChamadaDeCliente,
  recusarSeNaoForJson,
} from "@/lib/endpoint-local";

export const dynamic = "force-dynamic";

const TAREFAS = [
  "study",
  "summary",
  "mindmap",
  "category",
  "translate",
  "references",
] as const;
const TIERS = ["fast", "balanced"] as const;

type Tarefa = (typeof TAREFAS)[number];
type Tier = (typeof TIERS)[number];

interface CorpoValido {
  task: Tarefa;
  prompt: string;
  input?: string;
  tier?: Tier;
  provedor?: string;
}

/** Valida o corpo inteiro antes de gastar um token. Devolve o erro em texto. */
function validar(bruto: unknown): { ok: true; corpo: CorpoValido } | { ok: false; erro: string } {
  if (typeof bruto !== "object" || bruto === null) return { ok: false, erro: "corpo não é objeto" };
  const c = bruto as Record<string, unknown>;

  if (typeof c.task !== "string" || !TAREFAS.includes(c.task as Tarefa)) {
    return { ok: false, erro: `task inválida (use: ${TAREFAS.join(", ")})` };
  }
  if (typeof c.prompt !== "string" || c.prompt.trim() === "") {
    return { ok: false, erro: "prompt ausente ou vazio" };
  }
  if (c.input !== undefined && typeof c.input !== "string") {
    return { ok: false, erro: "input, quando presente, tem de ser texto" };
  }
  if (c.tier !== undefined && (typeof c.tier !== "string" || !TIERS.includes(c.tier as Tier))) {
    return { ok: false, erro: `tier inválido (use: ${TIERS.join(", ")})` };
  }
  if (c.provedor !== undefined && typeof c.provedor !== "string") {
    return { ok: false, erro: "provedor, quando presente, tem de ser texto" };
  }

  return {
    ok: true,
    corpo: {
      task: c.task as Tarefa,
      prompt: c.prompt,
      input: c.input as string | undefined,
      tier: c.tier as Tier | undefined,
      provedor: c.provedor as string | undefined,
    },
  };
}

/** O primeiro provedor de plano que responde disponível, ou null. */
async function melhorDePlano(): Promise<LlmProvider | null> {
  for (const p of provedoresDePlano()) {
    if ((await p.availability()).ok) return p;
  }
  return null;
}

export async function POST(req: Request) {
  // A MESMA guarda das outras rotas com efeito. Esta era a única exceção, e a
  // exceção era justamente a rota que gasta o dinheiro. O `application/json`
  // abaixo já força preflight, então o risco concreto era menor — mas regra
  // aplicada em todo lugar menos num é a forma como a classe fica aberta, e foi
  // essa a lição desta sessão inteira.
  const recusa = recusarSeNaoForChamadaDeCliente(req) ?? recusarSeNaoForJson(req);
  if (recusa) return recusa;

  const corpoLido = await lerCorpoLimitado(req);
  if (!corpoLido.ok) return corpoLido.resposta;

  let bruto: unknown;
  try {
    bruto = JSON.parse(corpoLido.texto);
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const v = validar(bruto);
  if (!v.ok) return NextResponse.json({ error: v.erro }, { status: 400 });
  const { task, prompt, input, tier, provedor: pedido } = v.corpo;

  let provedor: LlmProvider | null;
  if (pedido) {
    provedor = provedorPorId(pedido);
    if (!provedor) {
      return NextResponse.json({ error: `provedor "${pedido}" não existe` }, { status: 400 });
    }
    // Pedir explicitamente um provedor POR CHAVE é recusado, não atendido: esta
    // porta existe para gastar o plano, e a chave configurada na máquina não é
    // necessariamente de quem está do outro lado da extensão.
    if (provedor.envVar !== null) {
      return NextResponse.json(
        { error: `"${pedido}" usa chave de API; esta rota só atende provedores de plano` },
        { status: 400 },
      );
    }
    const d = await provedor.availability();
    if (!d.ok) {
      return NextResponse.json({ error: `"${pedido}" indisponível: ${d.reason}` }, { status: 503 });
    }
  } else {
    provedor = await melhorDePlano();
    if (!provedor) {
      return NextResponse.json(
        {
          error:
            "Nenhum provedor de plano disponível. Instale e autentique o Claude Code (`claude`) ou o Codex CLI (`codex login`).",
        },
        { status: 503 },
      );
    }
  }

  const pedidoLlm: LlmRequest = { task, prompt, input, tier: tier ?? "balanced" };

  try {
    const r = await runLLMComProvedor(provedor, pedidoLlm);
    return NextResponse.json({ text: r.text, provider: r.provider, model: r.model });
  } catch (err) {
    // `runLLMComProvedor` já redige a mensagem antes de classificar; o que sai
    // daqui é texto de diagnóstico, nunca credencial.
    const msg = err instanceof PipelineError ? err.message : "falha ao chamar o modelo";
    return NextResponse.json({ error: msg }, { status: 503 });
  }
}
