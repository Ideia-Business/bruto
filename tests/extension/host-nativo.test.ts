/**
 * Testes da ponte extensão → host nativo (`extension/src/lib/host-nativo.ts`).
 *
 * O Chrome real é da fase seguinte (roteiro manual do dono); o que estes
 * testes exercem é a CONVERSA: o que a ponte manda, em que ordem pede a
 * permissão, e como classifica cada resposta possível. O duplo é um
 * `ApiChrome` falso com porta controlável — a ponte não sabe que não é o
 * Chrome, e é justamente isso que dá valor: os caminhos de "not found",
 * "forbidden", mensagem dupla e queda tardia são difíceis de reproduzir no
 * navegador de propósito, e aqui cada um é uma linha.
 *
 * Se estes testes falharem depois de o host mudar, quem mudou o host quebrou
 * o contrato — não é aqui que se conserta.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  NOME_DO_HOST,
  ligarApp,
  statusDoApp,
  type ApiChrome,
} from "../../extension/src/lib/host-nativo";

// --- o duplo ---------------------------------------------------------------

/** Porta falsa: grava tudo o que a extensão fez e deixa o teste dirigir o host. */
class PortaFalsa {
  /** O que a extensão POSTOU — é aqui que se prova que a mensagem é fechada. */
  readonly postadas: unknown[] = [];
  /** Vezes que a extensão chamou `disconnect` — tem de ser exatamente 1 no fim. */
  desconexoes = 0;
  private readonly ouvintesMensagem: ((msg: unknown) => void)[] = [];
  private readonly ouvintesDesconexao: (() => void)[] = [];

  constructor(private readonly chrome: ChromeFalso) {}

  postMessage(msg: unknown): void {
    this.chrome.ordem.push("post");
    this.postadas.push(msg);
  }

  disconnect(): void {
    this.desconexoes++;
  }

  readonly onMessage = {
    addListener: (ouvinte: (msg: unknown) => void): void => {
      this.ouvintesMensagem.push(ouvinte);
    },
  };

  readonly onDisconnect = {
    addListener: (ouvinte: () => void): void => {
      this.ouvintesDesconexao.push(ouvinte);
    },
  };

  /** O host responde (o Chrome chamaria os ouvintes de onMessage). */
  responder(msg: unknown): void {
    for (const ouvinte of [...this.ouvintesMensagem]) ouvinte(msg);
  }

  /**
   * A porta cai. `mensagem` é o que o Chrome deixaria em `runtime.lastError`
   * — precisa ser setado ANTES de disparar, porque lá o campo só existe
   * durante o callback.
   */
  cair(mensagem?: string): void {
    if (mensagem !== undefined) this.chrome.runtime.lastError = { message: mensagem };
    for (const ouvinte of [...this.ouvintesDesconexao]) ouvinte();
  }
}

/** `chrome` falso — controlável, sem `as any`, direto na interface `ApiChrome`. */
class ChromeFalso implements ApiChrome {
  /** Ordem das operações — é aqui que se prova "permissão ANTES de conectar". */
  readonly ordem: string[] = [];
  readonly portas: PortaFalsa[] = [];
  /** Nomes passados a `connectNative` — tem de ser sempre o do host do Bruto. */
  readonly nomesConnect: string[] = [];
  concederPermissao = true;
  lancarNoRequest = false;

  readonly permissions = {
    request: async (_pedido: { permissions: string[] }): Promise<boolean> => {
      this.ordem.push("request");
      if (this.lancarNoRequest) {
        throw new Error("This function must be called during a user gesture");
      }
      return this.concederPermissao;
    },
    contains: async (_pedido: { permissions: string[] }): Promise<boolean> => {
      this.ordem.push("contains");
      return this.concederPermissao;
    },
  };

  // `lastError` precisa ser opcional NO TIPO (o Chrome só o preenche durante
  // um callback) e mutável NA PRÁTICA, porque é assim que o duplo simula a
  // queda da porta — por isso a anotação vai no campo, não no literal.
  readonly runtime: {
    connectNative: (nome: string) => PortaFalsa;
    lastError?: { message?: string };
  } = {
    connectNative: (nome: string): PortaFalsa => {
      this.ordem.push("connect");
      this.nomesConnect.push(nome);
      const porta = new PortaFalsa(this);
      this.portas.push(porta);
      return porta;
    },
  };
}

