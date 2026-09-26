/**
 * Lógica PURA do modo grátis — validação do corpo, chave do dia de Brasília,
 * hash do IP com sal e a decisão de limite. Nada aqui importa Redis nem
 * `node:http`: quem fala com o mundo é `servidor/api/*.ts` e
 * `servidor/lib/redis-contador.ts`. É essa separação que torna a decisão
 * testável sem servidor de verdade e sem rede.
 *
 * Contrato normativo: `servidor/CONTRATO.md`. Não altere aquele arquivo —
 * mudanças de comportamento aqui têm de continuar batendo com ele.
 */
import { createHash } from "node:crypto";

// --- validação do corpo ------------------------------------------------------

export interface CorpoAula {
  instalacao: string;
  titulo: string;
  canal: string | null;
  transcricao: string;
}

export type ResultadoValidacao =
  | { ok: true; dados: CorpoAula }
  | { ok: false; erro: string };

/** UUID v4 — é o formato que a extensão gera em `crypto.randomUUID()`. */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function ehObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Valida o corpo de `POST /api/aula` byte a byte contra a tabela do contrato.
 * Devolve o motivo da recusa em português — vai direto no campo `erro` da
 * resposta 400, então não descreve implementação, só a regra violada.
 */
export function validarCorpoAula(cru: unknown): ResultadoValidacao {
  if (!ehObjeto(cru)) return { ok: false, erro: "Corpo deve ser um objeto JSON." };

  const { instalacao, titulo, canal, transcricao } = cru;

  if (typeof instalacao !== "string" || !UUID_V4.test(instalacao)) {
    return { ok: false, erro: "Campo 'instalacao' deve ser um UUID v4." };
  }
  if (typeof titulo !== "string" || titulo.length < 1 || titulo.length > 300) {
    return { ok: false, erro: "Campo 'titulo' deve ter entre 1 e 300 caracteres." };
  }
  if (canal !== null && typeof canal !== "string") {
    return { ok: false, erro: "Campo 'canal' deve ser string ou null." };
  }
  if (typeof canal === "string" && canal.length > 200) {
    return { ok: false, erro: "Campo 'canal' deve ter no máximo 200 caracteres." };
  }
  if (typeof transcricao !== "string" || transcricao.length < 200 || transcricao.length > 120_000) {
    return { ok: false, erro: "Campo 'transcricao' deve ter entre 200 e 120.000 caracteres." };
  }

  return { ok: true, dados: { instalacao, titulo, canal, transcricao } };
}

// --- dia de Brasília ----------------------------------------------------------

/**
 * Chave do dia em horário de Brasília (UTC−3, sem horário de verão desde
 * 2019 — fixo, não muda no ano). `YYYY-MM-DD`. Subtrai 3 h do relógio UTC e
 * lê os componentes em UTC de novo: evita depender do fuso do processo que
 * roda o código (a Vercel roda em UTC, mas o teste não pode presumir isso).
 */
