/**
 * Mecanismo de cancelamento (src/pipeline/lib/cancelamento.ts) — provado sem
 * banco e sem pipeline de verdade: um "job" aqui é só um contexto
 * (`rodarComCancelamento`) com um filho que o próprio teste lança, como o
 * yt-dlp/whisper/claude lançam os seus.
 *
 * INVARIANTE A: nenhum processo do job sobrevive ao cancelamento — filho E
 * neto (o grupo inteiro) morrem.
 * INVARIANTE B: cancelar o job X mata só os processos DE X — o filho do job B
 * (irmão) e um processo que NÃO pertence a job nenhum seguem vivos.
 *
 * Sem `ps`: a prova de morte é `kill -0` (process.kill(pid, 0)), que só diz se
 * o PID existe — nos PIDs que ESTE teste criou.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import http from "node:http";
import type { AddressInfo } from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const RAIZ = process.cwd();

let rodarComCancelamento: typeof import("@/pipeline/lib/cancelamento").rodarComCancelamento;
let registrarFilho: typeof import("@/pipeline/lib/cancelamento").registrarFilho;
let encerrarFilhosRegistrados: typeof import("@/pipeline/lib/cancelamento").encerrarFilhosRegistrados;
let marcarEncerramento: typeof import("@/pipeline/lib/marca-de-encerramento").marcarEncerramento;
let resetarMarca: typeof import("@/pipeline/lib/marca-de-encerramento").resetarMarcaDeEncerramentoParaTestes;

before(async () => {
  ({ rodarComCancelamento, registrarFilho, encerrarFilhosRegistrados } = await import(
    "@/pipeline/lib/cancelamento"
  ));
  ({ marcarEncerramento, resetarMarcaDeEncerramentoParaTestes: resetarMarca } = await import(
    "@/pipeline/lib/marca-de-encerramento"
  ));
});

/** PIDs que ESTE arquivo criou — limpos no after, mesmo se um teste falhar. */
const pidsCriados = new Set<number>();
const filhosCriados: ChildProcess[] = [];

function spawnSobTeste(args: string[], comNeto = false): ChildProcess {
  // Mesma forma que os pontos de spawn do pipeline passam a usar: detached no
  // POSIX (grupo próprio) — é o que torna o grupo inteiro matável.
  const script = comNeto
    ? `const { spawn } = require("node:child_process");
       const neto = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
       console.log("NETO " + neto.pid);
       setInterval(() => {}, 1000);`
    : `setInterval(() => {}, 1000);`;
  const child = spawn(process.execPath, ["-e", script], {
    stdio: comNeto ? ["ignore", "pipe", "pipe"] : "ignore",
    detached: process.platform !== "win32",
  });
  filhosCriados.push(child);
  if (child.pid) pidsCriados.add(child.pid);
  return child;
}

/** kill -0: true se o PID existe (zumbi ainda conta; processo vivo conta). */
function processoVivo(pid: number): boolean {
  if (!(pid > 0)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Espera o PID sumir (reaped), com prazo — morte real, não zumbi passageiro. */
async function esperarMorrer(pid: number, prazoMs = 5_000): Promise<void> {
  const inicio = Date.now();
  while (processoVivo(pid)) {
    if (Date.now() - inicio > prazoMs) {
      assert.fail(`PID ${pid} ainda vivo após ${prazoMs}ms — deveria ter morrido com o cancelamento`);
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}

function dormir(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Lê o stdout do filho até casar a regex (o neto anuncia o próprio PID). */
async function lerPidDoStdout(child: ChildProcess, padrao: RegExp, prazoMs = 10_000): Promise<number> {
  let buffer = "";
  return new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`stdout não trouxe ${padrao}: "${buffer}"`)), prazoMs);
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (c: string) => {
      buffer += c;
      const m = padrao.exec(buffer);
      if (m) {
        clearTimeout(timer);
        resolve(Number(m[1]));
      }
    });
    child.on("close", () => {
      clearTimeout(timer);
      reject(new Error(`filho saiu antes de anunciar ${padrao}: "${buffer}"`));
    });
  });
}

after(() => {
  // Só o que este arquivo criou. Nunca processo de fora.
  for (const child of filhosCriados) {
    try {
      child.kill("SIGKILL");
    } catch {
      /* já saiu */
    }
  }
});

