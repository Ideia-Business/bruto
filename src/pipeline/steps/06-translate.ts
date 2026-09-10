import fs from "node:fs";
import path from "node:path";
import { runLLMText } from "@/pipeline/lib/llm";
import { translatePrompt, chunkTranscript } from "@/pipeline/prompts/translate";
import { artifactPaths } from "@/pipeline/lib/paths";
import { recordArtifact } from "@/pipeline/lib/artifacts";
import type { VideoMetadata } from "@/pipeline/types";

/**
 * Etapa opcional — tradução completa da transcrição para PT-BR.
 * Acionada quando o vídeo não é português e o usuário pediu tradução.
 * Traduz em chunks (~20k chars) preservando timestamps e grava
 * transcript.pt-BR.txt (artifact transcript_translated).
 */
export async function runTranslate(
  meta: VideoMetadata,
  timestampedText: string,
  onTick?: (pct: number, detail: string) => void,
): Promise<string> {
  const tick = onTick ?? (() => {});
  const chunks = chunkTranscript(timestampedText);
  const translated: string[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const partInfo =
      chunks.length === 1 ? "o texto completo" : `a parte ${i + 1} de ${chunks.length}`;
    tick(Math.round((i / chunks.length) * 100), `Traduzindo ${partInfo}`);
    const out = await runLLMText({
      task: "translate",
      prompt: translatePrompt(meta.title, partInfo),
      input: chunks[i],
      tier: "balanced",
    });
    translated.push(out.trim());
  }

  const full = translated.join("\n\n");
  const paths = artifactPaths(meta.id);
  const outPath = path.join(paths.dir, "transcript.pt-BR.txt");
  fs.writeFileSync(outPath, full + "\n");
  recordArtifact(meta.id, "transcript_translated", outPath);
  tick(100, "Tradução concluída");
  return full;
}
