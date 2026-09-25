import fs from "node:fs";
import { runLLMText, stripFences } from "@/pipeline/lib/llm";
import { transcriptOrganizedPrompt } from "@/pipeline/prompts/transcript-organized";
import { transcriptLlmPrompt } from "@/pipeline/prompts/transcript-llm";
import { artifactPaths } from "@/pipeline/lib/paths";
import { recordArtifact } from "@/pipeline/lib/artifacts";
import type { VideoMetadata } from "@/pipeline/types";

/**
 * Gera a "Transcrição organizada" (leitura humana) — reorganiza por assunto
 * sem cortar conteúdo. Sob demanda, como a Aula (`07-study.ts`). Grava
 * transcript-organizada.md e registra o artefato.
 */
export async function runTranscriptOrganized(
  meta: VideoMetadata,
  transcriptText: string,
): Promise<string> {
  const raw = await runLLMText({
    task: "transcript_organized",
    prompt: transcriptOrganizedPrompt(meta),
    input: transcriptText,
    tier: "balanced",
    timeoutMs: 240_000,
  });
  const md = stripFences(raw).trim();

  const outPath = artifactPaths(meta.id).transcriptOrganized;
  fs.writeFileSync(outPath, md + "\n");
  recordArtifact(meta.id, "transcript_organized_md", outPath);
  return md;
}

/**
 * Gera a "Transcrição para IA" — mesma reorganização, mas empacotada como
 * documento de contexto para colar em outra sessão de IA, com preâmbulo
 * moldado pelo propósito que a pessoa informou (ou o default, se ela não
 * disse nada). Não persiste por propósito: cada geração SUBSTITUI a anterior
 * (mesmo `kind`) — é uma ferramenta de uso pontual, não um histórico.
 */
export async function runTranscriptForLlm(
  meta: VideoMetadata,
  transcriptText: string,
  proposito: string,
): Promise<string> {
  const raw = await runLLMText({
    task: "transcript_llm",
    prompt: transcriptLlmPrompt(meta, proposito),
    input: transcriptText,
    tier: "balanced",
    timeoutMs: 240_000,
  });
  const md = stripFences(raw).trim();

  const outPath = artifactPaths(meta.id).transcriptLlm;
  fs.writeFileSync(outPath, md + "\n");
  recordArtifact(meta.id, "transcript_llm_md", outPath);
  return md;
}