describe("INVARIANTE A + B — cancelar mata o GRUPO do job, e só o dele", () => {
  test(
    "cancelar o job A mata filho E neto; filho do job B e processo sem job seguem vivos",
    { timeout: 30_000 },
    async () => {
      const controllerA = new AbortController();
      const controllerB = new AbortController();

      // ── job A: filho que lança um neto (a hierarquia yt-dlp→ffmpeg do mundo real)
      let pidNetoA = -1;
      const fimDoJobA = rodarComCancelamento({ jobId: "jobA", signal: controllerA.signal }, async () => {
        const filho = spawnSobTeste([], true);
        registrarFilho(filho);
        pidNetoA = await lerPidDoStdout(filho, /NETO (\d+)/);
        pidsCriados.add(pidNetoA);
        // A "etapa" espera o filho terminar — como o pipeline espera o yt-dlp.
        await new Promise<void>((resolve) => filho.on("close", () => resolve()));
      });

      // ── job B (irmão): filho simples, registrado no contexto DELE
      const fimDoJobB = rodarComCancelamento({ jobId: "jobB", signal: controllerB.signal }, async () => {
        const filho = spawnSobTeste([]);
        registrarFilho(filho);
        await new Promise<void>((resolve) => filho.on("close", () => resolve()));
      });

      // ── processo que não pertence a job nenhum (o "app na porta 3000" do dono)
      const deFora = spawnSobTeste([]);

      // espera todo mundo estar de pé antes de cancelar
      await new Promise((r) => setTimeout(r, 300));
      const pidFilhoA = filhosCriados[0].pid ?? -1;
      const pidFilhoB = filhosCriados[1].pid ?? -1;
      assert.ok(processoVivo(pidFilhoA) && pidNetoA > 0 && processoVivo(pidNetoA), "job A: filho e neto de pé");
      assert.ok(processoVivo(pidFilhoB), "job B: filho de pé");
      assert.ok(processoVivo(deFora.pid ?? -1), "processo de fora de pé");

      // ── cancela SÓ o job A
      controllerA.abort();
      await fimDoJobA;

      await esperarMorrer(pidFilhoA);
      await esperarMorrer(pidNetoA);

      // INVARIANTE B: o irmão e o de fora nem sentiram.
      assert.ok(processoVivo(pidFilhoB), "filho do job B deve seguir vivo após cancelar o job A");
      assert.ok(processoVivo(deFora.pid ?? -1), "processo sem job deve seguir vivo");

      // ── cancela o job B depois: o filho dele morre também (o mecanismo vale para ambos)
      controllerB.abort();
      await fimDoJobB;
      await esperarMorrer(pidFilhoB);

      deFora.kill("SIGKILL");
    },
  );

  test("registrar filho com o signal JÁ abortado mata na hora (corrida spawn×cancel)", async () => {
    const controller = new AbortController();
    controller.abort(); // o cancelamento chegou ANTES do spawn terminar de registrar
    const criados: ChildProcess[] = [];
    const fim = rodarComCancelamento({ jobId: "job-tarde", signal: controller.signal }, async () => {
      const filho = spawnSobTeste([]);
      criados.push(filho);
      registrarFilho(filho);
      await new Promise((r) => setTimeout(r, 200)); // o contexto segue rodando
    });
    await fim;
    const filho = criados[0];
    assert.ok(filho, "filho foi criado");
    await esperarMorrer(filho.pid ?? -1);
  });

  test("filho que termina sozinho é desregistrado — cancelar depois não explode nem mata ninguém", async () => {
    const controller = new AbortController();
    const fim = rodarComCancelamento({ jobId: "job-ok", signal: controller.signal }, async () => {
      const filho = spawn(process.execPath, ["-e", "process.exit(0)"], {
        stdio: "ignore",
        detached: process.platform !== "win32",
      });
      registrarFilho(filho);
      await new Promise<void>((resolve) => filho.on("close", () => resolve()));
    });
    await fim; // filho já saiu e se desregistrou
    const deFora = spawnSobTeste([]);
    await new Promise((r) => setTimeout(r, 200));
    controller.abort(); // não pode lançar nem derrubar nada
    assert.ok(processoVivo(deFora.pid ?? -1));
    deFora.kill("SIGKILL");
  });

  test("filho em grupo próprio continua entregando stdout por pipe (detached não quebra a coleta)", async () => {
    const controller = new AbortController();
    let recebido = "";
    const fim = rodarComCancelamento({ jobId: "job-pipe", signal: controller.signal }, async () => {
      const filho = spawnSobTeste([], true); // imprime "NETO <pid>" no stdout
      registrarFilho(filho);
      await new Promise<void>((resolve) => {
        filho.stdout?.setEncoding("utf8");
        filho.stdout?.on("data", (c: string) => {
          recebido += c;
          if (/NETO \d+/.test(recebido)) resolve();
        });
      });
      controller.abort();
      await new Promise<void>((resolve) => filho.on("close", () => resolve()));
    });
    await fim;
    assert.match(recebido, /NETO \d+/);
  });
});

