/**
 * Implementação Redis da interface `Contador` (`servidor/lib/limites.ts`),
 * sobre `@upstash/redis` — cliente REST, funciona em Vercel Functions sem TCP
 * persistente. Único arquivo do território que fala com o Redis de verdade;
 * a decisão de limite em si (`verificarLimite`, `lerCota`) não sabe que este
 * módulo existe, e o teste dela usa um `Contador` em memória.
 *
 * Duas variáveis de ambiente são aceitas para o par URL/token — a integração
 * Upstash da marketplace da Vercel pode injetar qualquer uma das duas
 * convenções (CONTRATO.md, publicação): `UPSTASH_REDIS_REST_URL`/`_TOKEN`
 * (nome canônico do Upstash) ou `KV_REST_API_URL`/`_TOKEN` (nome que a
 * integração "Upstash for Redis" da Vercel também grava). Sem nenhuma das
 * duas, `criarContadorRedis` devolve `null` e o handler responde 503
 * (CONTRATO.md: "servidor sem OLLAMA_API_KEY ou sem Redis configurado").
 */
import { Redis } from "@upstash/redis";
import type { Contador } from "./limites";

function lerConexao(env: NodeJS.ProcessEnv): { url: string; token: string } | null {
  const url = env.UPSTASH_REDIS_REST_URL ?? env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN ?? env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  return { url, token };
}

/** `true` quando há env suficiente para montar o cliente — usada pelos handlers antes de chamar Ollama. */
export function redisConfigurado(env: NodeJS.ProcessEnv = process.env): boolean {
  return lerConexao(env) !== null;
}

function paraNumero(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * `INCR` e o `EXPIRE` condicional (só quando a chave acaba de nascer) num
 * único `EVAL` — atômico no Redis (um script Lua roda até o fim antes de
 * qualquer outro comando ser servido, `https://redis.io/commands/eval`).
 *
 * Achado P2 da revisão do Codex (26/09/2026, 2ª rodada): a versão anterior
 * fazia `INCR` e, se `valor === 1`, um `EXPIRE` SEPARADO. Se o `INCR` desse
 * certo e o `EXPIRE` (uma segunda chamada de rede) falhasse — timeout,
 * conexão caindo no meio —, a exceção subia de dentro de `incr()` ANTES de
 * `verificarLimite` conseguir anotar a chave em `aplicados`; o rollback nunca
 * a via, então nunca a desfazia. Resultado: a pessoa recebia 503 (nenhuma
 * aula), mas o Redis já tinha a chave em 1 — unidade perdida de verdade, e
 * sem TTL nenhum (fica presa até alguém apagar à mão).
 *
 * Por que EVAL e não `redis.multi()` (também suportado pela versão instalada
 * — `node_modules/@upstash/redis/error-DOszGRxg.d.ts`, ambos declarados na
 * classe `Redis`: `multi: () => Pipeline<[]>` documentado como "All the
 * commands in a transaction are serialized and executed sequentially... This
 * guarantees that the commands are executed as a single isolated operation",
 * e `eval: <TArgs, TData>(script, keys, args) => Promise<TData>`): um
 * `MULTI` de `INCR` + `EXPIRE` executaria o `EXPIRE` em TODO incremento, não
 * só no primeiro — renovando o TTL a cada aula e violando o "expiram em 36h"
 * do contrato (a chave passaria a viver 36h a partir do ÚLTIMO pedido do dia,
 * não do primeiro). O `EVAL` abaixo mantém exatamente a condição `if n == 1`
 * que já existia, só que atômica.
 */
const LUA_INCR_COM_TTL_NA_CRIACAO =
  "local n = redis.call('INCR', KEYS[1]) " +
  "if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end " +
  "return n";

/**
 * Fatia mínima do cliente `@upstash/redis` que este módulo usa — separada
 * para que `contadorSobre` seja testável com um duplo em memória, sem falar
 * com Redis de verdade (mesmo padrão de `fetchImpl` em `servidor/lib/ollama.ts`
 * e `deps` em `servidor/api/aula.ts`). Uma instância real de `Redis` satisfaz
 * esta interface por estrutura, sem cast nenhum.
 */
export interface ClienteRedisMinimo {
  eval<TArgs extends unknown[], TData = unknown>(
    script: string,
    keys: string[],
    args: TArgs,
  ): Promise<TData>;
  decr(chave: string): Promise<number>;
  incrby(chave: string, valor: number): Promise<number>;
  get<TData = unknown>(chave: string): Promise<TData | null>;
}

/**
 * Monta o `Contador` a partir de um cliente já pronto (real ou duplo de
 * teste). Separado de `criarContadorRedis` só para isolar a construção do
 * cliente (que exige env) da lógica de tradução Contador↔Redis (que não).
 */
export function contadorSobre(redis: ClienteRedisMinimo): Contador {
  return {
    async incr(chave, ttlSeg) {
      const valor = await redis.eval<[string], number>(
        LUA_INCR_COM_TTL_NA_CRIACAO,
        [chave],
        [String(ttlSeg)],
      );
      return paraNumero(valor);
    },
    async decr(chave) {
      const valor = await redis.decr(chave);
      // O uso é sempre simétrico (um `incr` por chave, no máximo um `decr` de
      // volta), mas a interface promete nunca deixar o contador ir a
      // negativo — corrige o excesso se, por algum motivo externo, acontecer.
      if (valor < 0) {
        await redis.incrby(chave, -valor);
      }
    },
    async get(chave) {
      const valor = await redis.get(chave);
      return valor === null || valor === undefined ? 0 : paraNumero(valor);
    },
  };
}

/** Monta o `Contador` sobre o Redis, ou `null` se a env não estiver configurada. */
export function criarContadorRedis(env: NodeJS.ProcessEnv = process.env): Contador | null {
  const conexao = lerConexao(env);
  if (!conexao) return null;

  const redis = new Redis({ url: conexao.url, token: conexao.token });
  return contadorSobre(redis);
}
