/**
 * A ponte para o **host nativo** do Bruto — o pequeno programa que o
 * instalador registrou no navegador e que LIGA o app local quando a extensão
 * precisa dele (ADR 0003). A extensão não executa binário; quem executa é o
 * host, e só dois comandos fixos atravessam esta ponte.
 *
 * O CONTRATO (normativo, definido fora daqui — não mude sem combinar):
 *
 *   chrome.runtime.connectNative("com.ideiabusiness.bruto")
 *   → UMA mensagem nossa:  {"cmd":"ligar"}  ou  {"cmd":"status"}
 *   ← UMA resposta do host (a porta cai logo em seguida — o host sai):
 *     {"ok":true,"cmd":"status","rodando":<bool>,"url":"http://127.0.0.1:<porta>"}
 *     {"ok":true,"cmd":"ligar","rodando":<bool>,"iniciado":<bool>,"url":"…"}
 *     {"ok":false,"erro":"comando-desconhecido"|"mensagem-invalida"|"falha-ao-ligar"}
 *
 * TRÊS COISAS QUE NÃO PODEM SE PERDER AQUI:
 *
 * 1. **A permissão é pedida DENTRO do gesto do clique.** O Chrome só abre o
 *    diálogo de `permissions.request` se a PRIMEIRA operação assíncrona do
 *    handler do clique for essa chamada — qualquer `await` antes e ele
 *    responde "This function must be called during a user gesture" sem
 *    mostrar pergunta nenhuma à pessoa. Por isso `ligarApp` chama `request`
 *    ainda na volta síncrona (o comentário no corpo dela marca o ponto).
 * 2. **A resposta do host é entrada não-confiável.** "É local" não é
 *    credencial: quem fala na porta é o que o registro da máquina apontar.
 *    Nada é usado sem passar por `interpretarLigar`/`interpretarStatus`,
 *    que só reconhecem o formato fechado acima — o texto cru da resposta
 *    nunca vira resultado, mensagem de tela ou log.
 * 3. **A mensagem enviada é fechada.** Sempre um literal `{ cmd }` — nenhum
 *    dado de fora entra nela, porque do outro lado há um programa executando
 *    na máquina da pessoa, e o host só sabe lidar com comando fixo.
 */

/** Nome do host registrado pelo instalador (`launcher/registrar-host.sh`). */
export const NOME_DO_HOST = "com.ideiabusiness.bruto";

/**
 * Prazo de `ligar`: acompanha o pior caso do host (build frio do app +
 * espera do servidor subir). A UI espera até aqui; depois orienta a pessoa
 * a reabrir a extensão — a reabertura refaz o `status` e recupera o estado.
 */
export const PRAZO_LIGAR_MS = 60_000;

/** Prazo de `status`: o host já ligado responde na hora; 5 s é folga com fim. */
export const PRAZO_STATUS_MS = 5_000;

const PERMISSAO = "nativeMessaging";

/** A porta de native messaging — o subconjunto que esta ponte usa. */
interface PortaNativa {
  postMessage(mensagem: unknown): void;
  disconnect(): void;
  onMessage: { addListener(ouvinte: (mensagem: unknown) => void): void };
  onDisconnect: { addListener(ouvinte: () => void): void };
}

/**
 * O que a ponte usa de `chrome.*` — injetável para teste. Padrão:
 * `globalThis.chrome`. É um subconjunto estrutural proposital: quem testa
 * passa um dublê sem cast, e o Chrome real (`@types/chrome`) cabe nele.
 */
export interface ApiChrome {
  permissions: {
    request(pedido: { permissions: string[] }): Promise<boolean>;
    contains(pedido: { permissions: string[] }): Promise<boolean>;
  };
  runtime: {
    connectNative(nome: string): PortaNativa;
    /**
     * Só existe DURANTE um callback de evento — é onde o Chrome entrega o
     * motivo de uma desconexão (host não registrado, proibido…).
     */
    readonly lastError?: { readonly message?: string };
  };
}

export type ResultadoLigar =
  | { resultado: "pronto"; iniciado: boolean }
  | { resultado: "permissao-negada" }
  | { resultado: "host-ausente" }
  | { resultado: "falha-ao-ligar" }
  | { resultado: "demora" }
  | { resultado: "erro" };

