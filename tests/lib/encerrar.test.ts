/**
 * A lógica de "Encerrar o Bruto" pelo próprio app (demanda 43fe2879):
 * `pedirEncerramento` — a função com dependências injetáveis — e a regra de
 * origem do `POST /api/encerrar` (anti-CSRF de localhost).
 *
 * Os testes NUNCA chamam o `process.exit` real nem agendam nada de verdade:
 * relógio, exit, leitura/remoção do pid, contagem de jobs e morticínio de
 * filhos entram todos por injeção.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  ATRASO_ENCERRAMENTO_MS,
  origemRecusada,
  pedirEncerramento,
  type DepsEncerrar,
} from "@/lib/encerrar";

/** Deps 100% falsas + fita de execução (ordem das chamadas) e fn agendada. */
function cenario(
  overrides: {
    pidNoArquivo?: string | null;
    jobsAtivos?: number;
    encerrarFilhos?: DepsEncerrar["encerrarFilhos"];
  } = {},
) {
  const fita: string[] = [];
  let agendada: (() => void | Promise<void>) | null = null;
  const deps: DepsEncerrar = {
    agendar: (fn, ms) => {
      fita.push(`agendar:${ms}`);
      agendada = fn;
    },
    exit: (codigo) => {
      fita.push(`exit:${codigo}`);
    },
    lerPid: () => {
      fita.push("lerPid");
      return overrides.pidNoArquivo === undefined ? "4242" : overrides.pidNoArquivo;
    },
    removerPid: () => {
      fita.push("removerPid");
    },
    contarJobsAtivos: () => overrides.jobsAtivos ?? 0,
    encerrarFilhos:
      overrides.encerrarFilhos ??
      (async () => {
        fita.push("encerrarFilhos");
      }),
    pid: 4242,
  };
  return { deps, fita, dispararAgendado: () => agendada?.() };
}

describe("origemRecusada — a trava de outro site (CSRF de localhost)", () => {
  const casosRecusados: Array<
    [string, { origin: string | null; secFetchSite: string | null; host: string | null }]
  > = [
    ["Origin de outro site", { origin: "https://site-mau.exemplo", secFetchSite: "cross-site", host: "127.0.0.1:3000" }],
    ["Origin: null (sandbox/redirect)", { origin: "null", secFetchSite: "same-site", host: "127.0.0.1:3000" }],
    ["sem Origin e Sec-Fetch-Site: cross-site", { origin: null, secFetchSite: "cross-site", host: "127.0.0.1:3000" }],
    ["sem Origin e sem Sec-Fetch-Site (cliente genérico)", { origin: null, secFetchSite: null, host: "127.0.0.1:3000" }],
    ["Origin certo, porta errada", { origin: "http://127.0.0.1:9999", secFetchSite: null, host: "127.0.0.1:3000" }],
    ["Origin com https na própria porta", { origin: "https://127.0.0.1:3000", secFetchSite: null, host: "127.0.0.1:3000" }],
    [
      "DNS rebinding: same-origin com Host de domínio de fora",
      { origin: null, secFetchSite: "same-origin", host: "evil.example:3000" },
    ],
    ["same-origin sem Host nenhum", { origin: null, secFetchSite: "same-origin", host: null }],
    ["same-origin com Host do IP da rede local", { origin: null, secFetchSite: "same-origin", host: "192.168.0.10:3000" }],
  ];
  for (const [nome, headers] of casosRecusados) {
    test(`recusa: ${nome}`, () => {
      assert.equal(origemRecusada(headers, 3000), true);
    });
  }

  const casosAceitos: Array<
    [string, { origin: string | null; secFetchSite: string | null; host: string | null }, number | string]
  > = [
    ["Sec-Fetch-Site: same-origin + Host 127.0.0.1 (a janela do próprio app)", { origin: null, secFetchSite: "same-origin", host: "127.0.0.1:3000" }, 3000],
    ["Sec-Fetch-Site: same-origin + Host localhost", { origin: null, secFetchSite: "same-origin", host: "localhost:3000" }, 3000],
    ["Origin exato 127.0.0.1", { origin: "http://127.0.0.1:3000", secFetchSite: null, host: "127.0.0.1:3000" }, 3000],
    ["Origin exato localhost", { origin: "http://localhost:3000", secFetchSite: null, host: "localhost:3000" }, 3000],
    ["porta custom do servidor (BRUTO_PORT)", { origin: "http://127.0.0.1:3999", secFetchSite: null, host: "127.0.0.1:3999" }, 3999],
  ];
  for (const [nome, headers, porta] of casosAceitos) {
    test(`aceita: ${nome}`, () => {
      assert.equal(origemRecusada(headers, porta), false);
    });
  }

  test("mesma porta certa não vale para porta diferente da do servidor", () => {
    assert.equal(
      origemRecusada({ origin: "http://127.0.0.1:3000", secFetchSite: null, host: "127.0.0.1:3000" }, 3999),
      true,
    );
  });
});