export function chaveDoDia(agora: Date = new Date()): string {
  const brasilia = new Date(agora.getTime() - 3 * 60 * 60 * 1000);
  const ano = brasilia.getUTCFullYear();
  const mes = String(brasilia.getUTCMonth() + 1).padStart(2, "0");
  const dia = String(brasilia.getUTCDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

// --- hash do IP -----------------------------------------------------------

/** `sha256(ip + sal)` — o IP nunca é gravado como está (CONTRATO.md). */
export function hashIp(ip: string, sal: string): string {
  return createHash("sha256").update(`${ip}${sal}`).digest("hex");
}

// --- chaves do Redis --------------------------------------------------------

export function chaveInstalacao(instalacao: string, dia: string): string {
  return `bruto:gratis:instalacao:${instalacao}:${dia}`;
}

export function chaveRede(ipHash: string, dia: string): string {
  return `bruto:gratis:rede:${ipHash}:${dia}`;
}

export function chaveGeral(dia: string): string {
  return `bruto:gratis:geral:${dia}`;
}

/** 36 h em segundos — TTL das chaves no Redis (CONTRATO.md). */
export const TTL_SEGUNDOS = 36 * 60 * 60;

// --- limites padrão (sobrepostos pelas envs no handler) ---------------------

export const LIMITE_DIARIO_PADRAO = 3;
export const LIMITE_REDE_PADRAO = 6;
export const TETO_GERAL_PADRAO = 150;

export interface Limites {
  diario: number;
  rede: number;
  geral: number;
}

export const LIMITES_PADRAO: Limites = {
  diario: LIMITE_DIARIO_PADRAO,
  rede: LIMITE_REDE_PADRAO,
  geral: TETO_GERAL_PADRAO,
};

// --- o contador (implementado por servidor/lib/redis-contador.ts) -----------

/**
 * A interface mínima que a decisão de limite precisa de um contador. Real é
 * Redis (`INCR` + `EXPIRE`/`DECR`); o teste injeta uma versão em memória —
 * nenhum teste desta lógica fala com rede.
 */
export interface Contador {
  /** Incrementa `chave` em 1 e devolve o novo valor. Define TTL só se a chave nascer agora. */
  incr(chave: string, ttlSeg: number): Promise<number>;
  /** Desfaz um `incr` — "devolve a unidade". Nunca deixa o contador ir a negativo. */
  decr(chave: string): Promise<void>;
  /** Lê o valor atual sem alterar nada. Chave ausente conta como 0. */
  get(chave: string): Promise<number>;
}

export interface ChavesDoPedido {
  instalacao: string;
  rede: string;
  geral: string;
}

export type ResultadoLimite =
  | { ok: true; restantes: number; limite: number; chaves: ChavesDoPedido }
  | { ok: false; motivo: "instalacao" | "rede" | "geral"; restantes: number; limite: number };

/**
 * Desfaz, em ordem INVERSA, só as chaves que de fato chegaram a ser
 * incrementadas — nunca decrementa o que nunca subiu. Cada `decr` é
 * best-effort (`catch` mudo): uma falha ao desfazer não pode mascarar a causa
 * original nem impedir o desfazimento das demais chaves da lista.
 */
async function desfazerIncrementos(contador: Contador, aplicados: readonly string[]): Promise<void> {
  for (let i = aplicados.length - 1; i >= 0; i--) {
    await contador.decr(aplicados[i]).catch(() => {});
  }
}

/**
 * A decisão central do modo grátis. Incrementa as três chaves NESTA ORDEM
 * (instalação → rede → geral) — a mais específica primeiro, porque é o motivo
 * mais informativo para a pessoa (o `429` do contrato tem um único `motivo`).
 * Ao primeiro teto estourado, desfaz os incrementos já feitos (nenhuma unidade
 * fica gasta por um pedido recusado) e devolve o motivo.
 *
 * RESERVA COMPENSADA: se o `Contador` (Redis) LANÇAR no meio da sequência —
 * por exemplo, `incr` da instalação foi bem-sucedido e o `incr` da rede falhou
 * por indisponibilidade — a exceção não pode deixar a unidade da instalação
 * presa sem aula (três falhas destas esgotariam o dia inteiro da pessoa por
 * um problema nosso, não dela). Por isso todo `incr` bem-sucedido é anotado
 * em `aplicados`, e o `catch` desfaz exatamente esses antes de RELANÇAR — quem
 * chama (`servidor/api/aula.ts`) distingue esse caso do 429 normal porque aqui
 * a função lança em vez de devolver `ok: false`, e responde 503 (falha de
 * infraestrutura), nunca 429 (limite — que pressupõe o contador functioning).
 *
 * Alternativa cogitada e descartada: atomicidade real via `EVAL` de Lua no
 * Redis (`servidor/lib/redis-contador.ts`). A reserva compensada foi
 * preferida por ficar inteira aqui, na lógica PURA — testável com um
 * `Contador` fake que lança, sem precisar de um interpretador Lua no duplo de
 * teste nem de depender do suporte a `EVAL` da API REST do Upstash.
 *
 * Quem chama, se o Ollama falhar depois de um `ok: true`, chama
 * `devolverUnidade` com as `chaves` — mesma simetria, unidade sempre devolvida
 * quando a aula não sai.
 */
export async function verificarLimite(
  contador: Contador,
  params: { instalacao: string; ipHash: string; agora?: Date; limites?: Limites },
): Promise<ResultadoLimite> {
  const limites = params.limites ?? LIMITES_PADRAO;
  const dia = chaveDoDia(params.agora ?? new Date());

  const chaves: ChavesDoPedido = {
    instalacao: chaveInstalacao(params.instalacao, dia),
    rede: chaveRede(params.ipHash, dia),
    geral: chaveGeral(dia),
  };

  const aplicados: string[] = [];

  try {
    const valorInstalacao = await contador.incr(chaves.instalacao, TTL_SEGUNDOS);
    aplicados.push(chaves.instalacao);
    if (valorInstalacao > limites.diario) {
      await desfazerIncrementos(contador, aplicados);
      return { ok: false, motivo: "instalacao", restantes: 0, limite: limites.diario };
    }

    const valorRede = await contador.incr(chaves.rede, TTL_SEGUNDOS);
    aplicados.push(chaves.rede);
    if (valorRede > limites.rede) {
      await desfazerIncrementos(contador, aplicados);
      return { ok: false, motivo: "rede", restantes: 0, limite: limites.diario };
    }

    const valorGeral = await contador.incr(chaves.geral, TTL_SEGUNDOS);
    aplicados.push(chaves.geral);
    if (valorGeral > limites.geral) {
      await desfazerIncrementos(contador, aplicados);
      return { ok: false, motivo: "geral", restantes: 0, limite: limites.diario };
    }

    return {
      ok: true,
      restantes: Math.max(0, limites.diario - valorInstalacao),
      limite: limites.diario,
      chaves,
    };
  } catch (err) {
    // O Contador quebrou no meio da reserva — não é teto estourado. Desfaz o
    // que já tiver aplicado e relança: `tratarAula` decide 503, não 429.
    await desfazerIncrementos(contador, aplicados);
    throw err;
  }
}

/**
 * Devolve as três unidades — usado quando o Ollama falha depois do limite ter
 * passado. Cada `decr` é independente (mesmo `catch` mudo de
 * `desfazerIncrementos`): a falha ao devolver UMA chave não pode impedir a
 * devolução das outras duas.
 */
export async function devolverUnidade(contador: Contador, chaves: ChavesDoPedido): Promise<void> {
  await desfazerIncrementos(contador, [chaves.instalacao, chaves.rede, chaves.geral]);
}

/** O que `GET /api/cota` usa: só lê, nunca incrementa. */
export async function lerCota(
  contador: Contador,
  params: { instalacao: string; agora?: Date; limiteDiario?: number },
): Promise<{ restantes: number; limite: number }> {
  const limite = params.limiteDiario ?? LIMITE_DIARIO_PADRAO;
  const dia = chaveDoDia(params.agora ?? new Date());
  const valor = await contador.get(chaveInstalacao(params.instalacao, dia));
  return { restantes: Math.max(0, limite - valor), limite };
}
