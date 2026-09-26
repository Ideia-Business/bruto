/**
 * Testes da lógica PURA do modo grátis (`servidor/lib/limites.ts`). Nenhum
 * teste aqui fala com Redis nem com rede — o `Contador` é uma versão em
 * memória, e é isso que torna a decisão de limite verificável sem servidor de
 * verdade. Contrato normativo: `servidor/CONTRATO.md`.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  validarCorpoAula,
  chaveDoDia,
  hashIp,
  verificarLimite,
  devolverUnidade,
  lerCota,
  type Contador,
} from "../../servidor/lib/limites";

// --- o duplo do contador -----------------------------------------------------

/** Contador em memória — o mesmo contrato do Redis, sem rede. */
class ContadorFake implements Contador {
  mapa = new Map<string, number>();

  async incr(chave: string): Promise<number> {
    const atual = (this.mapa.get(chave) ?? 0) + 1;
    this.mapa.set(chave, atual);
    return atual;
  }

  async decr(chave: string): Promise<void> {
    const atual = Math.max(0, (this.mapa.get(chave) ?? 0) - 1);
    this.mapa.set(chave, atual);
  }

  async get(chave: string): Promise<number> {
    return this.mapa.get(chave) ?? 0;
  }
}

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";
const UUID_C = "33333333-3333-4333-8333-333333333333";

function transcricao(tamanho: number): string {
  return "a".repeat(tamanho);
}

// --- validação do corpo ------------------------------------------------------

describe("validarCorpoAula", () => {
  const corpoBase = {
    instalacao: UUID_A,
    titulo: "Título válido",
    canal: "Canal X",
    transcricao: transcricao(300),
  };

  test("corpo válido passa", () => {
    const r = validarCorpoAula(corpoBase);
    assert.equal(r.ok, true);
  });

  test("corpo que não é objeto é recusado", () => {
    const r = validarCorpoAula("não é objeto");
    assert.equal(r.ok, false);
  });

  test("array também é recusado (não é objeto no sentido do contrato)", () => {
    const r = validarCorpoAula([1, 2, 3]);
    assert.equal(r.ok, false);
  });

  describe("instalacao", () => {
    test("ausente é recusado", () => {
      const { instalacao: _omit, ...semInstalacao } = corpoBase;
      assert.equal(validarCorpoAula(semInstalacao).ok, false);
    });
    test("não-UUID é recusado", () => {
      assert.equal(validarCorpoAula({ ...corpoBase, instalacao: "não-é-um-uuid" }).ok, false);
    });
    test("UUID v1 (versão errada) é recusado", () => {
      assert.equal(
        validarCorpoAula({ ...corpoBase, instalacao: "11111111-1111-1111-8111-111111111111" }).ok,
        false,
      );
    });
  });

  describe("titulo", () => {
    test("string vazia é recusada", () => {
      assert.equal(validarCorpoAula({ ...corpoBase, titulo: "" }).ok, false);
    });
    test("1 caractere passa (mínimo)", () => {
      assert.equal(validarCorpoAula({ ...corpoBase, titulo: "x" }).ok, true);
    });
    test("300 caracteres passa (máximo)", () => {
      assert.equal(validarCorpoAula({ ...corpoBase, titulo: "x".repeat(300) }).ok, true);
    });
    test("301 caracteres é recusado", () => {
      assert.equal(validarCorpoAula({ ...corpoBase, titulo: "x".repeat(301) }).ok, false);
    });
    test("número no lugar de string é recusado", () => {
      assert.equal(validarCorpoAula({ ...corpoBase, titulo: 123 }).ok, false);
    });
  });

  describe("canal", () => {
    test("null passa", () => {
      assert.equal(validarCorpoAula({ ...corpoBase, canal: null }).ok, true);
    });
    test("200 caracteres passa (máximo)", () => {
      assert.equal(validarCorpoAula({ ...corpoBase, canal: "x".repeat(200) }).ok, true);
    });
    test("201 caracteres é recusado", () => {
      assert.equal(validarCorpoAula({ ...corpoBase, canal: "x".repeat(201) }).ok, false);
    });
    test("número no lugar de string/null é recusado", () => {
      assert.equal(validarCorpoAula({ ...corpoBase, canal: 42 }).ok, false);
    });
  });

  describe("transcricao", () => {
    test("199 caracteres é recusado (abaixo do mínimo)", () => {
      assert.equal(validarCorpoAula({ ...corpoBase, transcricao: transcricao(199) }).ok, false);
    });
    test("200 caracteres passa (mínimo)", () => {
      assert.equal(validarCorpoAula({ ...corpoBase, transcricao: transcricao(200) }).ok, true);
    });
    test("120.000 caracteres passa (máximo)", () => {
      assert.equal(validarCorpoAula({ ...corpoBase, transcricao: transcricao(120_000) }).ok, true);
    });
    test("120.001 caracteres é recusado (acima do máximo)", () => {
      assert.equal(validarCorpoAula({ ...corpoBase, transcricao: transcricao(120_001) }).ok, false);
    });
  });
});