export type ResultadoStatus =
  | { resultado: "rodando" }
  | { resultado: "parado" }
  | { resultado: "sem-permissao" }
  | { resultado: "host-ausente" }
  | { resultado: "demora" }
  | { resultado: "erro" };

function ehObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Valida e classifica a resposta do host a `{"cmd":"ligar"}`.
 *
 * Tudo que não bate no formato fechado vira `"erro"` — em vez de exceção,
 * adivinhação ou eco do conteúdo recebido: a mensagem que a pessoa vê fala
 * do que fazer, não do que veio pela porta.
 *
 * Detalhe do contrato: a resposta de SUCESSO carrega `cmd`; a de ERRO não
 * carrega (o host responde só `{ok:false, erro}`) — o discriminador do ramo
 * de erro é o campo `erro`, não o `cmd`.
 */
function interpretarLigar(msg: unknown): ResultadoLigar {
  if (!ehObjeto(msg)) return { resultado: "erro" };

  if (msg.ok === true) {
    // cmd ausente ou de outro comando não é sucesso desta conversa.
    if (msg.cmd !== "ligar") return { resultado: "erro" };
    // "ok" sem "rodando: true" é contrato descumprido, não sucesso.
    if (msg.rodando !== true) return { resultado: "erro" };
    // `iniciado` só interessa como booleano; qualquer outra coisa é false.
    return { resultado: "pronto", iniciado: msg.iniciado === true };
  }

  if (msg.ok === false) {
    // Se VIER cmd e for de outro comando, é resposta de outra conversa.
    if (msg.cmd !== undefined && msg.cmd !== "ligar") return { resultado: "erro" };
    if (msg.erro === "falha-ao-ligar") return { resultado: "falha-ao-ligar" };
    return { resultado: "erro" };
  }

  // `ok` ausente ou não-booleano.
  return { resultado: "erro" };
}

/** O mesmo, para `{"cmd":"status"}` — aqui `rodando:false` é um fineza: "parado". */
function interpretarStatus(msg: unknown): ResultadoStatus {
  if (!ehObjeto(msg)) return { resultado: "erro" };
  if (msg.cmd !== "status") return { resultado: "erro" };

  if (msg.ok === true) {
    if (msg.rodando === true) return { resultado: "rodando" };
    if (msg.rodando === false) return { resultado: "parado" };
    return { resultado: "erro" };
  }
  return { resultado: "erro" };
}

/** Os desfechos que NÃO vêm da mensagem do host (caiu, demorou, falhou a montagem). */
interface DesfechosSemResposta<T> {
  hostAusente: T;
  demora: T;
  erro: T;
}

/**
 * A conversa inteira com o host: abre a porta, manda UMA mensagem, espera
 * UMA resposta (ou a queda da porta, ou o prazo), desmonta tudo e resolve
 * UMA vez. Nunca lança — toda falha é um resultado.
 */
function falarComHost<T extends ResultadoLigar | ResultadoStatus>(
  api: ApiChrome,
  pedido: {
    cmd: "ligar" | "status";
    prazoMs: number;
    interpretar: (msg: unknown) => T;
    semResposta: DesfechosSemResposta<T>;
  },
): Promise<T> {
  return new Promise<T>((resolve) => {
    let concluido = false;
    let porta: PortaNativa | undefined;
    let temporizador: ReturnType<typeof setTimeout> | undefined;

    // O host real responde e SAI: o `onDisconnect` dele chega depois da
    // resposta e não pode trocar o resultado, desconectar duas vezes, nem
    // deixar o temporizador vivo. Um único ponto de saída garante os três.
    const encerrar = (resultado: T): void => {
      if (concluido) return;
      concluido = true;
      if (temporizador !== undefined) clearTimeout(temporizador);
      if (porta !== undefined) {
        try {
          porta.disconnect();
        } catch {
          // O Chrome trata desconectar porta morta como no-op; um dublê de
          // teste pode ser menos tolerante. O resultado já está decidido.
        }
      }
      resolve(resultado);
    };

    const aoResponder = (msg: unknown): void => {
      encerrar(pedido.interpretar(msg));
    };

    const aoCair = (): void => {
      // É AQUI que o Chrome entrega o motivo — `runtime.lastError` só
      // existe durante o callback. "not found"/"forbidden" = o nome do
      // host não está no registro desta máquina (instalador não rodou,
      // ou rodou em outro navegador): é "host-ausente", com recado
      // próprio; qualquer outra queda antes da resposta é "erro".
      const motivo = api.runtime.lastError?.message;
      const texto = typeof motivo === "string" ? motivo.toLowerCase() : "";
      const hostAusente = texto.includes("not found") || texto.includes("forbidden");
      encerrar(hostAusente ? pedido.semResposta.hostAusente : pedido.semResposta.erro);
    };

    try {
      porta = api.runtime.connectNative(NOME_DO_HOST);
      // Ouvintes ANTES do post: a resposta pode voltar antes de qualquer
      // `await` nosso, e sem ouvinte registrado ela se perderia.
      porta.onMessage.addListener(aoResponder);
      porta.onDisconnect.addListener(aoCair);
      temporizador = setTimeout(() => encerrar(pedido.semResposta.demora), pedido.prazoMs);
      // A mensagem é fechada: literal fixo, nenhum dado de fora entra.
      porta.postMessage({ cmd: pedido.cmd });
    } catch {
      // `connectNative`/`postMessage` lançando é anomalia do próprio
      // navegador — não há o que mapear além de "erro".
      encerrar(pedido.semResposta.erro);
    }
  });
}

