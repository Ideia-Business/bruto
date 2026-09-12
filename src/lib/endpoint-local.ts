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
 * Lê o corpo respeitando o teto. Confere o `Content-Length` anunciado E o
 * tamanho real do que chegou — o cabeçalho é informação de quem chama, e quem
 * chama pode mentir.
 */
export async function lerCorpoLimitado(
  req: Request,
): Promise<{ ok: true; texto: string } | { ok: false; resposta: NextResponse }> {
  const anunciado = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(anunciado) && anunciado > LIMITE_CORPO_BYTES) {
    return {
      ok: false,
      resposta: NextResponse.json({ error: "Corpo grande demais." }, { status: 413 }),
    };
  }
  const texto = await req.text();
  if (Buffer.byteLength(texto, "utf8") > LIMITE_CORPO_BYTES) {
    return {
      ok: false,
      resposta: NextResponse.json({ error: "Corpo grande demais." }, { status: 413 }),
    };
  }
  return { ok: true, texto };
}
