/**
 * Testes da ponte extensão → app local.
 *
 * O app ainda estava sendo construído do outro lado quando isto foi escrito, e
 * esperar por ele não era opção. O DUPLO aqui é um servidor HTTP de verdade — não
 * um `fetch` remendado — porque o que precisa ser exercido é o caminho inteiro:
 * status, corpo, JSON quebrado, timeout, cancelamento. Um mock de `fetch` provaria
 * que o código chama `fetch`, que não é a dúvida.
 *
 * O contrato exercido é o normativo:
 *   GET  /api/llm/saude → { ok, provedores: [{ id, label, plano, disponivel, motivo? }] }
 *   POST /api/llm       → 200 { text, provider, model } · 400 · 503
 *
 * Se estes testes falharem depois de o app mudar, quem mudou o app quebrou o
 * contrato — não é aqui que se conserta.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

import {
  lerSaude,
  lerTexto,
  verSaudeDoApp,
  pedirAoApp,
  AppLocalError,
  APP_BASE,
} from "../../extension/src/lib/app-local";

// --- o duplo ---------------------------------------------------------------

/** O que o próximo pedido ao duplo vai responder. Trocado por cada teste. */
let responder: (req: http.IncomingMessage, res: http.ServerResponse) => void;
/** O corpo que o duplo RECEBEU — é onde se prova que a chave não viajou. */
let ultimoCorpo = "";

const servidor = http.createServer((req, res) => {
  const pedacos: Buffer[] = [];
  req.on("data", (d: Buffer) => pedacos.push(d));
  req.on("end", () => {
    ultimoCorpo = Buffer.concat(pedacos).toString("utf8");
    responder(req, res);
  });
});

before(async () => {
  await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
  const porta = (servidor.address() as AddressInfo).port;
  // `APP_BASE` é fixo (127.0.0.1:3000) porque é o que o manifesto declara. Em
  // teste o duplo sobe numa porta livre, então redirecionamos o `fetch` global
  // só para o endereço do app — qualquer outro destino segue normal.
  const fetchReal = globalThis.fetch;
  globalThis.fetch = ((entrada: string | URL | Request, init?: RequestInit) => {
    const url = String(typeof entrada === "object" && "url" in entrada ? entrada.url : entrada);
    const alvo = url.startsWith(APP_BASE) ? url.replace(APP_BASE, `http://127.0.0.1:${porta}`) : url;
    return fetchReal(alvo, init);
  }) as typeof fetch;
});

after(async () => {
  await new Promise<void>((r) => servidor.close(() => r()));
});

function responderJson(corpo: unknown, status = 200): void {
  responder = (_req, res) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(corpo));
  };
}

const SAUDE_COM_PLANO = {
  ok: true,
  provedores: [
    { id: "claude-cli", label: "Claude (plano)", plano: true, disponivel: true },
    { id: "anthropic", label: "Anthropic", plano: false, disponivel: true },
  ],
};

// --- validação: a resposta do app é entrada não-confiável -------------------

describe("lerSaude — o app pode responder qualquer coisa", () => {
  test("aceita a resposta que cumpre o contrato", () => {
    const s = lerSaude(SAUDE_COM_PLANO);
    assert.equal(s?.temPlano, true);
    assert.equal(s?.provedores.length, 2);
  });

  test("sem provedor de plano DISPONÍVEL, temPlano é falso", () => {
    const s = lerSaude({
      ok: true,
      provedores: [
        { id: "claude-cli", label: "Claude", plano: true, disponivel: false, motivo: "binário ausente" },
      ],
    });
    assert.equal(s?.temPlano, false, "plano indisponível não é plano");
    assert.equal(s?.provedores[0].motivo, "binário ausente", "o motivo chega à tela de opções");
  });

  test("provedor fora do contrato é DESCARTADO, não adivinhado", () => {
    const s = lerSaude({
      ok: true,
      provedores: [
        { id: "bom", label: "Bom", plano: true, disponivel: true },
        { id: "faltando-campos" },
        { id: 42, label: "id errado", plano: true, disponivel: true },
        "nem objeto é",
        null,
      ],
    });
    assert.equal(s?.provedores.length, 1, "só o que cumpre o contrato entra");
    assert.equal(s?.provedores[0].id, "bom");
  });

  test("corpo que não é a saúde vira null, e não exceção", () => {
    for (const lixo of [null, 42, "texto", [], {}, { ok: false }, { ok: true }]) {
      assert.equal(lerSaude(lixo), null, `${JSON.stringify(lixo)} não é uma saúde válida`);
    }
  });

  test("campos gigantes são truncados — a tela é pequena e o app não manda nela", () => {
    const s = lerSaude({
      ok: true,
      provedores: [{ id: "x".repeat(5000), label: "y".repeat(5000), plano: true, disponivel: true, motivo: "z".repeat(5000) }],
    });
    assert.ok((s?.provedores[0].id.length ?? 0) <= 60);
    assert.ok((s?.provedores[0].label.length ?? 0) <= 60);
    assert.ok((s?.provedores[0].motivo?.length ?? 0) <= 300);
  });
});

