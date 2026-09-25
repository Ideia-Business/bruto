import fs from "node:fs";
import { NextResponse } from "next/server";
import {
  lerJsonLimitado,
  LIMITE_CORPO_PEQUENO,
  recusarSeNaoForChamadaDeCliente,
} from "@/lib/endpoint-local";
import { getBrutoById } from "@/db/queries";
import { artifactPaths } from "@/pipeline/lib/paths";
import { runTranscriptForLlm } from "@/pipeline/steps/08-transcript-variants";
import { PROPOSITO_PADRAO } from "@/pipeline/prompts/transcript-llm";
import { PipelineError } from "@/pipeline/types";
import { ERROR_HINT } from "@/lib/format";

/** Teto de tamanho do propósito — é uma frase, não um texto. */
const PROPOSITO_MAX = 500;

// Geração pode levar ~30-120s, igual à Aula; sem cache.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/videos/[id]/transcript-llm { proposito? } → monta o documento de
 * contexto pronto para colar em outra IA, sob demanda. `proposito` é opcional
 * — sem ele, usa `PROPOSITO_PADRAO`. Síncrona, como a Aula e a Transcrição
 * organizada.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const recusa = recusarSeNaoForChamadaDeCliente(req);
  if (recusa) return recusa;

  const { id } = await params;
  const video = getBrutoById(id);
  if (!video) return NextResponse.json({ error: "Vídeo não encontrado" }, { status: 404 });

  const lido = await lerJsonLimitado(req, LIMITE_CORPO_PEQUENO);
  if (!lido.ok) return lido.resposta;
  const body = (lido.dados ?? {}) as { proposito?: string };
  const proposito =
    typeof body.proposito === "string" ? body.proposito.trim().slice(0, PROPOSITO_MAX) : "";

  const paths = artifactPaths(id);
  if (!fs.existsSync(paths.infoJson) || !fs.existsSync(paths.transcript)) {
    return NextResponse.json(
      { error: "Transcrição indisponível — reprocesse o vídeo antes de gerar o contexto." },
      { status: 409 },
    );
  }

  const meta = JSON.parse(fs.readFileSync(paths.infoJson, "utf8"));
  const transcript = fs.readFileSync(paths.transcript, "utf8");

  try {
    const md = await runTranscriptForLlm(meta, transcript, proposito || PROPOSITO_PADRAO);
    return NextResponse.json({ ok: true, transcriptLlmMd: md });
  } catch (err) {
    const code = err instanceof PipelineError ? err.code : "UNKNOWN";
    return NextResponse.json(
      { error: ERROR_HINT[code] ?? "Falha ao gerar o contexto para IA." },
      { status: 500 },
    );
  }
}
