import fs from "node:fs";
import { runClaude } from "@/pipeline/lib/claude-cli";
import { summaryPrompt } from "@/pipeline/prompts/summary";
import { artifactPaths } from "@/pipeline/lib/paths";
import { recordArtifact } from "@/pipeline/lib/artifacts";
import type { VideoMetadata } from "@/pipeline/types";

/** Etapa 3 — resumo executivo PT-BR via `claude -p`. Grava summary.md. */
export async function runSummary(
  meta: VideoMetadata,
  transcriptText: string,
): Promise<string> {
  const summary = await runClaude({
    prompt: summaryPrompt(meta),
    stdin: transcriptText,
    model: "sonnet",
  });

  const paths = artifactPaths(meta.id);
  fs.writeFileSync(paths.summary, summary.trim() + "\n");
  recordArtifact(meta.id, "summary_md", paths.summary);
  return summary;
}
