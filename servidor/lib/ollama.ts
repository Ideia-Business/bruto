/**
 * Chamada ao Ollama Cloud para o modo grátis — a ÚNICA rota autorizada a usar
 * `OLLAMA_API_KEY`. O contrato (`servidor/CONTRATO.md`) é normativo:
 *
 *   POST https://ollama.com/v1/chat/completions
 *   Authorization: Bearer $OLLAMA_API_KEY
 *   model: BRUTO_MODELO (padrão gpt-oss:120b)
 *   system: studyPrompt(meta) · user: transcrição · max_tokens: 8000 · timeout: 170 s
 *
 * DUAS REGRAS QUE NÃO SE NEGOCIAM (contrato, "O que nunca vai para log"):
 * nem a chave, nem o corpo recebido (transcrição, título, canal) aparecem
 * numa mensagem de erro — as mensagens abaixo são todas genéricas, e o `catch`
 * nunca interpola `err.message` de uma falha de rede/parse que poderia
 * carregar fragmento do que foi enviado.
 */
import { studyPrompt, type MetaDaAula } from "../../src/pipeline/prompts/study";

const ENDPOINT_OLLAMA = "https://ollama.com/v1/chat/completions";
export const MODELO_PADRAO = "gpt-oss:120b";
const MAX_TOKENS = 8000;
const TIMEOUT_MS = 170_000;

/** Teto do corpo de resposta do Ollama (JSON inteiro) lido do fluxo — generoso, mas finito. */
const TETO_RESPOSTA_BYTES = 2_000_000;

/** Teto da aula devolvida ao cliente (contrato: "limitar a 200 KB antes de devolver"). */
export const TETO_AULA_BYTES = 200_000;

export type MotivoFalhaOllama = "timeout" | "rede" | "http" | "resposta_invalida";

export type ResultadoOllama =
  | { ok: true; aula: string }
  | { ok: false; motivo: MotivoFalhaOllama };

export interface ChamarOllamaParams {
  meta: MetaDaAula;
  transcricao: string;
  apiKey: string;
  modelo?: string;
  /** Injetável para teste — nunca chama rede de verdade fora de produção. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Lê um `Response` até `limite` bytes, cancelando o restante do fluxo ao
 * estourar — mesma doutrina de `lerCorpoLimitado` (`src/lib/endpoint-local.ts`):
 * `Content-Length` é conveniência, o corte de verdade é na leitura.
 */
async function lerCorpoComTeto(resposta: Response, limite: number): Promise<string | null> {
  const anunciado = Number(resposta.headers.get("content-length") ?? "0");
  if (Number.isFinite(anunciado) && anunciado > limite) return null;

  if (!resposta.body) return await resposta.text();

  const leitor = resposta.body.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await leitor.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > limite) {
        await leitor.cancel().catch(() => {});
        return null;
      }
      partes.push(value);
    }
  } catch {
    return null;
  }
  return Buffer.concat(partes).toString("utf8");
}

function ehObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Extrai o texto da aula do corpo de `chat/completions` (formato OpenAI-compatível
 * que o Ollama Cloud implementa): `choices[0].message.content`. Qualquer outra
 * forma vira `resposta_invalida` — nunca se tenta "adivinhar" outro campo.
 */
function extrairTexto(json: unknown): string | null {
  if (!ehObjeto(json)) return null;
  const escolhas = json.choices;
  if (!Array.isArray(escolhas) || escolhas.length === 0) return null;
  const primeira = escolhas[0];
  if (!ehObjeto(primeira)) return null;
  const mensagem = primeira.message;
  if (!ehObjeto(mensagem)) return null;
  const conteudo = mensagem.content;
  if (typeof conteudo !== "string" || conteudo.trim() === "") return null;
  return conteudo;
}

/**
 * Chama o Ollama e devolve a aula em markdown, ou um motivo de falha genérico.
 * Nunca lança — quem chama decide o status HTTP (502) e devolve a unidade de
 * cota, sem precisar de `try/catch` no handler.
 */
export async function chamarOllama(params: ChamarOllamaParams): Promise<ResultadoOllama> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const modelo = params.modelo ?? MODELO_PADRAO;
  const timeoutMs = params.timeoutMs ?? TIMEOUT_MS;

  const relogio = new AbortController();
  const corte = setTimeout(() => relogio.abort(), timeoutMs);

  let resposta: Response;
  try {
    resposta = await fetchImpl(ENDPOINT_OLLAMA, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${params.apiKey}`,
      },
      body: JSON.stringify({
        model: modelo,
        max_tokens: MAX_TOKENS,
        messages: [
          { role: "system", content: studyPrompt(params.meta) },
          { role: "user", content: params.transcricao },
        ],
      }),
      signal: relogio.signal,
    });
  } catch (err) {
    clearTimeout(corte);
    // AbortError de timeout tem uma causa distinta de um erro de rede comum,
    // mas nenhuma das duas mensagens carrega nada do que foi enviado.
    const foiAbort = err instanceof Error && err.name === "AbortError";
    return { ok: false, motivo: foiAbort ? "timeout" : "rede" };
  }
  clearTimeout(corte);

  if (!resposta.ok) {
    return { ok: false, motivo: "http" };
  }

  const bruto = await lerCorpoComTeto(resposta, TETO_RESPOSTA_BYTES);
  if (bruto === null) return { ok: false, motivo: "resposta_invalida" };

  let json: unknown;
  try {
    json = JSON.parse(bruto);
  } catch {
    return { ok: false, motivo: "resposta_invalida" };
  }

  const texto = extrairTexto(json);
  if (texto === null) return { ok: false, motivo: "resposta_invalida" };

  const aula = texto.length > TETO_AULA_BYTES ? texto.slice(0, TETO_AULA_BYTES) : texto;
  return { ok: true, aula };
}
