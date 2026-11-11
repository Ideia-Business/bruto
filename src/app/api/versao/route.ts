/**
 * GET /api/versao → {"app":"bruto","versao":<version do package.json>,"origem":"pacote"|"clone"}
 *
 * O contrato entre o app (W2) e o lançador do Bruto.app (W1): é com esta rota
 * que o lançador decide se o servidor que já responde na porta é o pacote, o
 * clone antigo, e se a versão bate. Leitura pública local — sem a guarda de
 * "chamada de cliente": não tem efeito, não tem custo e não expõe dado
 * sensível (ver contrato-instalador.md).
 */
import { NextResponse } from "next/server";
import { modoPacote } from "@/pipeline/lib/ferramentas";
import { versaoDoApp } from "@/lib/versao";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    app: "bruto",
    versao: versaoDoApp(),
    origem: modoPacote() ? "pacote" : "clone",
  });
}
