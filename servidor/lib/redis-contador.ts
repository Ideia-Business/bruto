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

/** Monta o `Contador` sobre o Redis, ou `null` se a env não estiver configurada. */
export function criarContadorRedis(env: NodeJS.ProcessEnv = process.env): Contador | null {
  const conexao = lerConexao(env);
  if (!conexao) return null;

  const redis = new Redis({ url: conexao.url, token: conexao.token });

  return {
    async incr(chave, ttlSeg) {
      const valor = await redis.incr(chave);
      // TTL só quando a chave acaba de nascer (INCR é atômico: só um pedido
      // concorrente vê `1`, então só um dá `expire` — sem corrida dupla).
      if (valor === 1) {
        await redis.expire(chave, ttlSeg);
      }
      return valor;
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
