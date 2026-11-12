/**
 * O neto que ignora SIGTERM também morre (demanda 59a9cf6e, achado do Codex).
 *
 * `encerrarFilhosRegistrados` media "sobrou" pelo evento `close` do FILHO
 * DIRETO: se o filho saía no SIGTERM e um NETO (mesmo grupo) ignorava o sinal
 * sem herdar o stdio do filho, o `close` do filho chegava, o grupo saía de
 * `vivos`, o SIGKILL nunca era mandado — e o neto sobrevivia ao "Encerrar o
 * Bruto". A prova daqui é com processos REAIS: filho em grupo próprio
 * (detached) que lança neto `stdio: "ignore"` no MESMO grupo com handler de
 * SIGTERM que não faz nada; o filho morre no SIGTERM, o neto não. Depois de
 * `encerrarFilhosRegistrados`, o neto tem de estar morto (ESRCH no `kill 0`).
 */
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";

let registrarFilho: typeof import("@/pipeline/lib/cancelamento").registrarFilho;
let encerrarFilhosRegistrados: typeof import("@/pipeline/lib/cancelamento").encerrarFilhosRegistrados;

before(async () => {
  ({ registrarFilho, encerrarFilhosRegistrados } = await import("@/pipeline/lib/cancelamento"));
});

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

function dormir(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Lê o stdout do filho até casar a regex (o filho anuncia o PID do neto). */
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

describe("encerramento do app — o neto que ignora SIGTERM também morre", () => {
  test(
    "filho sai no SIGTERM, neto (mesmo grupo, stdio ignorado) IGNORA o sinal: encerrarFilhosRegistrados mata o grupo mesmo assim",
    { timeout: 30_000 },
    async () => {
      // Filho em grupo próprio (como o app spawna), que lança um NETO no
      // MESMO grupo (detached: false) com stdio "ignore" — não herda os pipes
      // do filho, então o `close` do filho não espera o neto — e handler de
      // SIGTERM que não faz nada. O filho em si NÃO instala handler: morre no
      // SIGTERM pelo default, exatamente a condição do bug.
      const script = `const { spawn } = require("node:child_process");
       const neto = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"], { stdio: "ignore" });
       console.log("NETO " + neto.pid);
       setInterval(() => {}, 1000);`;
      const filho = spawn(process.execPath, ["-e", script], {
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
      });
      const pidFilho = filho.pid ?? -1;
      let pidNeto = -1;
      try {
        pidNeto = await lerPidDoStdout(filho, /NETO (\d+)/);
        // Garante o handler de SIGTERM do neto instalado antes do encerramento
        // (o spawn é assíncrono; sem isso o teste pode matar cedo demais).
        await dormir(400);
        assert.ok(processoVivo(pidFilho), "filho de pé antes do encerramento");
        assert.ok(processoVivo(pidNeto), "neto (que ignora SIGTERM) de pé antes do encerramento");

        // Registrado como o app registra: entra na lista global que o
        // encerramento do app varre.
        registrarFilho(filho);

        // Grace curto INJETÁVEL: SIGTERM no grupo → filho sai (default) e o
        // `close` dele tira o grupo da lista — o neto é a prova de que a
        // escalada não pode depender do `close` do líder. A promessa é que
        // resolve COM o neto morto — assert imediato, sem espera que mascare.
        await encerrarFilhosRegistrados(200);
        assert.ok(
          !processoVivo(pidNeto),
          "encerrarFilhosRegistrados resolveu com o neto ainda vivo — a escalada dependeu do close do líder",
        );
      } finally {
        // Processo de teste é do teste: mata no GRUPO do filho (cobre o neto)
        // e no pid do neto, mesmo se o teste falhar.
        if (pidFilho > 0) {
          try {
            process.kill(-pidFilho, "SIGKILL");
          } catch {
            /* grupo já sumiu */
          }
        }
        if (pidNeto > 0) {
          try {
            process.kill(pidNeto, "SIGKILL");
          } catch {
            /* já saiu */
          }
        }
        try {
          filho.kill("SIGKILL");
        } catch {
          /* já saiu */
        }
      }
    },
  );
});