/**
 * A conversa só abre DEPOIS do `await` da permissão. Uma volta de macrotask
 * garante que as microtasks pendentes (a resolução do `request`) já rodaram.
 */
async function esperarPorta(api: ChromeFalso): Promise<PortaFalsa> {
  if (api.portas.length === 0) {
    await new Promise((resolver) => setTimeout(resolver, 0));
  }
  assert.ok(api.portas.length > 0, "a extensão deveria ter aberto a porta do host");
  return api.portas[api.portas.length - 1];
}

// --- ligarApp --------------------------------------------------------------

describe("ligarApp — o caminho do clique", () => {
  test("permissão concedida + host responde pronto, com iniciado true", async () => {
    const api = new ChromeFalso();
    const promessa = ligarApp({ api });
    const porta = await esperarPorta(api);
    porta.responder({ ok: true, cmd: "ligar", rodando: true, iniciado: true });
    assert.deepEqual(await promessa, { resultado: "pronto", iniciado: true });
    assert.equal(porta.desconexoes, 1, "a porta é sempre desconectada ao terminar");
  });

  test("pronto com iniciado false — o app já estava de pé", async () => {
    const api = new ChromeFalso();
    const promessa = ligarApp({ api });
    const porta = await esperarPorta(api);
    porta.responder({ ok: true, cmd: "ligar", rodando: true, iniciado: false });
    assert.deepEqual(await promessa, { resultado: "pronto", iniciado: false });
  });

  test("a resposta REAL do host (com url) é aceita — e a url não vaza no resultado", async () => {
    const api = new ChromeFalso();
    const promessa = ligarApp({ api });
    const porta = await esperarPorta(api);
    porta.responder({
      ok: true,
      cmd: "ligar",
      rodando: true,
      iniciado: true,
      url: "http://127.0.0.1:3000",
    });
    // deepEqual com o objeto EXATO: se a url atravessasse, falharia aqui.
    assert.deepEqual(await promessa, { resultado: "pronto", iniciado: true });
  });

  test("`iniciado` não-booleano vira false — a resposta é entrada não-confiável", async () => {
    const api = new ChromeFalso();
    const promessa = ligarApp({ api });
    const porta = await esperarPorta(api);
    porta.responder({ ok: true, cmd: "ligar", rodando: true, iniciado: "sim" });
    assert.deepEqual(await promessa, { resultado: "pronto", iniciado: false });
  });

  test("permissão negada (request devolve false) — e o host NUNCA é tocado", async () => {
    const api = new ChromeFalso();
    api.concederPermissao = false;
    assert.deepEqual(await ligarApp({ api }), { resultado: "permissao-negada" });
    assert.equal(api.portas.length, 0, "sem permissão não abre porta");
    assert.deepEqual(api.ordem, ["request"], "nada além do pedido de permissão aconteceu");
  });

  test("request que LANÇA é permissão negada, não exceção na cara", async () => {
    const api = new ChromeFalso();
    api.lancarNoRequest = true;
    assert.deepEqual(await ligarApp({ api }), { resultado: "permissao-negada" });
    assert.equal(api.portas.length, 0);
  });

  test("permissions.request é a PRIMEIRA chamada, na MESMA volta do clique", async () => {
    const api = new ChromeFalso();
    // SEM await: esta linha ainda é a volta síncrona do "clique". Se a
    // ponte esperasse qualquer coisa antes de `request`, o Chrome real
    // recusaria o pedido com "not a user gesture" e a pessoa nunca veria o
    // diálogo — o defeito mais fácil de introduzir aqui é um `await` bobo.
    const promessa = ligarApp({ api });
    assert.equal(
      api.ordem.filter((op) => op === "request").length,
      1,
      "o pedido de permissão já partiu, sem nenhum await antes",
    );
    assert.equal(api.portas.length, 0, "connectNative não pode ter rodado antes da permissão");

    const porta = await esperarPorta(api);
    porta.responder({ ok: true, cmd: "ligar", rodando: true, iniciado: true });
    await promessa;
    // A ordem completa: permissão resolvida → conectar → postar. O Chrome
    // só permite `connectNative` em host nativo com a permissão concedida.
    assert.deepEqual(api.ordem, ["request", "connect", "post"]);
  });

  test("host ausente — o Chrome diz 'not found' no onDisconnect", async () => {
    const api = new ChromeFalso();
    const promessa = ligarApp({ api });
    const porta = await esperarPorta(api);
    porta.cair("Specified native messaging host not found.");
    assert.deepEqual(await promessa, { resultado: "host-ausente" });
    assert.equal(porta.desconexoes, 1);
  });

  test("'forbidden' também é host ausente (host registrado para outra extensão)", async () => {
    const api = new ChromeFalso();
    const promessa = ligarApp({ api });
    const porta = await esperarPorta(api);
    porta.cair("Access to the specified native messaging host is forbidden.");
    assert.deepEqual(await promessa, { resultado: "host-ausente" });
  });

  test("queda com outro motivo (ex.: o host morreu antes de responder) é erro", async () => {
    const api = new ChromeFalso();
    const promessa = ligarApp({ api });
    const porta = await esperarPorta(api);
    porta.cair("Native host has exited.");
    assert.deepEqual(await promessa, { resultado: "erro" });
  });

  test("queda SEM resposta e SEM lastError é erro", async () => {
    const api = new ChromeFalso();
    const promessa = ligarApp({ api });
    const porta = await esperarPorta(api);
    porta.cair();
    assert.deepEqual(await promessa, { resultado: "erro" });
  });

  test("falha-ao-ligar — o host tentou subir o app e não conseguiu", async () => {
    const api = new ChromeFalso();
    const promessa = ligarApp({ api });
    const porta = await esperarPorta(api);
    // A resposta de erro do host NÃO carrega cmd — o discriminador é `erro`.
    porta.responder({ ok: false, erro: "falha-ao-ligar" });
    assert.deepEqual(await promessa, { resultado: "falha-ao-ligar" });
    assert.equal(porta.desconexoes, 1);
  });

  test("falha-ao-ligar com cmd presente e certo também vale — o host não manda, mas se mandar está certo", async () => {
    const api = new ChromeFalso();
    const promessa = ligarApp({ api });
    const porta = await esperarPorta(api);
    porta.responder({ ok: false, cmd: "ligar", erro: "falha-ao-ligar" });
    assert.deepEqual(await promessa, { resultado: "falha-ao-ligar" });
  });

  test("resposta fora do contrato vira erro — nunca exceção, nunca eco do conteúdo", async () => {
    const casos: unknown[] = [
      null,
      "texto solto",
      42,
      [],
      { ok: "sim", cmd: "ligar", rodando: true },
      { cmd: "ligar", rodando: true }, // sem ok
      { ok: true, cmd: "status", rodando: true }, // resposta de outro comando
      { ok: true, cmd: "ligar", rodando: false }, // ok sem rodar
      { ok: true, cmd: "ligar" }, // rodando ausente
      { ok: false, erro: "comando-desconhecido" },
      { ok: false, erro: "mensagem-invalida" },
      { ok: false, erro: "erro-que-não-existe" },
      { ok: false }, // erro ausente
      { ok: true, cmd: "ligar", rodando: "true", iniciado: true }, // rodando não-booleano
      { ok: false, cmd: "status", erro: "falha-ao-ligar" }, // erro DE OUTRA conversa não é falha nossa
    ];
    for (const caso of casos) {
      const api = new ChromeFalso();
      const promessa = ligarApp({ api });
      const porta = await esperarPorta(api);
      porta.responder(caso);
      assert.deepEqual(
        await promessa,
        { resultado: "erro" },
        `caso fora do contrato: ${JSON.stringify(caso)}`,
      );
    }
  });

  test("demora: sem resposta no prazo, desconecta e devolve demora", async () => {
    const api = new ChromeFalso();
    const promessa = ligarApp({ api, prazoMs: 30 });
    const porta = await esperarPorta(api);
    // O duplo fica em silêncio: quem corta é o prazo da ponte.
    assert.deepEqual(await promessa, { resultado: "demora" });
    assert.equal(porta.desconexoes, 1, "desistir é desconectar a porta");
  });

  test("a mensagem enviada é EXATAMENTE {cmd:'ligar'} — e só para o host do Bruto", async () => {
    const api = new ChromeFalso();
    const promessa = ligarApp({ api });
    const porta = await esperarPorta(api);
    porta.responder({ ok: true, cmd: "ligar", rodando: true, iniciado: true });
    await promessa;
    assert.deepEqual(api.nomesConnect, [NOME_DO_HOST]);
    // deepEqual com o array exato: um campo a mais na mensagem falharia aqui.
    assert.deepEqual(porta.postadas, [{ cmd: "ligar" }]);
  });

  test("resolve UMA vez: resposta tardia e queda depois do resultado não mudam nada", async () => {
    const api = new ChromeFalso();
    const promessa = ligarApp({ api });
    const porta = await esperarPorta(api);
    // O host real responde e SAI — o Chrome entrega a queda logo depois;
    // e um host mal-educado poderia mandar duas mensagens. Nada disso pode
    // trocar o resultado nem desconectar de novo.
    porta.responder({ ok: true, cmd: "ligar", rodando: true, iniciado: false });
    porta.responder(null);
    porta.cair("Native host has exited.");
    assert.deepEqual(await promessa, { resultado: "pronto", iniciado: false });
    assert.equal(porta.desconexoes, 1, "encerrar é idempotente: desconecta uma vez só");
  });
});