// --- dia de Brasília ----------------------------------------------------------

describe("chaveDoDia", () => {
  test("meio-dia UTC de um dia qualquer", () => {
    // 12:00 UTC = 09:00 em Brasília, mesmo dia.
    assert.equal(chaveDoDia(new Date("2026-03-15T12:00:00.000Z")), "2026-03-15");
  });

  test("virada do dia: um segundo antes da meia-noite de Brasília ainda é o dia anterior", () => {
    // 00:00 em Brasília = 03:00 UTC. Um segundo antes é 02:59:59 UTC.
    assert.equal(chaveDoDia(new Date("2026-01-01T02:59:59.000Z")), "2025-12-31");
  });

  test("virada do dia: exatamente meia-noite de Brasília já é o novo dia", () => {
    assert.equal(chaveDoDia(new Date("2026-01-01T03:00:00.000Z")), "2026-01-01");
  });
});

// --- hash do IP -----------------------------------------------------------

describe("hashIp", () => {
  test("é determinístico: mesmo IP e sal dão o mesmo hash", () => {
    assert.equal(hashIp("203.0.113.7", "sal-1"), hashIp("203.0.113.7", "sal-1"));
  });

  test("nunca devolve o IP em claro", () => {
    const h = hashIp("203.0.113.7", "sal-1");
    assert.ok(!h.includes("203.0.113.7"));
  });

  test("sal diferente muda o hash (o sal realmente entra na conta)", () => {
    assert.notEqual(hashIp("203.0.113.7", "sal-1"), hashIp("203.0.113.7", "sal-2"));
  });

  test("é hex de 64 caracteres (sha256)", () => {
    assert.match(hashIp("203.0.113.7", "sal-1"), /^[0-9a-f]{64}$/);
  });
});

// --- limites ----------------------------------------------------------------

describe("verificarLimite — por instalação", () => {
  test("3ª chamada passa, 4ª dá 429 motivo instalacao (limite diário = 3)", async () => {
    const contador = new ContadorFake();
    const limites = { diario: 3, rede: 100, geral: 100 };
    const params = { instalacao: UUID_A, ipHash: "hash-fixo" };

    const r1 = await verificarLimite(contador, { ...params, limites });
    const r2 = await verificarLimite(contador, { ...params, limites });
    const r3 = await verificarLimite(contador, { ...params, limites });
    const r4 = await verificarLimite(contador, { ...params, limites });

    assert.deepEqual(
      [r1.ok, r2.ok, r3.ok],
      [true, true, true],
      "as 3 primeiras chamadas devem passar",
    );
    assert.equal(r4.ok, false);
    if (!r4.ok) {
      assert.equal(r4.motivo, "instalacao");
      assert.equal(r4.restantes, 0);
      assert.equal(r4.limite, 3);
    }

    // restantes decrescem: 2, 1, 0
    if (r1.ok && r2.ok && r3.ok) {
      assert.deepEqual([r1.restantes, r2.restantes, r3.restantes], [2, 1, 0]);
    }
  });

  test("o pedido recusado não consome unidade — a 5ª chamada ainda mostra o mesmo estado da 4ª", async () => {
    const contador = new ContadorFake();
    const limites = { diario: 1, rede: 100, geral: 100 };
    const params = { instalacao: UUID_A, ipHash: "hash-fixo" };

    await verificarLimite(contador, { ...params, limites }); // consome a única unidade
    const bloqueada1 = await verificarLimite(contador, { ...params, limites });
    const bloqueada2 = await verificarLimite(contador, { ...params, limites });

    assert.equal(bloqueada1.ok, false);
    assert.equal(bloqueada2.ok, false);
    // Se o incremento da tentativa recusada não fosse desfeito, o contador
    // interno cresceria a cada tentativa bloqueada — prova que fica estável.
    const dia = chaveDoDia();
    assert.equal(contador.mapa.get(`bruto:gratis:instalacao:${UUID_A}:${dia}`), 1);
  });
});

