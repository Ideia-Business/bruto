/**
 * POST /api/aula — a rota que gera uma aula grátis. Contrato normativo:
 * `servidor/CONTRATO.md`. Handler no formato Web API de Vercel Functions
 * (Node.js runtime; `maxDuration` vem de `servidor/vercel.json`).
 *
 * A REGRA QUE NÃO SE NEGOCIA: a chave do Ollama nunca sai do servidor, nunca
 * vai para log, nem para uma mensagem de erro. O que este arquivo faz é só
 * orquestrar: validar → checar limite → chamar Ollama → devolver ou desfazer.
 * Nenhuma das partes de negócio mora aqui — `servidor/lib/*` é quem decide.
 *
 * `tratarAula` recebe as dependências (contador, chave, `fetch`) por
 * parâmetro — mesmo padrão de `fetchImpl` de `servidor/lib/ollama.ts` — para
 * que `tests/servidor/aula.test.ts` exercite o handler inteiro (CORS, 415,
 * 503, 429, 502, 200) sem falar com Redis nem com o Ollama de verdade. `POST`
 * é só o fio que liga isso às envs reais em produção.
 */
import {
  validarCorpoAula,
  verificarLimite,
  devolverUnidade,
  hashIp,
  LIMITES_PADRAO,
  type Limites,
  type Contador,
  type ResultadoLimite,
} from "../lib/limites";
import { chamarOllama, MODELO_PADRAO } from "../lib/ollama";
import { lerCorpoComTeto } from "../lib/corpo";
import { respostaPreflight } from "../lib/cors";
import { erroJson, respostaJson } from "../lib/resposta";
import { criarContadorRedis } from "../lib/redis-contador";

/** Contrato: "no máximo 200 KB" para o corpo de `POST /api/aula`. */
const LIMITE_CORPO_BYTES = 200_000;

export interface DependenciasAula {
  /** `null` quando a env de Redis não está configurada — vira 503. */
  contador: Contador | null;
  /** `undefined` quando `OLLAMA_API_KEY` não está configurada — vira 503. */
  chaveOllama: string | undefined;
  sal: string;
  modelo: string;
  limites: Limites;
  fetchImpl?: typeof fetch;
  /** Prazo do `chamarOllama` — só usado por teste; em produção é o padrão do contrato (170 s). */
  timeoutMsOllama?: number;
}

function clienteEhExtensao(req: Request): boolean {
  return req.headers.get("x-bruto-cliente") === "extensao";
}

function contentTypeEhJson(req: Request): boolean {
  const tipo = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  return tipo === "application/json";
}

function primeiroIp(cabecalho: string | null): string | null {
  if (!cabecalho) return null;
  const primeiro = cabecalho.split(",")[0]?.trim();
  return primeiro || null;
}

/** IP do cliente, na forma como a Vercel o expõe — nunca gravado como está (só o hash). */
function ipDoPedido(req: Request): string {
  return (
    primeiroIp(req.headers.get("x-forwarded-for")) ??
    req.headers.get("x-real-ip") ??
    "desconhecido"
  );
}

export function limitesDaEnv(env: NodeJS.ProcessEnv): Limites {
  const numero = (v: string | undefined, padrao: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : padrao;
  };
  return {
    diario: numero(env.BRUTO_LIMITE_DIARIO, LIMITES_PADRAO.diario),
    rede: numero(env.BRUTO_LIMITE_REDE, LIMITES_PADRAO.rede),
    geral: numero(env.BRUTO_TETO_GERAL, LIMITES_PADRAO.geral),
  };
}

/** O handler de verdade — testável por injeção de `deps`. */
export async function tratarAula(req: Request, deps: DependenciasAula): Promise<Response> {
  const origem = req.headers.get("origin");

  // 1) cliente conhecido + tipo — mesma doutrina do app local
  // (src/lib/endpoint-local.ts): um cabeçalho fora da lista segura obriga
  // preflight, e é isso que barra uma página comum antes de qualquer efeito.
  if (!contentTypeEhJson(req) || !clienteEhExtensao(req)) {
    return erroJson(
      415,
      "Content-Type deve ser application/json e X-Bruto-Cliente deve ser 'extensao'.",
      origem,
    );
  }

  // 2) configuração do servidor — sem chave ou sem Redis, nada mais roda.
  if (!deps.chaveOllama || !deps.contador) {
    return erroJson(503, "Servidor do modo grátis não está configurado.", origem);
  }
  const contador = deps.contador;

  // 3) tamanho e forma do corpo
  const lido = await lerCorpoComTeto(req, LIMITE_CORPO_BYTES);
  if (!lido.ok) {
    if (lido.motivo === "grande_demais") {
      return erroJson(413, "Corpo grande demais (máximo 200 KB).", origem);
    }
    return erroJson(400, "Falha ao ler o corpo da requisição.", origem);
  }

  let dados: unknown;
  try {
    dados = lido.texto === "" ? {} : JSON.parse(lido.texto);
  } catch {
    return erroJson(400, "JSON inválido.", origem);
  }

  const validado = validarCorpoAula(dados);
  if (!validado.ok) {
    return erroJson(400, validado.erro, origem);
  }
  const { instalacao, titulo, canal, transcricao } = validado.dados;

  // 4) limite — incrementa ANTES de chamar o Ollama (evita corrida); se
  // estourar, `verificarLimite` já desfez os incrementos parciais. Se o
  // CONTADOR (Redis) falhar no meio da reserva, `verificarLimite` também já
  // desfez o que tinha aplicado e relança — aqui isso vira 503, nunca 429:
  // o pedido não foi recusado por limite, foi a infraestrutura que quebrou.
  const ipHash = hashIp(ipDoPedido(req), deps.sal);
  let decisao: ResultadoLimite;
  try {
    decisao = await verificarLimite(contador, { instalacao, ipHash, limites: deps.limites });
  } catch {
    return erroJson(503, "Não foi possível verificar o limite agora.", origem);
  }

  if (!decisao.ok) {
    return erroJson(429, "Limite de aulas grátis atingido.", origem, {
      motivo: decisao.motivo,
      restantes: decisao.restantes,
      limite: decisao.limite,
    });
  }

  // 5) o Ollama. Se falhar, devolve a unidade — a pessoa não gastou cota por
  // um erro nosso.
  const resultado = await chamarOllama({
    meta: { title: titulo, channel: canal },
    transcricao,
    apiKey: deps.chaveOllama,
    modelo: deps.modelo,
    fetchImpl: deps.fetchImpl,
    timeoutMs: deps.timeoutMsOllama,
  });

  if (!resultado.ok) {
    await devolverUnidade(contador, decisao.chaves);
    return erroJson(502, "Não foi possível gerar a aula agora.", origem);
  }

  return respostaJson(
    200,
    { aula: resultado.aula, restantes: decisao.restantes, limite: decisao.limite },
    origem,
  );
}

export async function OPTIONS(req: Request): Promise<Response> {
  return respostaPreflight(req);
}

export async function POST(req: Request): Promise<Response> {
  return tratarAula(req, {
    contador: criarContadorRedis(process.env),
    chaveOllama: process.env.OLLAMA_API_KEY,
    sal: process.env.BRUTO_SAL ?? "",
    modelo: process.env.BRUTO_MODELO ?? MODELO_PADRAO,
    limites: limitesDaEnv(process.env),
  });
}
