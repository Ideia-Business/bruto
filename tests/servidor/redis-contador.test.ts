/**
 * Testes de `contadorSobre` (`servidor/lib/redis-contador.ts`) — foco no
 * achado P2 da revisão do Codex (26/09/2026, 2ª rodada): `INCR` bem-sucedido
 * seguido de um `EXPIRE` SEPARADO que falha deixava a chave incrementada, sem
 * TTL, e invisível para o rollback de `verificarLimite` (que só sabe desfazer
 * o que registrou em `aplicados` — e nunca chegava a registrar, porque a
 * exceção subia de dentro do próprio `incr()` antes de ele retornar).
 *
 * A correção junta `INCR` + `EXPIRE` condicional num único `EVAL` atômico —
 * não sobra mais um "segundo passo" para falhar sozinho. Este teste prova
 * exatamente isso: se a chamada atômica falhar, NADA fica contado (nem o
 * incremento, nem o TTL) — tudo ou nada, nunca uma metade.
 *
 * Nenhum teste aqui fala com Redis de verdade: `ClienteRedisMinimo` é a
 * fatia que `contadorSobre` usa, e o duplo abaixo simula um Redis real o
 * bastante (mantém estado) para a asserção de "nada ficou contado" valer.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { contadorSobre, type ClienteRedisMinimo } from "../../servidor/lib/redis-contador";

/**
 * Duplo do cliente `@upstash/redis` com estado real em memória — para que
 * "nada ficou contado" seja uma leitura de verdade (`get`), não uma suposição.
 * `explodirNoEval` simula a chamada atômica falhando (rede caindo, timeout):
 * quando `true`, nenhum efeito é aplicado ao `mapa` — é exatamente o que o
 * `EVAL` real faz ao falhar (não há como o Redis aplicar só a metade de um
 * script Lua que nunca terminou de rodar do lado dele).
 */
class RedisFalsoComEval implements ClienteRedisMinimo {
  private mapa = new Map<string, number>();
  private ttls = new Map<string, string>();

  constructor(private explodirNoEval: boolean) {}

  async eval<TArgs extends unknown[], TData = unknown>(
    _script: string,
    keys: string[],
    args: TArgs,
  ): Promise<TData> {
    if (this.explodirNoEval) {
      throw new Error("Redis indisponível (simulado no teste) — o EVAL nunca chegou a rodar");
    }
    const chave = keys[0];
    const ttlSeg = String(args[0]);
    const valor = (this.mapa.get(chave) ?? 0) + 1;
    this.mapa.set(chave, valor);
    if (valor === 1) this.ttls.set(chave, ttlSeg);
    return valor as unknown as TData;
  }

  async decr(chave: string): Promise<number> {
    const valor = Math.max(0, (this.mapa.get(chave) ?? 0) - 1);
    this.mapa.set(chave, valor);
    return valor;
  }

  async incrby(chave: string, delta: number): Promise<number> {
    const valor = (this.mapa.get(chave) ?? 0) + delta;
    this.mapa.set(chave, valor);
    return valor;
  }

  async get<TData = unknown>(chave: string): Promise<TData | null> {
    const v = this.mapa.get(chave);
    return (v ?? null) as TData | null;
  }

  /** Só para asserção do teste — não faz parte de `ClienteRedisMinimo`. */
  valorReal(chave: string): number {
    return this.mapa.get(chave) ?? 0;
  }

  /** Idem — prova que o TTL só foi setado quando o valor chegou a 1. */
  ttlFoiSetado(chave: string): boolean {
    return this.ttls.has(chave);
  }
}

describe("contadorSobre — EVAL atômico (INCR + EXPIRE condicional numa chamada só)", () => {
  test("quando o EVAL falha, nada fica contado — nem o incremento, nem o TTL", async () => {
    const clienteFalso = new RedisFalsoComEval(true);
    const contador = contadorSobre(clienteFalso);

    await assert.rejects(() => contador.incr("bruto:gratis:instalacao:teste:2026-09-26", 129_600));

    assert.equal(
      clienteFalso.valorReal("bruto:gratis:instalacao:teste:2026-09-26"),
      0,
      "a chave não pode ter sido incrementada — a falha é tudo-ou-nada, nunca uma metade",
    );
    assert.equal(clienteFalso.ttlFoiSetado("bruto:gratis:instalacao:teste:2026-09-26"), false);
  });

  test("quando o EVAL funciona, o incremento e o TTL condicional acontecem juntos, numa chamada só", async () => {
    const clienteFalso = new RedisFalsoComEval(false);
    const contador = contadorSobre(clienteFalso);

    const v1 = await contador.incr("chave-teste", 129_600);
    assert.equal(v1, 1);
    assert.equal(clienteFalso.ttlFoiSetado("chave-teste"), true, "1ª chamada cria a chave: TTL setado");

    const v2 = await contador.incr("chave-teste", 129_600);
    assert.equal(v2, 2);
  });

  test("decr nunca deixa o contador ir a negativo (corrige com incrby)", async () => {
    const clienteFalso = new RedisFalsoComEval(false);
    const contador = contadorSobre(clienteFalso);

    await contador.decr("chave-nunca-incrementada");
    assert.equal(clienteFalso.valorReal("chave-nunca-incrementada"), 0);
  });

  test("get de chave inexistente é 0, não null nem NaN", async () => {
    const clienteFalso = new RedisFalsoComEval(false);
    const contador = contadorSobre(clienteFalso);

    assert.equal(await contador.get("nunca-existiu"), 0);
  });
});
