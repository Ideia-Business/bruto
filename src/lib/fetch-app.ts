/**
 * Toda chamada do front à API do próprio app passa por aqui.
 *
 * O único trabalho é carimbar `X-Bruto-Cliente: app`, que as rotas com efeito
 * exigem (ver `recusarSeNaoForClienteConhecido` em `endpoint-local.ts`). Existe
 * como helper, e não como cabeçalho repetido em onze chamadas, porque lista
 * duplicada em onze lugares é lista que diverge — foi assim que a lista de
 * variáveis sensíveis quase deixou uma chave passar.
 */
export function fetchApp(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("X-Bruto-Cliente", "app");
  return fetch(url, { ...init, headers });
}
