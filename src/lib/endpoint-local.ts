/**
 * Guardas do endpoint local que a extensão chama (`/api/llm*`).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE NÃO HÁ NENHUM CABEÇALHO CORS AQUI — E NÃO É ESQUECIMENTO
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Este endpoint gasta a ASSINATURA da pessoa: cada chamada consome o plano
 * Claude ou ChatGPT dela. Se ele respondesse com `Access-Control-Allow-Origin`,
 * qualquer página aberta no navegador — um site qualquer, num separador
 * esquecido — poderia chamá-lo em laço e queimar a assinatura, sem que ela
 * visse nada acontecer.
 *
 * A extensão NÃO precisa de CORS: ela chama de dentro do service worker, com
 * `host_permissions`, e esse caminho não passa pela verificação de origem do
 * navegador. Uma página comum passa — e o navegador nega antes de a resposta
 * chegar ao script dela.
 *
 * Ou seja: **a ausência de CORS é o controle de acesso.** Não é uma pendência.
 * Acrescentar `Access-Control-Allow-Origin`, mesmo que "só para testar", mesmo
 * que restrito a uma origem, abre exatamente o buraco que este desenho fecha.
 * Pelo mesmo motivo não existe handler de `OPTIONS`: sem ele, o preflight de
 * uma página comum morre em 405 e a requisição nunca chega ao modelo.
 *
 * Segunda trava, independente da primeira: só se atende requisição cujo `Host`
 * seja de loopback. Isso barra o acesso pelo IP da máquina na rede local (o
 * vizinho de wifi) e o DNS rebinding, em que um domínio de fora resolve para
 * 127.0.0.1 e a página passa a falar com este servidor como se fosse local —
 * caminho que o navegador considera same-origin e que CORS nenhum impediria.
 */
import { NextResponse } from "next/server";

/**
 * Teto do corpo. `input` carrega transcrição inteira — de um vídeo longo dá
 * algumas centenas de KB —, e é entrada vinda de fora do processo. 1 MB cobre
 * o caso real com folga e impede que alguém encha a memória do servidor.
 */
export const LIMITE_CORPO_BYTES = 1_000_000;

/**
 * Teto das rotas de mutação comuns, cujo corpo é um punhado de campos curtos
 * (uma url, um nome, uma lista de ids). 1 MB ali seria folga sem propósito: o
 * teto certo é o menor que ainda cabe o caso real.
 */
export const LIMITE_CORPO_PEQUENO = 16_000;

/** Hosts aceitos: só a própria máquina. Porta livre (3000, 3999, o que for). */
function hostEhLoopback(host: string | null): boolean {
  if (!host) return false;
  const semPorta = host.replace(/:\d+$/, "").toLowerCase();
  return semPorta === "127.0.0.1" || semPorta === "localhost" || semPorta === "[::1]" || semPorta === "::1";
}

/**
 * Devolve uma resposta de recusa quando a requisição não é local, ou `null`
 * quando pode seguir. Use no começo de todo handler destes endpoints.
 */
export function recusarSeNaoForLocal(req: Request): NextResponse | null {
  if (hostEhLoopback(req.headers.get("host"))) return null;
  return NextResponse.json({ error: "Este endpoint só atende a máquina local." }, { status: 403 });
}

/**
 * Clientes que este app atende. O valor não é segredo nem autenticação — ele
 * existe porque **um cabeçalho fora da lista de seguros obriga o navegador a
 * fazer preflight**, e o preflight morre aqui por não haver cabeçalho de origem
 * nenhum para autorizá-lo.
 */
export const CLIENTES_CONHECIDOS = ["app", "extensao"];

/**
 * A guarda das rotas com EFEITO ou CUSTO — a porta por onde toda mutação passa.
 *
 * Por que não basta a ausência de CORS: um POST simples (corpo `text/plain`, ou
 * sem corpo nenhum) sai do navegador SEM preflight. A página não lê a resposta,
 * mas o efeito já aconteceu. Medido nesta lane, antes desta guarda existir: um
 * POST `text/plain` com `Origin` de outro site criou um filão de verdade
 * ("INVADIDO pelo site", HTTP 201), e um POST em `/api/videos` chegou à
 * validação — ou seja, o corpo foi lido e processado.
 *
 * O `Content-Type: application/json` resolveria o caso do corpo, mas não o do
 * POST **sem corpo** (`retry`, `study`), onde não há tipo para exigir. Um
 * cabeçalho próprio cobre os dois, e cobre igual — daí ser este o critério
 * único, em vez de duas regras que divergem com o tempo.
 *
 * Rotas somente-leitura (catálogo, mídia, status de job) NÃO usam esta guarda:
 * não têm efeito nem custo, e travá-las quebraria coisa à toa.
 */