describe("LLM HTTP — fetch abortado pelo cancelamento do job", () => {
  test(
    "postJson dentro de job cancelado rejeita RÁPIDO (abort), sem esperar o timeout",
    { timeout: 30_000 },
    async () => {
      const { postJson, LlmHttpError } = await import("@/pipeline/lib/llm/providers/http");
      // Servidor lento de verdade: recebe e nunca responde.
      const servidor = http.createServer(() => {
        /* silêncio eterno */
      });
      await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
      const porta = (servidor.address() as AddressInfo).port;

      const controller = new AbortController();
      const inicio = Date.now();
      const chamada = rodarComCancelamento({ jobId: "job-http", signal: controller.signal }, () =>
        postJson({
          url: `http://127.0.0.1:${porta}/v1/responder`,
          headers: {},
          body: { q: "resuma" },
          timeoutMs: 60_000,
          label: "teste",
        }),
      );

      await dormir(150);
      controller.abort();

      await assert.rejects(chamada, (err: unknown) => err instanceof LlmHttpError);
      const durou = Date.now() - inicio;
      assert.ok(
        durou < 10_000,
        `rejeitou em ${durou}ms — abort deveria decidir, não o timeout de 60s`,
      );

      servidor.closeAllConnections?.();
      await new Promise<void>((r) => servidor.close(() => r()));
    },
  );
});

