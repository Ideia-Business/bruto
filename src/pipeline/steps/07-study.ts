import fs from "node:fs";
import path from "node:path";
import { runClaude, stripFences } from "@/pipeline/lib/claude-cli";
import { studyPrompt } from "@/pipeline/prompts/study";
import { artifactPaths } from "@/pipeline/lib/paths";
import { recordArtifact } from "@/pipeline/lib/artifacts";
import type { VideoMetadata } from "@/pipeline/types";

/**
 * Gera a aula didática ("Estudar") a partir da transcrição, via `claude -p`.
 * Sob demanda (acionada pela rota quando o usuário pede) — não roda no pipeline
 * padrão, já que é opcional e mais pesada. Grava study.md e registra o artefato.
 */
export async function runStudy(
  meta: VideoMetadata,
  transcriptText: string,
): Promise<string> {
  const raw = await runClaude({
    prompt: studyPrompt(meta),
    stdin: transcriptText,
    model: "sonnet",
    timeoutMs: 240_000,
  });

  const md = stripFences(raw).trim();
  const outPath = path.join(artifactPaths(meta.id).dir, "study.md");
  fs.writeFileSync(outPath, md + "\n");
  recordArtifact(meta.id, "study_md", outPath);
  return md;
}
