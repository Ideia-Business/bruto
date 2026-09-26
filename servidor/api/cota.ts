/**
 * GET /api/cota?instalacao=<uuid> — só lê, nunca consome. Contrato normativo:
 * `servidor/CONTRATO.md`. Mesmo padrão de injeção de dependências de
 * `servidor/api/aula.ts`: `tratarCota` é testável sem Redis de verdade.
 */
import { lerCota, LIMITES_PADRAO, type Contador } from "../lib/limites";
import { respostaPreflight } from "../lib/cors";
import { erroJson, respostaJson } from "../lib/resposta";
import { criarContadorRedis } from "../lib/redis-contador";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface DependenciasCota {
  contador: Contador | null;
  limiteDiario: number;
}

export async function tratarCota(req: Request, deps: DependenciasCota): Promise<Response> {
  const origem = req.headers.get("origin");

  if (req.headers.get("x-bruto-cliente") !== "extensao") {
    return erroJson(415, "Cabeçalho X-Bruto-Cliente ausente ou desconhecido.", origem);
  }

  if (!deps.contador) {
    return erroJson(503, "Servidor do modo grátis não está configurado.", origem);
  }

  const instalacao = new URL(req.url).searchParams.get("instalacao");
  if (!instalacao || !UUID_V4.test(instalacao)) {
    return erroJson(400, "Parâmetro 'instalacao' deve ser um UUID v4.", origem);
  }

  const cota = await lerCota(deps.contador, { instalacao, limiteDiario: deps.limiteDiario });
  return respostaJson(200, cota, origem);
}

export async function OPTIONS(req: Request): Promise<Response> {
  return respostaPreflight(req);
}

export async function GET(req: Request): Promise<Response> {
  const limiteDiario = Number(process.env.BRUTO_LIMITE_DIARIO);
  return tratarCota(req, {
    contador: criarContadorRedis(process.env),
    limiteDiario: Number.isFinite(limiteDiario) && limiteDiario > 0 ? limiteDiario : LIMITES_PADRAO.diario,
  });
}
