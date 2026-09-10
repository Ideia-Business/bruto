/**
 * Chamada HTTP compartilhada pelos provedores de API.
 *
 * Existe por um motivo de segurança, não de conveniência: é aqui que o corpo da
 * resposta de erro é **descartado** em vez de propagado. O código anterior
 * concatenava a saída bruta do fornecedor na mensagem da exceção, e essa
 * mensagem vira `jobs.error_message` no banco. Com chave do usuário em jogo,
 * isso é vazamento. Quem classifica o erro é o STATUS, não o texto.
 */

import { redact } from "../redact";

/** Erro de transporte com o status preservado, para o `runLLM` classificar. */
export class LlmHttpError extends Error {
  readonly status: number;
  constructor(status: number, detalhe: string) {
    super(detalhe);
    this.name = "LlmHttpError";
    this.status = status;
  }
}

export interface PostJsonOpts {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  timeoutMs: number;
  /** Nome do fornecedor, só para a mensagem de erro. */
  label: string;
}

export async function postJson(opts: PostJsonOpts): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);

  let res: Response;
  try {
    res = await fetch(opts.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...opts.headers },
      body: JSON.stringify(opts.body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === "AbortError") {
      throw new LlmHttpError(408, `tempo esgotado após ${opts.timeoutMs}ms`);
    }
    // Falha de rede: a mensagem pode trazer host e proxy, nunca a chave — mas
    // redigimos assim mesmo, porque o custo é zero e a garantia é absoluta.
    throw new LlmHttpError(
      0,
      `não foi possível falar com ${opts.label}: ${redact(err instanceof Error ? err.message : String(err))}`,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    // O corpo do erro pode ecoar o request inteiro — inclusive o header de
    // autenticação em alguns proxies. Só o status atravessa esta fronteira.
    throw new LlmHttpError(res.status, `${opts.label} respondeu ${res.status}`);
  }

  try {
    return (await res.json()) as unknown;
  } catch {
    throw new LlmHttpError(res.status, `${opts.label} devolveu uma resposta ilegível`);
  }
}

/** Lê um caminho aninhado da resposta, sem confiar no formato. */
export function extrairTexto(
  json: unknown,
  caminho: (raiz: Record<string, unknown>) => unknown,
  label: string,
): string {
  if (typeof json !== "object" || json === null) {
    throw new Error(`${label} devolveu um corpo inesperado`);
  }
  const valor = caminho(json as Record<string, unknown>);
  if (typeof valor !== "string" || valor.trim() === "") {
    throw new Error(`${label} devolveu uma resposta sem texto`);
  }
  return valor;
}
