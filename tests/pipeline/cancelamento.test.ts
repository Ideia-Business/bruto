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

before(async () => {
  ({ rodarComCancelamento, registrarFilho } = await import("@/pipeline/lib/cancelamento"));
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
