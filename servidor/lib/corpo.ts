/**
 * Leitura de corpo com teto de bytes, no fluxo — mesma doutrina de
 * `lerCorpoLimitado` em `src/lib/endpoint-local.ts`: `Content-Length` é
 * conveniência (pode faltar ou mentir), o corte de verdade é ler aos pedaços e
 * abortar no primeiro byte acima do limite. Reimplementado aqui (em vez de
 * importar) porque o teto deste servidor é outro (200 KB, não 1 MB) e a
 * resposta de erro usa o formato deste contrato (`{ erro }`, não `{ error }`).
 */
export type LeituraCorpo =
  | { ok: true; texto: string }
  | { ok: false; motivo: "grande_demais" | "falha_leitura" };

export async function lerCorpoComTeto(req: Request, limite: number): Promise<LeituraCorpo> {
  const anunciado = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(anunciado) && anunciado > limite) {
    return { ok: false, motivo: "grande_demais" };
  }

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
        await leitor.cancel().catch(() => {});
        return { ok: false, motivo: "grande_demais" };
      }
      partes.push(value);
    }
  } catch {
    return { ok: false, motivo: "falha_leitura" };
  }

  return { ok: true, texto: Buffer.concat(partes).toString("utf8") };
}
