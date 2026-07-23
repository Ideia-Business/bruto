import fs from "node:fs";
import path from "node:path";
import { runClaude, stripFences } from "@/pipeline/lib/claude-cli";
import { studyPrompt } from "@/pipeline/prompts/study";
import { referencesPrompt } from "@/pipeline/prompts/references";
import { artifactPaths } from "@/pipeline/lib/paths";
import { recordArtifact } from "@/pipeline/lib/artifacts";
import type { VideoMetadata } from "@/pipeline/types";

/**
 * Busca referências REAIS na web (WebSearch) sobre o tema. Best-effort: qualquer
 * falha retorna null e a aula segue sem a subseção — nunca derruba a geração.
 */
async function fetchWebReferences(
  meta: VideoMetadata,
  context: string,
): Promise<string | null> {
  try {
    const raw = await runClaude({
      prompt: referencesPrompt(meta),
      stdin: context.slice(0, 4000),
      model: "sonnet",
      allowedTools: ["WebSearch"],
      timeoutMs: 150_000,
    });
    const md = stripFences(raw).trim();
    // Precisa parecer uma lista de links reais; senão descarta.
    if (!md || /^NENHUMA$/i.test(md) || !/\]\(https?:\/\//.test(md)) return null;
    // Mantém só as linhas que são itens de lista com link.
    const items = md
      .split("\n")
      .filter((l) => /^\s*[-*]\s+\[.+\]\(https?:\/\/.+\)/.test(l))
      .join("\n");
    return items || null;
  } catch {
    return null;
  }
}

/**
 * Gera a aula didática ("Estudar") a partir da transcrição, via `claude -p`.
 * Sob demanda (acionada pela rota) — opcional e mais pesada. Enriquece a aula
 * com referências reais buscadas na web. Grava study.md e registra o artefato.
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
  let md = stripFences(raw).trim();

  // Referências reais da web (best-effort) — usa o início da aula como contexto.
  const refs = await fetchWebReferences(meta, md.slice(0, 4000));
  if (refs) {
    md +=
      "\n\n### 🔗 Referências na web (verificadas)\n\n" +
      "Links reais encontrados por busca — confira data e autoria antes de citar.\n\n" +
      refs +
      "\n";
  }

  const outPath = path.join(artifactPaths(meta.id).dir, "study.md");
  fs.writeFileSync(outPath, md + "\n");
  recordArtifact(meta.id, "study_md", outPath);
  return md;
}
