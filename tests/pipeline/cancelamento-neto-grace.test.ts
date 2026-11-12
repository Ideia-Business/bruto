/**
 * O prazo de tolerância do encerramento vale para o GRUPO inteiro — o fim do
 * grace é "todos os GRUPOS sumiram" ou "o prazo acabou", NUNCA o `close` dos
 * líderes (achado [P2, r2] do Codex).
 *
 * `encerrarFilhosRegistrados` media o fim do grace pelo evento `close` dos
 * FILHOS DIRETOS (`esperarSairem` em cima de `vivos`): se o filho saía logo no
 * SIGTERM e um NETO (mesmo grupo, `stdio: "ignore"`) ainda terminava a própria
 * limpeza graciosa, o `close` do líder resolvia a espera ~20 ms depois do
 * sinal e o SIGKILL troncava a limpeza do neto DENTRO do grace — com grace de
 * 2 s, um neto que precisa de 300 ms nem chegava a gravar o próprio flush.
 * A prova daqui é com processos REAIS: filho em grupo próprio (detached) que
 * sai no SIGTERM pelo default + neto `stdio: "ignore"` que, ao receber SIGTERM,
 * espera ~300 ms, grava um arquivo-marca e sai (limpeza graciosa). Com grace
 * de 1000 ms, o marcador TEM de existir depois de `encerrarFilhosRegistrados`
 * — e o neto não pode mais existir. O neto que IGNORA SIGTERM (r1) é provado
 * no arquivo-irmão `cancelamento-neto.test.ts`.
 */
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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

describe("encerramento do app — o grace vale para o GRUPO inteiro, não só para os líderes", () => {
  test(
    "filho sai logo no SIGTERM, neto (mesmo grupo, stdio ignorado) precisa de ~300 ms de limpeza: o grace de 1000 ms deixa a limpeza terminar",
    {
      timeout: 30_000,
      // A prova exige kill de GRUPO de processo e um marcador gravado no
      // handler de SIGTERM: sinais/grupo são POSIX — no Windows o
      // encerramento mata só o filho direto, de propósito — não é bug lá.
      skip:
        process.platform === "win32"
          ? "depende de grupo de processo e SIGTERM no neto (POSIX-only); no Windows encerrarFilhosRegistrados mata só o filho direto"
          : false,
    },
    async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bruto-neto-grace-"));
      const marca = path.join(dir, "marca.txt");
      // Neto: ao receber SIGTERM, espera ~300 ms (a "limpeza"/flush dele),
      // grava a marca e sai — gracioso, cabe com folga num grace de 1000 ms.
      // Filho: SEM handler — sai no SIGTERM pelo default, exatamente a
      // condição do bug (o `close` do líder resolvia a espera cedo demais).
      const scriptNeto = `const fs = require("node:fs");
       process.on("SIGTERM", () => {
         setTimeout(() => {
           try { fs.writeFileSync(${JSON.stringify(marca)}, "limpeza concluida"); } catch {}
           process.exit(0);
         }, 300);
       });
       setInterval(() => {}, 1000);`;
      const script = `const { spawn } = require("node:child_process");
       const neto = spawn(process.execPath, ["-e", ${JSON.stringify(scriptNeto)}], { stdio: "ignore" });
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
        assert.ok(processoVivo(pidNeto), "neto (limpeza graciosa) de pé antes do encerramento");
        assert.ok(!fs.existsSync(marca), "marca não deve existir antes do encerramento");

        // Registrado como o app registra: entra na lista global que o
        // encerramento do app varre.
        registrarFilho(filho);

        // Grace de 1000 ms INJETÁVEL: o neto precisa de ~300 ms — cabe no
        // grace com folga. A promessa é que resolve com a limpeza CONCLUÍDA
        // (marca gravada) e o neto fora do ar — asserts imediatos, sem
        // espera que mascare.
        await encerrarFilhosRegistrados(1000);
        assert.ok(
          fs.existsSync(marca),
          "a limpeza graciosa do neto foi troncada: SIGKILL no grupo antes de o neto gravar a marca, DENTRO do grace",
        );
        assert.ok(!processoVivo(pidNeto), "neto ainda existe depois do encerramento");
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
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});
