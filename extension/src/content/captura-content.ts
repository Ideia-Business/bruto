/**
 * Content script — a ponte entre o popup e a página do vídeo.
 *
 * O popup não roda no contexto da aba: ele não enxerga o DOM do YouTube nem
 * pode buscar a legenda de lá. Quem faz isso é este script, injetado na aba, e
 * a conversa entre os dois acontece por mensagem.
 *
 * Por que a resposta é um OBJETO com `ok`, e nunca uma exceção: exceção não
 * atravessa a fronteira de mensagem do Chrome — do outro lado chegaria só uma
 * string genérica, e o popup perderia o `codigo` que decide qual orientação
 * mostrar ("sem legenda" pede uma coisa, "não é YouTube" pede outra). Então o
 * erro é serializado à mão, de propósito.
 *
 * Este arquivo é empacotado como IIFE, não como módulo ES: o
 * `chrome.scripting.executeScript({ files })` não carrega módulo.
 */

import { capturarLegenda, CapturaError } from "../lib/captura";

/** O mesmo formato que o popup espera em `RespostaCaptura`. */
type Resposta =
  | { ok: true; bruto: Awaited<ReturnType<typeof capturarLegenda>> }
  | { ok: false; codigo: CapturaError["codigo"]; message: string };

async function responder(): Promise<Resposta> {
  try {
    return { ok: true, bruto: await capturarLegenda() };
  } catch (err) {
    if (err instanceof CapturaError) {
      return { ok: false, codigo: err.codigo, message: err.message };
    }
    return {
      ok: false,
      codigo: "FALHA",
      message:
        err instanceof Error
          ? err.message
          : "Não deu para ler a legenda desta página. Recarregue a aba e tente de novo.",
    };
  }
}

chrome.runtime.onMessage.addListener((msg: unknown, _remetente, enviarResposta) => {
  if (typeof msg !== "object" || msg === null) return undefined;
  if ((msg as { tipo?: unknown }).tipo !== "bruto:capturar") return undefined;

  // `true` mantém o canal aberto para a resposta assíncrona. Sem isso o Chrome
  // fecha o canal ao fim do listener e o popup recebe `undefined`.
  void responder().then(enviarResposta);
  return true;
});