describe("pedirEncerramento — a decisão 202 × 409", () => {
  test("sem job ativo: 202 {ok:true} e agenda o desligamento (com o atraso do contrato)", () => {
    const c = cenario();
    const r = pedirEncerramento({}, c.deps);
    assert.equal(r.status, 202);
    assert.deepEqual(r.corpo, { ok: true });
    assert.deepEqual(c.fita, [`agendar:${ATRASO_ENCERRAMENTO_MS}`]);
  });

  test("com job ativo e SEM confirmar: 409 {ok:false, code, ativos} e NADA agendado", () => {
    const c = cenario({ jobsAtivos: 2 });
    const r = pedirEncerramento({ confirmar: false }, c.deps);
    assert.equal(r.status, 409);
    assert.deepEqual(r.corpo, { ok: false, code: "processamento-em-andamento", ativos: 2 });
    assert.deepEqual(c.fita, []);
  });

  test("com job ativo e confirmar:true: 202 e agenda do mesmo jeito", () => {
    const c = cenario({ jobsAtivos: 1 });
    const r = pedirEncerramento({ confirmar: true }, c.deps);
    assert.equal(r.status, 202);
    assert.deepEqual(r.corpo, { ok: true });
    assert.deepEqual(c.fita, [`agendar:${ATRASO_ENCERRAMENTO_MS}`]);
  });
});

describe("o desligamento agendado — ordem e a regra do pid", () => {
  test("pid é o do próprio processo: encerra filhos, apaga o pid, exit(0) — nesta ordem", async () => {
    const c = cenario(); // lerPid devolve "4242" e pid é 4242 — é o próprio
    pedirEncerramento({}, c.deps);
    await c.dispararAgendado();
    assert.deepEqual(c.fita, [
      `agendar:${ATRASO_ENCERRAMENTO_MS}`,
      "encerrarFilhos",
      "lerPid",
      "removerPid",
      "exit:0",
    ]);
  });

  test("ESPERA os filhos de verdade (await): pid/exit só depois que encerrarFilhos TERMINA", async () => {
    // O encerramento dos filhos "demora" (uma volta do relógio) — se o
    // desligamento não await, lerPid/exit aparecem antes de "filhos:fim" e a
    // fita entrega a ordem errada. É a prova do [P2]: a limpeza termina com o
    // event loop vivo, e só então sai. (A closure roda só dentro de
    // `dispararAgendado`, depois de `c` existir.)
    const c = cenario({
      encerrarFilhos: async () => {
        c.fita.push("filhos:inicio");
        await new Promise((r) => setTimeout(r, 25));
        c.fita.push("filhos:fim");
      },
    });
    pedirEncerramento({}, c.deps);
    await c.dispararAgendado();
    assert.deepEqual(c.fita, [
      `agendar:${ATRASO_ENCERRAMENTO_MS}`,
      "filhos:inicio",
      "filhos:fim",
      "lerPid",
      "removerPid",
      "exit:0",
    ]);
  });

  test("pid de OUTRO processo no arquivo: NÃO apaga (não mexe em servidor alheio)", async () => {
    const c = cenario({ pidNoArquivo: "1" }); // arquivo diz 1; este processo é 4242
    pedirEncerramento({}, c.deps);
    await c.dispararAgendado();
    assert.ok(c.fita.includes("lerPid"));
    assert.ok(!c.fita.includes("removerPid"), "apagou um pid que não era deste processo");
    assert.ok(c.fita.includes("exit:0"));
  });

  test("arquivo de pid inexistente: segue o encerramento sem tentar apagar", async () => {
    const c = cenario({ pidNoArquivo: null });
    pedirEncerramento({}, c.deps);
    await c.dispararAgendado();
    assert.ok(!c.fita.includes("removerPid"));
    assert.ok(c.fita.includes("exit:0"));
  });

  test("encerrarFilhos que REJEITA não pendura o desligamento: pid e exit rodam igual", async () => {
    // O contrato é sair; quem sobrar de filho é da rede de segurança do exit.
    const c = cenario({
      encerrarFilhos: async () => {
        c.fita.push("encerrarFilhos:boom");
        throw new Error("inesperado no encerramento");
      },
    });
    pedirEncerramento({}, c.deps);
    await c.dispararAgendado(); // não pode lançar
    assert.ok(c.fita.includes("exit:0"), "exit(0) deve rodar mesmo com encerramento de filhos falhando");
  });
});
