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
/** Os cabeçalhos que o duplo RECEBEU. */
let ultimosCabecalhos: http.IncomingHttpHeaders = {};

const servidor = http.createServer((req, res) => {
  const pedacos: Buffer[] = [];
  req.on("data", (d: Buffer) => pedacos.push(d));
  req.on("end", () => {
    ultimoCorpo = Buffer.concat(pedacos).toString("utf8");
    ultimosCabecalhos = req.headers;

    // O duplo EXIGE `application/json`, como o app real passou a exigir. Não é
    // capricho: é o que obriga uma página web a passar por preflight, e o
    // preflight morre sem origem autorizada. Sem CORS a página não LÊ a
    // resposta, mas com `text/plain` ela DISPARA a chamada assim mesmo — e o
    // plano da pessoa queima em laço sem que ninguém precise ler nada.
    // O duplo recusando junto é o que dá valor ao teste do cabeçalho.
    if (req.method === "POST" && req.headers["content-type"] !== "application/json") {
      res.writeHead(415, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "content-type deve ser application/json" }));
      return;
    }

    // E a saúde EXIGE `X-Bruto-Cliente`, como o app real passou a exigir. A
    // razão é a mesma do `Content-Type`, na porta que tinha ficado de fora: a
    // saúde é um GET simples, que qualquer página dispara sem CORS e sem ler
    // resposta — só que essa rota CRIA SUBPROCESSOS (`claude auth status`,
    // `codex login status`). Um laço de `fetch` viraria centenas de processos na
    // máquina de quem instalou. Um cabeçalho não-safelisted força preflight.
    // Exigido nas DUAS rotas, não só na saúde. No POST o `Content-Type` já
    // forçaria o preflight sozinho — mas uma regra com uma exceção é como a
    // classe fica aberta, e a exceção seria justamente a porta que gasta o
    // dinheiro de quem usa. O duplo exige nas duas, senão o teste é decorativo.
    if (req.headers["x-bruto-cliente"] !== "extensao") {
      res.writeHead(403, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "cabeçalho X-Bruto-Cliente ausente" }));
      return;
    }

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

  test("MANDA `X-Bruto-Cliente: extensao` — sem ele a saúde nem responde", async () => {
    // A saúde cria subprocessos no app (`claude auth status`, `codex login
    // status`). Um cabeçalho não-safelisted é o que obriga uma página web a
    // passar por preflight antes de conseguir disparar isso em laço. O duplo
    // devolve 403 sem ele (ver o servidor acima), então este teste morre se
    // alguém tirar o cabeçalho da sonda.
    responderJson(SAUDE_COM_PLANO);
    const s = await verSaudeDoApp();
    assert.equal(s?.temPlano, true, "sem o cabeçalho o duplo recusa e isto vira null");
    assert.equal(ultimosCabecalhos["x-bruto-cliente"], "extensao");
  });

  test("corpo gigante É CORTADO ANTES de virar objeto — mesmo sendo JSON válido", async () => {
    // `127.0.0.1:3000` não prova identidade: outro processo pode ter tomado a
    // porta. A carga aqui é uma saúde PERFEITAMENTE válida, só que inflada — se
    // o teto não existisse, ela seria aceita e `temPlano` viria `true`. Em
    // pedaços, sem `content-length`, para exercer o teto do FLUXO.
    const provedores = [{ id: "claude-cli", label: "Claude", plano: true, disponivel: true }];
    for (let i = 0; i < 4000; i++) {
      provedores.push({ id: `enche-${i}`, label: "x".repeat(40), plano: false, disponivel: false });
    }
    const carga = JSON.stringify({ ok: true, provedores });
    assert.ok(carga.length > 64 * 1024, "a carga do teste precisa passar do teto para medir algo");

    responder = (_req, res) => {
      res.writeHead(200, { "content-type": "application/json" }); // sem content-length → chunked
      for (let i = 0; i < carga.length; i += 8192) res.write(carga.slice(i, i + 8192));
      res.end();
    };
    assert.equal(await verSaudeDoApp(), null, "corpo acima do teto não pode virar objeto");
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

  // Achado P2 da revisão cross-vendor de 24/09/2026: `fetch()` resolve assim
  // que os CABEÇALHOS chegam, não quando o corpo termina. Se o relógio for
  // desarmado no retorno do `fetch` (em vez de depois de o corpo terminar de
  // ser lido), este cenário — cabeçalho 200 chegou, corpo nunca fecha — fica
  // SEM proteção nenhuma: o teste anterior (conexão aceita, nada responde)
  // não pega isso, porque ali nem os cabeçalhos chegam.
  test("app que manda os cabeçalhos e trava o corpo respeita o teto de tempo", async () => {
    responder = (_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.write('{"ok":true,"prov'); // corpo aberto, nunca fecha
    };
    const t0 = Date.now();
    assert.equal(await verSaudeDoApp(300), null);
    assert.ok(Date.now() - t0 < 3000, "o corpo travado não pode segurar o popup além do teto");
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

  test("MANDA `content-type: application/json` — é ele que protege o plano", async () => {
    // Este cabeçalho não é formalidade: `application/json` fica FORA da lista de
    // tipos dispensados de preflight, então uma página web qualquer que tente a
    // mesma chamada esbarra no preflight e nunca chega ao app. Com `text/plain`
    // a requisição seria simples, iria sem preflight, e o app executaria — a
    // página só não leria a resposta, mas a assinatura já teria sido gasta.
    // Se alguém "simplificar" o header daqui, é aqui que tem de falhar.
    responderJson({ text: "ok" });
    await pedirAoApp({ task: "study", prompt: "p" });
    assert.equal(ultimosCabecalhos["content-type"], "application/json");
  });

  test("MANDA `X-Bruto-Cliente` TAMBÉM no POST — a mesma tranca nas duas portas", async () => {
    // Aqui ele é tecnicamente redundante (o `content-type` já força preflight),
    // e é exatamente por isso que precisa de teste: o que parece dispensável é o
    // que alguém remove "limpando". O duplo recusa sem ele nas duas rotas, então
    // tirar daqui reprova este teste e mais um punhado.
    responderJson({ text: "ok" });
    await pedirAoApp({ task: "study", prompt: "p" });
    assert.equal(ultimosCabecalhos["x-bruto-cliente"], "extensao");
    assert.equal(ultimosCabecalhos["content-type"], "application/json", "e o outro continua indo");
  });

  test("sem o cabeçalho, o app devolve 415 — e isso vira defeito NOSSO, não da máquina dela", async () => {
    // O duplo recusa qualquer POST sem `application/json` (ver o servidor acima),
    // então basta provar que o 415 chega classificado e com saída acionável.
    responder = (_req, res) => {
      res.writeHead(415, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "tipo recusado" }));
    };
    await assert.rejects(
      () => pedirAoApp({ task: "study", prompt: "p" }),
      (e: unknown) => {
        assert.ok(e instanceof AppLocalError && e.causa === "TIPO_RECUSADO");
        assert.match(e.message, /defeito da extensão/);
        return true;
      },
    );
  });

  test("413 vira recado de gente sobre o vídeo, não um número", async () => {
    responderJson({ error: "corpo acima de 1 MB" }, 413);
    await assert.rejects(
      () => pedirAoApp({ task: "study", prompt: "p", input: "x".repeat(100) }),
      (e: unknown) => {
        assert.ok(e instanceof AppLocalError && e.causa === "GRANDE_DEMAIS");
        assert.ok(!e.message.includes("413"), "o número não ajuda quem está na frente da tela");
        assert.match(e.message, /longo demais/);
        return true;
      },
    );
  });

  test("geração acima do teto é recusada pelo `content-length` declarado", async () => {
    // Caminho barato: o outro lado declarou o tamanho, e nem chegamos a ler.
    const enorme = JSON.stringify({ text: "a".repeat(5 * 1024 * 1024) });
    responder = (_req, res) => {
      res.writeHead(200, { "content-type": "application/json" }); // node calcula o content-length
      res.end(enorme);
    };
    await assert.rejects(
      () => pedirAoApp({ task: "study", prompt: "p" }),
      (e: unknown) => {
        assert.ok(e instanceof AppLocalError && e.causa === "RESPOSTA_INVALIDA");
        assert.match(e.message, /grande demais/);
        return true;
      },
    );
  });

  test("e também quando o tamanho não é declarado — o teto do fluxo é o que vale", async () => {
    // `content-length` é declarado pelo outro lado: pode faltar, e pode mentir.
    // Em pedaços não há o que conferir antes, então o corte tem de ser na leitura.
    const enorme = JSON.stringify({ text: "a".repeat(5 * 1024 * 1024) });
    responder = (_req, res) => {
      res.writeHead(200, { "content-type": "application/json" }); // chunked: sem content-length
      for (let i = 0; i < enorme.length; i += 64 * 1024) res.write(enorme.slice(i, i + 64 * 1024));
      res.end();
    };
    await assert.rejects(
      () => pedirAoApp({ task: "study", prompt: "p" }),
      (e: unknown) => e instanceof AppLocalError && e.causa === "RESPOSTA_INVALIDA",
    );
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

  test("cancelamento de quem chamou corta NA HORA, e não no fim do timeout", async () => {
    // A versão anterior deste teste passava — em 180 006 ms. Ela não media
    // cancelamento nenhum: media o relógio interno estourando, porque o sinal de
    // quem chamou estava sendo descartado no caminho. Um teste de cancelamento
    // que não crava PRAZO é um teste de timeout com outro nome.
    responder = () => {
      /* nunca responde: quem decide parar é quem pediu */
    };
    const controle = new AbortController();
    const t0 = Date.now();
    const promessa = pedirAoApp({
      task: "study",
      prompt: "p",
      // Bem maior que o prazo cobrado abaixo: se o corte vier do relógio interno
      // em vez do botão, o teste estoura o prazo e reprova.
      timeoutMs: 60_000,
      signal: controle.signal,
    });
    controle.abort();
    await assert.rejects(promessa, (e: unknown) => (e as Error).name === "AbortError");
    const gasto = Date.now() - t0;
    assert.ok(gasto < 2000, `cancelou em ${gasto} ms — tinha de ser imediato, não esperar o relógio`);
  });

  test("o relógio interno continua cortando quem não é cancelado", async () => {
    // O conserto combina dois sinais; o risco do conserto é matar o outro.
    responder = () => {
      /* nunca responde */
    };
    const t0 = Date.now();
    await assert.rejects(
      () => pedirAoApp({ task: "study", prompt: "p", timeoutMs: 400 }),
      (e: unknown) => e instanceof AppLocalError && e.causa === "INDISPONIVEL",
    );
    assert.ok(Date.now() - t0 < 4000, "o teto de tempo tem de continuar valendo");
  });
});