/**
 * Liga o app local pelo host nativo. Chamar de DENTRO do handler do clique.
 *
 * Nunca lança: até a recusa da pessoa é um resultado, porque a tela precisa
 * dizer o que fazer em cada caso — e "permissão negada" tem recado próprio.
 */
export async function ligarApp(opcoes?: {
  api?: ApiChrome;
  prazoMs?: number;
}): Promise<ResultadoLigar> {
  const api = opcoes?.api ?? apiChromePadrao();
  if (api === undefined) return { resultado: "erro" };

  // A PRIMEIRA operação assíncrona, chamada de forma SÍNCRONA na mesma
  // volta do evento — este é TODO o segredo da função: o Chrome só aceita
  // `permissions.request` dentro do gesto do usuário, e o gesto "expira" no
  // primeiro `await`. Nenhum await pode vir antes desta chamada, e o pedido
  // já precisa ter PARTIDO quando `ligarApp` devolve a promise.
  let concedida: boolean;
  try {
    concedida = await api.permissions.request({ permissions: [PERMISSAO] });
  } catch {
    // Negou na tela, ou o Chrome recusou fora do gesto: para quem chamou é
    // o mesmo desfecho — sem a permissão não há conversa com o host.
    return { resultado: "permissao-negada" };
  }
  if (concedida !== true) return { resultado: "permissao-negada" };

  return falarComHost(api, {
    cmd: "ligar",
    prazoMs: opcoes?.prazoMs ?? PRAZO_LIGAR_MS,
    interpretar: interpretarLigar,
    semResposta: {
      hostAusente: { resultado: "host-ausente" },
      demora: { resultado: "demora" },
      erro: { resultado: "erro" },
    },
  });
}

/**
 * O app local está de pé? Sem diálogo, sem gesto: `contains` apenas consulta.
 * A reabertura do popup usa isto para recuperar o estado depois de "demora".
 */
export async function statusDoApp(opcoes?: {
  api?: ApiChrome;
  prazoMs?: number;
}): Promise<ResultadoStatus> {
  const api = opcoes?.api ?? apiChromePadrao();
  if (api === undefined) return { resultado: "erro" };

  let tem: boolean;
  try {
    tem = await api.permissions.contains({ permissions: [PERMISSAO] });
  } catch {
    // `contains` não deveria lançar; se lançar, o estado da permissão é
    // desconhecido — e "sem-permissao" seria afirmação que não podemos fazer.
    return { resultado: "erro" };
  }
  if (tem !== true) return { resultado: "sem-permissao" };

  return falarComHost(api, {
    cmd: "status",
    prazoMs: opcoes?.prazoMs ?? PRAZO_STATUS_MS,
    interpretar: interpretarStatus,
    semResposta: {
      hostAusente: { resultado: "host-ausente" },
      demora: { resultado: "demora" },
      erro: { resultado: "erro" },
    },
  });
}

/**
 * O `chrome` do ambiente, se existir. Fora do navegador (teste) não existe,
 * e as funções públicas devolvem `"erro"` — nunca lançam por causa disso.
 */
function apiChromePadrao(): ApiChrome | undefined {
  return (globalThis as { chrome?: ApiChrome }).chrome;
}
