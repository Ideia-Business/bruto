import { cabecalhosCors } from "./cors";

/** Toda resposta JSON do servidor sai por aqui — CORS e content-type num lugar só. */
export function respostaJson(status: number, corpo: unknown, origem: string | null): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: {
      "content-type": "application/json",
      ...cabecalhosCors(origem),
    },
  });
}

export function erroJson(status: number, erro: string, origem: string | null, extra?: Record<string, unknown>): Response {
  return respostaJson(status, { erro, ...extra }, origem);
}
