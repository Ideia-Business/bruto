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
import { spawn } from "node:child_process";
import { encerrarFilhosRegistrados, registrarFilho } from "@/pipeline/lib/cancelamento";
import {
  ATRASO_ENCERRAMENTO_MS,
  origemRecusada,
  pedirEncerramento,
  type DepsEncerrar,
} from "@/lib/encerrar";

/** Deps 100% falsas + fita de execução (ordem das chamadas) e fns agendadas. */
function cenario(
  overrides: {
    pidNoArquivo?: string | null;
    jobsAtivos?: number;
    encerrarFilhos?: DepsEncerrar["encerrarFilhos"];
    exit?: DepsEncerrar["exit"];
    marcarEncerrando?: DepsEncerrar["marcarEncerrando"];
  } = {},
) {
  const fita: string[] = [];
  // Todos os agendamentos (o single-flight é testado com DOIS pedidos — o
  // helper antigo guardava só a última fn e o primeiro pedido sumia).
  const agendadas: Array<() => void | Promise<void>> = [];
  const deps: DepsEncerrar = {
    agendar: (fn, ms) => {
      fita.push(`agendar:${ms}`);
      agendadas.push(fn);
    },
    exit:
      overrides.exit ??
      ((codigo) => {
        fita.push(`exit:${codigo}`);
      }),
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
    marcarEncerrando:
      overrides.marcarEncerrando ??
      (() => {
        fita.push("marcarEncerrando");
      }),
    pid: 4242,
  };
  return {
    deps,
    fita,
    agendadas,
    dispararAgendado: () => agendadas[agendadas.length - 1]?.(),
  };
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
  test("pid é o do próprio processo: marca a fila, encerra filhos, apaga o pid, exit(0) — nesta ordem", async () => {
    const c = cenario(); // lerPid devolve "4242" e pid é 4242 — é o próprio
    pedirEncerramento({}, c.deps);
    await c.dispararAgendado();
    assert.deepEqual(c.fita, [
      `agendar:${ATRASO_ENCERRAMENTO_MS}`,
      "marcarEncerrando",
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
      "marcarEncerrando",
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

describe("single-flight [P2, r4] — no máximo UMA operação de encerramento por processo", () => {
  // O bug (4ª rodada): duas janelas confirmam juntas; cada 202 agenda o seu
  // desligamento. O primeiro limpa o registro de filhos e entra no grace;
  // o segundo acha o registro VAZIO (encerrarFilhos resolve na hora), pula a
  // espera e chama exit(0) ANTES do SIGKILL do primeiro — e com o registro
  // limpo a rede de segurança do handler de `exit` também não vê o filho.
  // Órfão. O contrato: pedidos seguintes COMPARTILHAM a promessa da primeira
  // operação — nunca um segundo `encerrarFilhos`, nunca um segundo `exit`.

  test("dois disparos compartilham a MESMA operação: um marcar+encerrarFilhos+pid+exit", async () => {
    const c = cenario({
      encerrarFilhos: async () => {
        c.fita.push("encerrarFilhos");
        await new Promise((r) => setTimeout(r, 25)); // a "espera" do grace
      },
    });
    const r1 = pedirEncerramento({}, c.deps);
    const r2 = pedirEncerramento({}, c.deps);
    assert.equal(r1.status, 202);
    assert.equal(r2.status, 202);
    // Os dois timers da produção disparam quase juntos — aqui também.
    await Promise.all(c.agendadas.map((fn) => fn()));
    assert.deepEqual(c.fita, [
      `agendar:${ATRASO_ENCERRAMENTO_MS}`, // um agendamento por pedido…
      `agendar:${ATRASO_ENCERRAMENTO_MS}`,
      "marcarEncerrando", // …mas UMA operação só (invariante 1)
      "encerrarFilhos",
      "lerPid",
      "removerPid",
      "exit:0",
    ]);
  });

  test(
    "dois pedidos com confirmar:true e filho que IGNORA SIGTERM: UM encerrarFilhos, UM exit — e o exit só depois da morte do filho",
    { timeout: 30_000 },
    async () => {
      // Filho resistente REAL (padrão do teste da r3 em cancelamento.test.ts):
      // handler de SIGTERM que não faz nada — um yt-dlp/whisper travado. Em
      // grupo próprio, do jeito que o app spawna.
      const filho = spawn(
        process.execPath,
        ["-e", 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);'],
        { stdio: "ignore", detached: process.platform !== "win32" },
      );
      const pid = filho.pid ?? -1;
      const pidsDeTeste: number[] = pid > 0 ? [pid] : [];
      let encerrarFilhosChamadas = 0;
      let filhoVivoNoExit = false;
      const exits: number[] = [];

      try {
        registrarFilho(filho); // registrado como o app registra
        await new Promise((r) => setTimeout(r, 400)); // de pé COM o handler
        const vivo = (p: number): boolean => {
          try {
            process.kill(p, 0);
            return true;
          } catch (err) {
            return (err as NodeJS.ErrnoException).code === "EPERM";
          }
        };
        assert.ok(vivo(pid), "filho resistente de pé antes dos pedidos");

        const c = cenario({
          jobsAtivos: 1, // há job rodando: os dois pedidos precisam de confirmar
          encerrarFilhos: async () => {
            encerrarFilhosChamadas++;
            await encerrarFilhosRegistrados(200); // grace curto INJETÁVEL
          },
          exit: (codigo) => {
            exits.push(codigo);
            filhoVivoNoExit = vivo(pid); // a ORDEM: como estava o filho NO exit?
          },
          marcarEncerrando: () => {},
        });

        // Duas janelas confirmam o encerramento ao mesmo tempo.
        const r1 = pedirEncerramento({ confirmar: true }, c.deps);
        const r2 = pedirEncerramento({ confirmar: true }, c.deps);
        assert.equal(r1.status, 202);
        assert.equal(r2.status, 202);
        assert.equal(c.agendadas.length, 2, "cada pedido agenda o seu desligamento");

        // Os dois timers disparam quase juntos (produção: 300ms cada).
        await Promise.all(c.agendadas.map((fn) => fn()));

        assert.equal(encerrarFilhosChamadas, 1, "UMA operação de encerramento de filhos — nunca duas");
        assert.deepEqual(exits, [0], "UM exit — o segundo pedido compartilha, não repete");
        assert.equal(filhoVivoNoExit, false, "no instante do exit o filho já estava morto (ordem (b)→(d))");
        assert.ok(!vivo(pid), "filho morto de verdade (reaped)");
      } finally {
        // Filho de teste é do teste: mata no grupo mesmo se algo falhar.
        for (const p of pidsDeTeste) {
          try {
            process.kill(-p, "SIGKILL");
          } catch {
            /* já saiu */
          }
        }
      }
    },
  );
});