describe("rede de segurança — processo pai morto por sinal não deixa filhos órfãos", () => {
  test(
    "SIGTERM no processo: filhos registrados morrem junto E o default do sinal é preservado (o processo sai)",
    { timeout: 60_000 },
    async () => {
      // Fixture num tmpdir: importa o módulo REAL por caminho absoluto (o
      // módulo de cancelamento não tem imports internos com alias) e lança um
      // filho dormindo, registrado — fica vivo esperando o sinal.
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bruto-cancelamento-sig-"));
      const fixture = path.join(dir, "fixture.ts");
      const modulo = path.join(RAIZ, "src", "pipeline", "lib", "cancelamento.ts");
      fs.writeFileSync(
        fixture,
        `import { spawn } from "node:child_process";
import { registrarFilho } from ${JSON.stringify(modulo)};
const filho = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
  stdio: "ignore",
  detached: process.platform !== "win32",
});
registrarFilho(filho);
console.log("PRONTO " + filho.pid);
setInterval(() => {}, 1000);
`,
      );

      const proc = spawn(process.execPath, ["--import", "tsx", fixture], {
        stdio: ["ignore", "pipe", "pipe"],
        cwd: RAIZ,
      });
      let pidFilho = -1;
      try {
        pidFilho = await lerPidDoStdout(proc, /PRONTO (\d+)/, 30_000);
        assert.ok(processoVivo(pidFilho), "filho do fixture de pé antes do sinal");

        proc.kill("SIGTERM");

        // O processo TEM que sair: se o handler de segurança engolisse o
        // sinal, ele ficaria vivo e o prazo estouraria aqui.
        const saiu = new Promise<boolean>((resolve) => {
          proc.on("exit", () => resolve(true));
          setTimeout(() => resolve(false), 10_000).unref();
        });
        assert.ok(await saiu, "processo do fixture deveria morrer com SIGTERM (default preservado)");

        await esperarMorrer(pidFilho, 10_000);
      } finally {
        try {
          proc.kill("SIGKILL");
        } catch {
          /* já saiu */
        }
        if (pidFilho > 0) {
          try {
            process.kill(pidFilho, "SIGKILL");
          } catch {
            /* já saiu */
          }
        }
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});

describe("encerramento do app — filhos morrem de verdade ANTES do exit", () => {
  // O bug (achado do Codex): o handler de `exit` manda SIGTERM e AGENDA o
  // SIGKILL num setTimeout — que nunca dispara depois do exit. Filho que
  // ignora SIGTERM sobrevivia ao próprio "Encerrar o Bruto". O caminho novo
  // termina a limpeza com o event loop VIVO e só então sai.
  test(
    "filho que IGNORA SIGTERM morre mesmo assim: encerrarFilhosRegistrados espera o grace e escala para SIGKILL",
    { timeout: 30_000 },
    async () => {
      // Filho resistente com processo REAL: handler de SIGTERM que não faz
      // nada — como um yt-dlp/whisper/ffmpeg travado. Em grupo próprio, do
      // jeito que o app spawna (FILHO_EM_GRUPO_PROPRIO).
      const filho = spawn(
        process.execPath,
        ["-e", 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);'],
        { stdio: "ignore", detached: process.platform !== "win32" },
      );
      filhosCriados.push(filho);
      const pid = filho.pid ?? -1;
      if (pid > 0) pidsCriados.add(pid);
      // Registrado como o app registra: fora de job, entra na lista global
      // que o encerramento do app varre.
      registrarFilho(filho);

      try {
        // Filho de pé COM o handler instalado.
        await dormir(400);
        assert.ok(processoVivo(pid), "filho resistente de pé antes do encerramento");

        // Sanity da fixture: SIGTERM no grupo NÃO pode matá-lo — senão o
        // teste não provaria a escalada para SIGKILL.
        try {
          process.kill(-pid, "SIGTERM");
        } catch {
          /* grupo já sumiu: fixture ruim, o assert seguinte pega */
        }
        await dormir(200);
        assert.ok(processoVivo(pid), "fixture: o filho deve IGNORAR SIGTERM (senão nada está sendo provado)");

        // O encerramento com grace curto INJETÁVEL: SIGTERM (ignorado) →
        // 200 ms → SIGKILL no grupo → resolve. A promessa é que resolve COM o
        // filho morto — o assert é imediato, sem espera que mascare.
        await encerrarFilhosRegistrados(200);
        assert.ok(
          !processoVivo(pid),
          "encerrarFilhosRegistrados resolveu com o filho ainda vivo — só prometeu matar",
        );
      } finally {
        // Filho de teste é do teste: mata no grupo mesmo se o teste falhar.
        if (pid > 0) {
          try {
            process.kill(-pid, "SIGKILL");
          } catch {
            /* já saiu */
          }
        }
      }
    },
  );

  test("sem filho registrado: resolve imediato, sem esperar grace nenhum", async () => {
    const inicio = Date.now();
    await encerrarFilhosRegistrados(5_000); // se esperasse o grace, o teto do teste estouraria
    const durou = Date.now() - inicio;
    assert.ok(durou < 2_000, `resolveu em ${durou}ms — sem filhos não há o que esperar`);
  });
});

describe("saída do processo — nenhum filho sobrevive (r5: SIGKILL síncrono no exit, registro único, nada novo com a marca)", () => {
  // Os achados [P2] da r4: (i) o handler de `exit` mandava SIGTERM e agendava
  // o SIGKILL num setTimeout — que NUNCA dispara depois do exit; (ii) cada
  // bundle do Next tem a sua instância de cancelamento.ts, cada uma com o seu
  // `filhosConhecidos` — a limpeza de um bundle não via os filhos do outro;
  // (iii) filho nascido DEPOIS do retrato da limpeza (retry do runLLM)
  // escapava. Os três testes daqui provam as três peças do conserto.

  test(
    "handler de exit com SIGKILL SÍNCRONO: filho registrado que IGNORA SIGTERM morre junto com o processo",
    { timeout: 60_000 },
    async () => {
      // Fixture em tmpdir: processo REAL que importa o módulo REAL por
      // caminho absoluto, registra um filho que ignora SIGTERM e chama
      // `process.exit(0)` — disparando o handler de `exit` de verdade.
      // Depois do exit NENHUM timer dispara: se o handler depender do
      // SIGKILL agendado, o filho sobrevive (o bug da r4). O filho só é
      // registrado DEPOIS de anunciar que o handler de SIGTERM dele está
      // instalado — senão o SIGTERM do handler chega antes da instalação e
      // mata pelo default, provando nada.
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bruto-cancelamento-exit-"));
      const fixture = path.join(dir, "fixture-exit.ts");
      const modulo = path.join(RAIZ, "src", "pipeline", "lib", "cancelamento.ts");
      fs.writeFileSync(
        fixture,
        `import fs from "node:fs";
import { spawn } from "node:child_process";
import { registrarFilho } from ${JSON.stringify(modulo)};
// Sem top-level await: fixture em tmpdir compila como CJS.
async function main(): Promise<void> {
  const filho = spawn(
    process.execPath,
    ["-e", "process.on('SIGTERM', () => {}); require('node:fs').writeSync(1, 'FILHO_COM_HANDLER\\\\n'); setInterval(() => {}, 1000);"],
    { stdio: ["ignore", "pipe", "ignore"], detached: process.platform !== "win32" },
  );
  await new Promise<void>((resolver) => {
    filho.stdout!.setEncoding("utf8");
    filho.stdout!.on("data", (c: string) => {
      if (c.includes("FILHO_COM_HANDLER")) resolver();
    });
  });
  registrarFilho(filho);
  fs.writeSync(1, "PRONTO " + filho.pid + "\\n");
  process.exit(0);
}
void main();
`,
      );

      const proc = spawn(process.execPath, ["--import", "tsx", fixture], {
        stdio: ["ignore", "pipe", "pipe"],
        cwd: RAIZ,
      });
      let pidFilho = -1;
      try {
        pidFilho = await lerPidDoStdout(proc, /PRONTO (\d+)/, 30_000);
        assert.ok(processoVivo(pidFilho), "filho do fixture de pé antes do exit");

        const codigo = await new Promise<number | null>((resolve) => {
          proc.on("exit", (c) => resolve(c));
        });
        assert.equal(codigo, 0, "fixture deveria sair com exit(0)");

        // O filho ignora SIGTERM: só um SIGKILL SÍNCRONO disparado pelo
        // handler de `exit` derruba ele aqui.
        await esperarMorrer(pidFilho, 10_000);
      } finally {
        try {
          proc.kill("SIGKILL");
        } catch {
          /* já saiu */
        }
        if (pidFilho > 0) {
          try {
            process.kill(-pidFilho, "SIGKILL");
          } catch {
            /* já saiu */
          }
        }
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  test("registro único por PROCESSO: filhosConhecidos vive em globalThis (dois bundles, uma lista)", async () => {
    const globalParaFilhos = globalThis as unknown as {
      __brutoFilhosConhecidos?: Set<ChildProcess>;
    };
    const filho = spawnSobTeste([]);
    try {
      registrarFilho(filho);
      const registro = globalParaFilhos.__brutoFilhosConhecidos;
      assert.ok(registro instanceof Set, "esperava um Set em globalThis.__brutoFilhosConhecidos");
      assert.ok(registro.has(filho), "filho registrado por 'uma instância' aparece na lista global");

      // Saiu do ar → sai da lista: o close remove do Set compartilhado.
      try {
        filho.kill("SIGKILL");
      } catch {
        /* já saiu */
      }
      await new Promise<void>((r) => filho.once("close", () => r()));
      assert.ok(!registro.has(filho), "filho que saiu é removido da lista global");
    } finally {
      try {
        filho.kill("SIGKILL");
      } catch {
        /* já saiu */
      }
    }
  });

  test("registrarFilho com a marca de encerramento LIGADA: mata na hora (SIGKILL no grupo) e NÃO registra", async () => {
    marcarEncerramento();
    const globalParaFilhos = globalThis as unknown as {
      __brutoFilhosConhecidos?: Set<ChildProcess>;
    };
    let pid = -1;
    try {
      // Ignora SIGTERM: a morte rápida só se explica por SIGKILL no grupo.
      const filho = spawn(
        process.execPath,
        ["-e", 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);'],
        { stdio: "ignore", detached: process.platform !== "win32" },
      );
      filhosCriados.push(filho);
      pid = filho.pid ?? -1;
      if (pid > 0) pidsCriados.add(pid);

      registrarFilho(filho);

      const registro = globalParaFilhos.__brutoFilhosConhecidos;
      assert.ok(!registro?.has(filho), "filho nascido com a marca ligada não deve entrar no registro");
      await esperarMorrer(pid, 2_000); // SIGKILL direto: não há grace para esperar
    } finally {
      resetarMarca();
      if (pid > 0) {
        try {
          process.kill(-pid, "SIGKILL");
        } catch {
          /* já saiu */
        }
      }
    }
  });
});
