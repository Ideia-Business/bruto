// Bruto — host de native messaging (Chrome), macOS e Linux. ADR 0003.
//
// Protocolo: 4 bytes (uint32 LE) com o tamanho do JSON UTF-8, depois o JSON.
// Lê UMA mensagem, responde UMA, sai com 0. Só dois comandos:
//   {"cmd":"status"}  e  {"cmd":"ligar"}
// A mensagem NUNCA vira argumento, caminho, variável de ambiente ou comando: o
// único programa executado é o serve.sh desta pasta, com argv fixo.
//
// Nada além do protocolo pode ir para o stdout.

import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LIMITE_BYTES = 1024;
const ESPERA_LIGAR_MS = 30000;
const PASSO_MS = 500;

const porta = (() => {
  const n = Number(process.env.BRUTO_PORT ?? "3000");
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : 3000;
})();
const url = `http://127.0.0.1:${porta}`;

function responder(obj) {
  const corpo = Buffer.from(JSON.stringify(obj), "utf8");
  const cab = Buffer.alloc(4);
  cab.writeUInt32LE(corpo.length, 0);
  process.stdout.write(Buffer.concat([cab, corpo]), () => process.exit(0));
}

const erro = (codigo) => responder({ ok: false, erro: codigo });

// Lê o enquadramento do stdin por eventos. Resolve com o Buffer da mensagem ou
// null se for inválida (cabeçalho incompleto, tamanho > limite, stdin fechou
// antes do tamanho declarado).
function lerMensagem() {
  return new Promise((resolve) => {
    let acumulado = Buffer.alloc(0);
    let tamanho = null;
    let feito = false;
    const fim = (valor) => {
      if (feito) return;
      feito = true;
      process.stdin.pause();
      resolve(valor);
    };
    const avaliar = () => {
      if (tamanho === null && acumulado.length >= 4) {
        tamanho = acumulado.readUInt32LE(0);
        if (tamanho > LIMITE_BYTES) return fim(null);
      }
      if (tamanho !== null && acumulado.length >= 4 + tamanho) {
        return fim(acumulado.subarray(4, 4 + tamanho));
      }
    };
    process.stdin.on("data", (pedaco) => {
      if (feito) return;
      acumulado = Buffer.concat([acumulado, pedaco]);
      avaliar();
    });
    process.stdin.on("end", () => fim(null));
    process.stdin.on("error", () => fim(null));
  });
}

// "Rodando" = o servidor responde HTTP (qualquer status) em 127.0.0.1:<porta>.
function servidorResponde() {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port: porta, path: "/", timeout: 2000 }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.on("error", () => resolve(false));
  });
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function ligar() {
  if (await servidorResponde()) {
    return responder({ ok: true, cmd: "ligar", rodando: true, iniciado: false, url });
  }
  const serve = path.join(path.dirname(fileURLToPath(import.meta.url)), "serve.sh");
  let falhou = false;
  let filho;
  try {
    filho = spawn("/bin/bash", [serve], {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, BRUTO_SEM_JANELA: "1" },
    });
  } catch {
    return erro("falha-ao-ligar");
  }
  filho.on("error", () => {
    falhou = true;
  });
  // serve.sh sai 0 ao terminar de garantir o servidor; saída != 0 é falha.
  filho.on("exit", (codigo) => {
    if (codigo !== 0) falhou = true;
  });
  filho.unref();

  const limite = Date.now() + ESPERA_LIGAR_MS;
  while (Date.now() < limite && !falhou) {
    if (await servidorResponde()) {
      return responder({ ok: true, cmd: "ligar", rodando: true, iniciado: true, url });
    }
    await dormir(PASSO_MS);
  }
  if (!falhou && (await servidorResponde())) {
    return responder({ ok: true, cmd: "ligar", rodando: true, iniciado: true, url });
  }
  return erro("falha-ao-ligar");
}

async function main() {
  const bruto = await lerMensagem();
  if (bruto === null) return erro("mensagem-invalida");

  let msg;
  try {
    msg = JSON.parse(bruto.toString("utf8"));
  } catch {
    return erro("mensagem-invalida");
  }
  if (msg === null || typeof msg !== "object" || Array.isArray(msg)) {
    return erro("mensagem-invalida");
  }

  // Só a igualdade exata com literais fixos; o valor recebido nunca é usado.
  if (msg.cmd === "status") {
    return responder({ ok: true, cmd: "status", rodando: await servidorResponde(), url });
  }
  if (msg.cmd === "ligar") return ligar();
  return erro("comando-desconhecido");
}

main().catch(() => erro("falha-ao-ligar"));
