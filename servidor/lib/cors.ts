/**
 * CORS do modo grátis — regra única, usada tanto no preflight (`OPTIONS`)
 * quanto nas respostas reais (`GET`/`POST`): sem o cabeçalho na resposta real,
 * o preflight passaria e a extensão ainda assim não conseguiria LER o corpo.
 *
 * Contrato (`servidor/CONTRATO.md`, seção OPTIONS): `Access-Control-Allow-Origin`
 * ecoa a origem só quando ela começa com `chrome-extension://`; qualquer outra
 * origem (inclusive `https://` qualquer) não recebe cabeçalho CORS nenhum —
 * nem "allow" nem "deny" explícito, apenas ausência, que é o que faz o
 * navegador recusar por conta própria.
 */
const ORIGEM_PERMITIDA = /^chrome-extension:\/\//;

export function cabecalhosCors(origem: string | null): Record<string, string> {
  if (!origem || !ORIGEM_PERMITIDA.test(origem)) return {};
  return {
    "access-control-allow-origin": origem,
    "access-control-allow-headers": "content-type, x-bruto-cliente, x-bruto-instalacao",
    "access-control-allow-methods": "GET, POST, OPTIONS",
  };
}

/** Resposta de preflight — 204 sempre; os cabeçalhos CORS são o único sinal. */
export function respostaPreflight(req: Request): Response {
  return new Response(null, {
    status: 204,
    headers: cabecalhosCors(req.headers.get("origin")),
  });
}