describe("verificarLimite — por rede (IP)", () => {
  test("3 instalações diferentes no mesmo IP: a que estoura o teto de rede recebe motivo rede", async () => {
    const contador = new ContadorFake();
    const limites = { diario: 100, rede: 2, geral: 100 };
    const mesmoIp = "hash-de-rede-compartilhada";

    const r1 = await verificarLimite(contador, { instalacao: UUID_A, ipHash: mesmoIp, limites });
    const r2 = await verificarLimite(contador, { instalacao: UUID_B, ipHash: mesmoIp, limites });
    const r3 = await verificarLimite(contador, { instalacao: UUID_C, ipHash: mesmoIp, limites });

    assert.equal(r1.ok, true);
    assert.equal(r2.ok, true);
    assert.equal(r3.ok, false);
    if (!r3.ok) assert.equal(r3.motivo, "rede");

    // A 3ª instalação, recusada por rede, não deve ter ficado com unidade
    // presa no próprio contador de instalação.
    const dia = chaveDoDia();
    assert.equal(contador.mapa.get(`bruto:gratis:instalacao:${UUID_C}:${dia}`), 0);
  });
});

describe("verificarLimite — teto geral", () => {
  test("instalações e IPs diferentes, mas o teto geral do dia estoura", async () => {
    const contador = new ContadorFake();
    const limites = { diario: 100, rede: 100, geral: 2 };

    const r1 = await verificarLimite(contador, { instalacao: UUID_A, ipHash: "ip-a", limites });
    const r2 = await verificarLimite(contador, { instalacao: UUID_B, ipHash: "ip-b", limites });
    const r3 = await verificarLimite(contador, { instalacao: UUID_C, ipHash: "ip-c", limites });

    assert.equal(r1.ok, true);
    assert.equal(r2.ok, true);
    assert.equal(r3.ok, false);
    if (!r3.ok) assert.equal(r3.motivo, "geral");
  });
});

// --- reserva compensada: o Contador (Redis) falha no MEIO da sequência ------

/**
 * Mesmo contrato de `ContadorFake`, mas `incr` LANÇA quando a chave bate no
 * predicado — simula o Redis caindo entre dois incrementos da mesma
 * requisição (ex.: `incr` da instalação passou, `incr` da rede não).
 */
class ContadorComFalha extends ContadorFake {
  constructor(private readonly falhaEm: (chave: string) => boolean) {
    super();
  }
  async incr(chave: string): Promise<number> {
    if (this.falhaEm(chave)) throw new Error("Redis indisponível (simulado no teste)");
    return super.incr(chave);
  }
}

describe("verificarLimite — o Contador lança no meio da reserva", () => {
  test("incr da rede lança depois do incr da instalação ter passado: a instalação é desfeita e o erro relança", async () => {
    const contador = new ContadorComFalha((chave) => chave.includes(":rede:"));
    const limites = { diario: 3, rede: 100, geral: 100 };

    await assert.rejects(() =>
      verificarLimite(contador, { instalacao: UUID_A, ipHash: "hash-fixo", limites }),
    );

    const dia = chaveDoDia();
    assert.equal(
      contador.mapa.get(`bruto:gratis:instalacao:${UUID_A}:${dia}`),
      0,
      "a unidade da instalação, já incrementada, tem de voltar a 0 — não pode ficar presa por uma falha do Redis",
    );
  });

  test("incr geral lança depois de instalação e rede terem passado: as duas são desfeitas", async () => {
    const contador = new ContadorComFalha((chave) => chave.includes(":geral:"));
    const limites = { diario: 3, rede: 100, geral: 100 };

    await assert.rejects(() =>
      verificarLimite(contador, { instalacao: UUID_A, ipHash: "hash-fixo", limites }),
    );

    const dia = chaveDoDia();
    assert.equal(contador.mapa.get(`bruto:gratis:instalacao:${UUID_A}:${dia}`), 0);
    assert.equal(contador.mapa.get(`bruto:gratis:rede:hash-fixo:${dia}`), 0);
  });

  test("depois da falha desfeita, um novo pedido (com o Redis saudável) passa normalmente", async () => {
    const contador = new ContadorComFalha((chave) => chave.includes(":rede:"));
    const limites = { diario: 3, rede: 100, geral: 100 };
    const params = { instalacao: UUID_A, ipHash: "hash-fixo", limites };

    await assert.rejects(() => verificarLimite(contador, params));

    // "Redis saudável de novo" — o mesmo duplo, sem o predicado de falha.
    const contadorRecuperado = new ContadorFake();
    contadorRecuperado.mapa = contador.mapa; // mesmo estado (já em 0)
    const r = await verificarLimite(contadorRecuperado, params);
    assert.equal(r.ok, true);
  });
});

