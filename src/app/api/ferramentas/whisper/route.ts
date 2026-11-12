/**
 * O pedido de Whisper do modo pacote (contrato: "o Whisper só é instalado
 * quando a pessoa pede, com aviso de tamanho ~3,5 GB, modelo incluído").
 *
 *   GET  /api/ferramentas/whisper → { suportado, instalado }
 *        Leitura pública local (só filesystem, sem custo nem efeito).
 *   POST /api/ferramentas/whisper → instala o backend de transcrição com
 *        `"$BRUTO_UV" tool install mlx-whisper` e, com o Python do próprio
 *        venv, já baixa o modelo padrão (large-v3-turbo) — sem isso, o 1º
 *        vídeo parava ~1,6 GB de download depois, sem aviso. Mutação com
 *        efeito e custo (baixa ~3,5 GB no total): passa pela guarda padrão
 *        das mutações (`recusarSeNaoForChamadaDeCliente`). Falha vira 500
 *        com mensagem legível; duas chamadas concorrentes dividem UMA
 *        instalação (F3).
 *
 * Depois de instalar, rearma a detecção memoizada do transcribe — senão o
 * processo continuaria vendo "não instalado" até reiniciar.
 */
import { NextResponse } from "next/server";
import { recusarSeNaoForChamadaDeCliente } from "@/lib/endpoint-local";
import { instalarWhisper, modoPacote, whisperInstalado } from "@/pipeline/lib/ferramentas";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const suportado = modoPacote();
  return NextResponse.json({ suportado, instalado: suportado && whisperInstalado() });
}

export async function POST(req: Request): Promise<NextResponse> {
  const recusa = recusarSeNaoForChamadaDeCliente(req);
  if (recusa) return recusa;

  if (!modoPacote()) {
    return NextResponse.json(
      { error: "A instalação sob pedido só existe no app instalado (.app)." },
      { status: 400 },
    );
  }

  try {
    await instalarWhisper();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Falha ao instalar o Whisper." },
      { status: 500 },
    );
  }

  // A detecção do transcribe memoiza "não instalado" na primeira sonda —
  // sem rearmar, o próximo vídeo continuaria falhando até o app reiniciar.
  const { rearmarDeteccao } = await import("@/pipeline/lib/transcribe");
  rearmarDeteccao();

  return NextResponse.json({ ok: true });
}