// --- statusDoApp -----------------------------------------------------------

describe("statusDoApp — a consulta sem diálogo", () => {
  test("sem permissão: devolve sem-permissao e NÃO pede permissão nem toca no host", async () => {
    const api = new ChromeFalso();
    api.concederPermissao = false;
    assert.deepEqual(await statusDoApp({ api }), { resultado: "sem-permissao" });
    // `request` abre diálogo — só pode existir dentro do clique. A consulta
    // da reabertura do popup jamais pode dispará-lo.
    assert.equal(
      api.ordem.filter((op) => op === "request").length,
      0,
      "status nunca pede permissão",
    );
    assert.deepEqual(api.ordem, ["contains"]);
    assert.equal(api.portas.length, 0);
  });

  test("rodando", async () => {
    const api = new ChromeFalso();
    const promessa = statusDoApp({ api });
    const porta = await esperarPorta(api);
    porta.responder({ ok: true, cmd: "status", rodando: true, url: "http://127.0.0.1:3000" });
    assert.deepEqual(await promessa, { resultado: "rodando" });
    assert.equal(porta.desconexoes, 1);
  });

  test("parado", async () => {
    const api = new ChromeFalso();
    const promessa = statusDoApp({ api });
    const porta = await esperarPorta(api);
    porta.responder({ ok: true, cmd: "status", rodando: false, url: "http://127.0.0.1:3000" });
    assert.deepEqual(await promessa, { resultado: "parado" });
  });

  test("host ausente", async () => {
    const api = new ChromeFalso();
    const promessa = statusDoApp({ api });
    const porta = await esperarPorta(api);
    porta.cair("Specified native messaging host not found.");
    assert.deepEqual(await promessa, { resultado: "host-ausente" });
  });

  test("demora com prazo curto desconecta a porta", async () => {
    const api = new ChromeFalso();
    const promessa = statusDoApp({ api, prazoMs: 30 });
    const porta = await esperarPorta(api);
    assert.deepEqual(await promessa, { resultado: "demora" });
    assert.equal(porta.desconexoes, 1);
  });

  test("a mensagem enviada é EXATAMENTE {cmd:'status'}", async () => {
    const api = new ChromeFalso();
    const promessa = statusDoApp({ api });
    const porta = await esperarPorta(api);
    porta.responder({ ok: true, cmd: "status", rodando: true });
    await promessa;
    assert.deepEqual(api.nomesConnect, [NOME_DO_HOST]);
    assert.deepEqual(porta.postadas, [{ cmd: "status" }]);
  });

  test("resposta fora do contrato é erro — sem exceção", async () => {
    for (const caso of [null, "texto", { ok: true, cmd: "ligar", rodando: true }, { ok: false, erro: "x" }]) {
      const api = new ChromeFalso();
      const promessa = statusDoApp({ api });
      const porta = await esperarPorta(api);
      porta.responder(caso);
      assert.deepEqual(
        await promessa,
        { resultado: "erro" },
        `caso fora do contrato: ${JSON.stringify(caso)}`,
      );
    }
  });
});