describe("devolverUnidade", () => {
  test("depois de devolvida, a mesma instalação pode pedir de novo dentro do limite", async () => {
    const contador = new ContadorFake();
    const limites = { diario: 1, rede: 100, geral: 100 };
    const params = { instalacao: UUID_A, ipHash: "hash-fixo" };

    const r1 = await verificarLimite(contador, { ...params, limites });
    assert.equal(r1.ok, true);
    if (!r1.ok) return;

    // Simula o Ollama falhando depois do limite ter passado.
    await devolverUnidade(contador, r1.chaves);

    const cota = await lerCota(contador, { instalacao: UUID_A, limiteDiario: 1 });
    assert.equal(cota.restantes, 1, "a unidade devolvida deve voltar a aparecer como disponível");

    const r2 = await verificarLimite(contador, { ...params, limites });
    assert.equal(r2.ok, true, "depois da devolução, um novo pedido deve passar");
  });

  test("se o decr de UMA chave falhar, as outras duas ainda são devolvidas (mesma reserva compensada)", async () => {
    class ContadorComFalhaAoDecrementar extends ContadorFake {
      constructor(private readonly falhaEm: (chave: string) => boolean) {
        super();
      }
      async decr(chave: string): Promise<void> {
        if (this.falhaEm(chave)) throw new Error("Redis indisponível ao decrementar (simulado)");
        return super.decr(chave);
      }
    }

    const contador = new ContadorComFalhaAoDecrementar((chave) => chave.includes(":instalacao:"));
    const limites = { diario: 1, rede: 1, geral: 1 };
    const params = { instalacao: UUID_A, ipHash: "hash-fixo" };

    const r1 = await verificarLimite(contador, { ...params, limites });
    assert.equal(r1.ok, true);
    if (!r1.ok) return;

    // Não deve lançar, mesmo com o decr da instalação falhando por dentro.
    await devolverUnidade(contador, r1.chaves);

    assert.equal(
      contador.mapa.get(r1.chaves.rede),
      0,
      "rede tem de ter sido devolvida mesmo com a falha no decr da instalação",
    );
    assert.equal(contador.mapa.get(r1.chaves.geral), 0, "geral também tem de ter sido devolvida");
  });
});

describe("lerCota", () => {
  test("instalação nova mostra o limite inteiro disponível", async () => {
    const contador = new ContadorFake();
    const cota = await lerCota(contador, { instalacao: UUID_A, limiteDiario: 3 });
    assert.deepEqual(cota, { restantes: 3, limite: 3 });
  });

  test("não consome nada — chamar duas vezes mostra o mesmo valor", async () => {
    const contador = new ContadorFake();
    const params = { instalacao: UUID_A, ipHash: "hash-fixo" };
    await verificarLimite(contador, { ...params, limites: { diario: 3, rede: 100, geral: 100 } });

    const cota1 = await lerCota(contador, { instalacao: UUID_A, limiteDiario: 3 });
    const cota2 = await lerCota(contador, { instalacao: UUID_A, limiteDiario: 3 });
    assert.deepEqual(cota1, cota2);
    assert.deepEqual(cota1, { restantes: 2, limite: 3 });
  });
});
