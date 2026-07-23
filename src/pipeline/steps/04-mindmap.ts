import fs from "node:fs";
import { runClaude, stripFences } from "@/pipeline/lib/claude-cli";
import { mindmapPrompt, validateMindmap } from "@/pipeline/prompts/mindmap";
import { artifactPaths } from "@/pipeline/lib/paths";
import { recordArtifact } from "@/pipeline/lib/artifacts";
import type { VideoMetadata } from "@/pipeline/types";

/**
 * Etapa 4 — mapa mental (markdown hierárquico) via `claude -p`.
 * O validador garante a estrutura mínima; markmap nunca crasha com markdown feio.
 * Grava mindmap.md.
 */
export async function runMindmap(
  meta: VideoMetadata,
  transcriptText: string,
): Promise<string> {
  const raw = await runClaude({
    prompt: mindmapPrompt(meta),
    stdin: transcriptText,
    model: "sonnet",
  });

  const md = validateMindmap(stripFences(raw));
  const paths = artifactPaths(meta.id);
  fs.writeFileSync(paths.mindmap, md.trim() + "\n");
  recordArtifact(meta.id, "mindmap_md", paths.mindmap);
  return md;
}