export function recusarSeNaoForClienteConhecido(req: Request): NextResponse | null {
  const cliente = req.headers.get("x-bruto-cliente");
  if (cliente && CLIENTES_CONHECIDOS.includes(cliente)) return null;
  return NextResponse.json(
    { error: "Cabeçalho X-Bruto-Cliente ausente ou desconhecido." },
    { status: 415 },
  );
}

/**
 * O que toda rota com efeito chama na primeira linha: é local **e** veio de um
 * cliente conhecido. Um lugar só, para não haver rota que lembre metade.
 */
export function recusarSeNaoForChamadaDeCliente(req: Request): NextResponse | null {
  return recusarSeNaoForLocal(req) ?? recusarSeNaoForClienteConhecido(req);
}

/**
 * Exige `Content-Type: application/json` — e isto é SEGURANÇA, não formalidade.
 *
 * A ausência de CORS impede que uma página LEIA a resposta. Não impede que ela
 * DISPARE a requisição: um POST cujo corpo vá como `text/plain` é, para o
 * navegador, uma "requisição simples" — vai sem preflight, o servidor executa, e
 * a página só não vê o que voltou. Num endpoint comum isso seria inócuo; aqui
 * significa que um site qualquer poderia queimar a assinatura da pessoa em laço,
 * sem nunca ler uma linha da resposta. `JSON.parse` não olha o cabeçalho, então
 * o corpo `text/plain` seria aceito de bom grado.
 *
 * `application/json` não está na lista de tipos que dispensam preflight. Ao
 * exigi-lo, toda tentativa de página vira preflight — e o preflight morre, por
 * não haver cabeçalho de origem nenhum para autorizá-lo. A extensão, que fala
 * do service worker com `host_permissions`, não passa por nada disso.
 */
export function recusarSeNaoForJson(req: Request): NextResponse | null {
  const tipo = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (tipo === "application/json") return null;
  return NextResponse.json(
    { error: "Content-Type tem de ser application/json." },
    { status: 415 },
  );
}

/**
 * Lê o corpo respeitando o teto — **lendo aos pedaços e abortando ao passar**.
 *
 * A versão anterior conferia o `Content-Length` e depois chamava `req.text()`.
 * Isso limitava o que era ANUNCIADO, não o que era CONSUMIDO: num corpo
 * `chunked` não há `Content-Length`, e o `req.text()` bufferizava tudo antes de
 * qualquer checagem. Medido antes do conserto, com 300 MB enviados a este
 * endpoint: o servidor aceitou 314 MB e o RSS do processo foi de 746 MB para
 * 1486 MB — e só então devolveu o 413. O teto existia no papel; a memória subia
 * do mesmo jeito.
 *
 * Agora o fluxo é consumido pedaço a pedaço e o laço para no primeiro byte
 * acima do limite, cancelando a leitura. O `Content-Length` continua sendo
 * conferido antes de tudo, porque quando ele existe e é honesto evita começar
 * uma leitura que se sabe grande demais — mas ele é conveniência, não a trava.
 */
export async function lerCorpoLimitado(
  req: Request,
  limite: number = LIMITE_CORPO_BYTES,
): Promise<{ ok: true; texto: string } | { ok: false; resposta: NextResponse }> {
  const grandeDemais = () => ({
    ok: false as const,
    resposta: NextResponse.json({ error: "Corpo grande demais." }, { status: 413 }),
  });

  const anunciado = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(anunciado) && anunciado > limite) return grandeDemais();

  if (!req.body) return { ok: true, texto: "" };

  const leitor = req.body.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await leitor.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > limite) {
        // Nada mais é acumulado, e o resto do upload deixa de ser lido.
        await leitor.cancel().catch(() => {});
        return grandeDemais();
      }
      partes.push(value);
    }
  } catch {
    return {
      ok: false,
      resposta: NextResponse.json({ error: "Falha ao ler o corpo." }, { status: 400 }),
    };
  }

  return { ok: true, texto: Buffer.concat(partes).toString("utf8") };
}

/**
 * Lê e desserializa o corpo respeitando o teto — o que toda rota que recebe
 * JSON deve usar, em vez de `req.json()` cru.
 *
 * O `req.json()` bufferiza o corpo inteiro antes de qualquer checagem, que é a
 * mesma falha medida em `/api/llm` (300 MB aceitos, RSS de 746 MB para 1486 MB).
 * O helper existia e estava aplicado num lugar só; as rotas de mutação ficaram
 * com o defeito por mais uma rodada. Conserto de caso, classe aberta — de novo.
 */
export async function lerJsonLimitado(
  req: Request,
  limite: number = LIMITE_CORPO_BYTES,
): Promise<{ ok: true; dados: unknown } | { ok: false; resposta: NextResponse }> {
  const lido = await lerCorpoLimitado(req, limite);
  if (!lido.ok) return lido;
  try {
    return { ok: true, dados: JSON.parse(lido.texto) };
  } catch {
    return {
      ok: false,
      resposta: NextResponse.json({ error: "JSON inválido" }, { status: 400 }),
    };
  }
}