describe("lerTexto — o corpo da geração", () => {
  test("texto válido passa", () => {
    assert.equal(lerTexto({ text: "# Aula", provider: "claude-cli", model: "x" }), "# Aula");
  });

  test("texto ausente, vazio ou de outro tipo vira null", () => {
    for (const lixo of [{}, { text: "" }, { text: "   " }, { text: 42 }, { text: null }, null, "texto"]) {
      assert.equal(lerTexto(lixo), null, `${JSON.stringify(lixo)} não é texto utilizável`);
    }
  });

  test("texto absurdamente grande é cortado, não recusado", () => {
    const t = lerTexto({ text: "a".repeat(3_000_000) });
    assert.equal(t?.length, 2_000_000, "corta no teto");
  });
});

// --- o caminho inteiro, contra o duplo -------------------------------------

describe("verSaudeDoApp — contra um servidor de verdade", () => {
  test("app de pé com plano", async () => {
    responderJson(SAUDE_COM_PLANO);
    const s = await verSaudeDoApp();
    assert.equal(s?.temPlano, true);
  });

  test("app respondendo erro 500 é o mesmo que app ausente", async () => {
    responder = (_req, res) => {
      res.writeHead(500);
      res.end("pane");
    };
    assert.equal(await verSaudeDoApp(), null);
  });

  test("corpo que não é JSON não derruba a extensão", async () => {
    responder = (_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("isto não é json {{{");
    };
    assert.equal(await verSaudeDoApp(), null, "o caso comum é o app não estar lá — nunca pode virar exceção");
  });

  test("app que aceita a conexão e não responde respeita o teto de tempo", async () => {
    responder = () => {
      /* silêncio proposital: a porta está ocupada por algo que não fala o contrato */
    };
    const t0 = Date.now();
    assert.equal(await verSaudeDoApp(300), null);
    assert.ok(Date.now() - t0 < 3000, "não pode travar o popup esperando");
  });
});

describe("pedirAoApp — contra um servidor de verdade", () => {
  test("devolve o texto do app", async () => {
    responderJson({ text: "# 🎓 Aula: Entropia", provider: "claude-cli", model: "sonnet" });
    assert.equal(await pedirAoApp({ task: "study", prompt: "p", input: "i" }), "# 🎓 Aula: Entropia");
  });

  test("A CHAVE DA PESSOA NÃO VIAJA no corpo", async () => {
    responderJson({ text: "ok" });
    await pedirAoApp({ task: "study", prompt: "monte a aula", input: "transcrição" });
    const corpo = JSON.parse(ultimoCorpo) as Record<string, unknown>;
    assert.deepEqual(
      Object.keys(corpo).sort(),
      ["input", "prompt", "task", "tier"],
      "o corpo é fechado: nenhum campo além destes quatro",
    );
    // Regressão por nome: se alguém acrescentar a chave ao corpo um dia, é aqui
    // que o teste tem de gritar.
    for (const proibido of ["chave", "key", "apiKey", "api_key", "token", "authorization"]) {
      assert.ok(!(proibido in corpo), `\`${proibido}\` não pode estar no corpo`);
    }
    assert.ok(!/sk-|Bearer/i.test(ultimoCorpo), "nada com cara de credencial no corpo");
  });

  test("503 é SEM_PLANO — é o que faz a extensão cair para a chave", async () => {
    responderJson({ error: "nenhum provedor de plano" }, 503);
    await assert.rejects(
      () => pedirAoApp({ task: "study", prompt: "p" }),
      (e: unknown) => e instanceof AppLocalError && e.causa === "SEM_PLANO",
    );
  });

  test("400 é pedido inválido, e não some como falha genérica", async () => {
    responderJson({ error: "corpo inválido" }, 400);
    await assert.rejects(
      () => pedirAoApp({ task: "study", prompt: "p" }),
      (e: unknown) => e instanceof AppLocalError && e.causa === "PEDIDO_INVALIDO",
    );
  });

  test("resposta 200 sem texto é RESPOSTA_INVALIDA, não aula vazia na tela", async () => {
    responderJson({ provider: "claude-cli" });
    await assert.rejects(
      () => pedirAoApp({ task: "study", prompt: "p" }),
      (e: unknown) => e instanceof AppLocalError && e.causa === "RESPOSTA_INVALIDA",
    );
  });

  test("o corpo do erro do app NÃO vaza para a mensagem — só o número", async () => {
    responder = (_req, res) => {
      res.writeHead(502, { "content-type": "application/json" });
      // Um proxy no meio pode ecoar o request inteiro no corpo do erro.
      res.end(JSON.stringify({ error: "authorization: Bearer sk-segredo-da-pessoa" }));
    };
    await assert.rejects(
      () => pedirAoApp({ task: "study", prompt: "p" }),
      (e: unknown) => {
        assert.ok(e instanceof AppLocalError);
        assert.ok(!/sk-segredo|Bearer/i.test(e.message), "o corpo do erro é descartado");
        assert.ok(e.message.includes("502"), "só o status atravessa");
        return true;
      },
    );
  });

  test("cancelamento de quem chamou atravessa como cancelamento", async () => {
    responder = () => {
      /* nunca responde: quem decide parar é quem pediu */
    };
    const controle = new AbortController();
    const promessa = pedirAoApp({ task: "study", prompt: "p", signal: controle.signal });
    controle.abort();
    await assert.rejects(promessa, (e: unknown) => (e as Error).name === "AbortError");
  });
});
