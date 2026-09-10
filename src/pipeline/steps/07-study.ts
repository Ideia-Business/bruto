import fs from "node:fs";
import path from "node:path";
import { runLLMText, stripFences } from "@/pipeline/lib/llm";
import { studyPrompt } from "@/pipeline/prompts/study";
import { referencesPrompt } from "@/pipeline/prompts/references";
import { artifactPaths } from "@/pipeline/lib/paths";
import { recordArtifact } from "@/pipeline/lib/artifacts";
import { PipelineError } from "@/pipeline/types";
import type { VideoMetadata } from "@/pipeline/types";

/**
 * Referências reais buscadas na web. Best-effort por desenho: a Aula nunca
 * depende disto, e nenhuma falha aqui derruba a geração.
 *
 * O que mudou com a camada multi-provedor: quando o provedor configurado não
 * faz busca web (hoje, só o Claude CLI faz), a ausência é **declarada na
 * própria aula** em vez de sumir. Degradar é legítimo; degradar calado não é —
 * quem lê precisa saber que a seção não existe por limitação da configuração,
 * não por não haver o que citar.
 */
type ResultadoReferencias =
  | { tipo: "ok"; markdown: string }
  | { tipo: "sem-capacidade"; motivo: string }
  | { tipo: "vazio" };

async function fetchWebReferences(
  meta: VideoMetadata,
  context: string,
): Promise<ResultadoReferencias> {
  try {
    const raw = await runLLMText({
      task: "references",
      prompt: referencesPrompt(meta),
      input: context.slice(0, 4000),
      tier: "balanced",
      requires: ["webSearch"],
      timeoutMs: 150_000,
    });
    const md = stripFences(raw).trim();
    // Precisa parecer uma lista de links reais; senão descarta.
    if (!md || /^NENHUMA$/i.test(md) || !/\]\(https?:\/\//.test(md)) return { tipo: "vazio" };
    const items = md
      .split("\n")
      .filter((l) => /^\s*[-*]\s+\[.+\]\(https?:\/\/.+\)/.test(l))
      .join("\n");
    return items ? { tipo: "ok", markdown: items } : { tipo: "vazio" };
  } catch (err) {
    if (err instanceof PipelineError && err.code === "LLM_CAPABILITY") {
      return { tipo: "sem-capacidade", motivo: err.message };
    }
    // Qualquer outra falha (rede, cota, timeout) segue sendo silenciosa: a
    // seção é acessória e tentar de novo não é responsabilidade da Aula.
    return { tipo: "vazio" };
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
  const raw = await runLLMText({
      task: "study",
    prompt: studyPrompt(meta),
    input: transcriptText,
    tier: "balanced",
    timeoutMs: 240_000,
  });
  let md = stripFences(raw).trim();

  // Referências reais da web (best-effort) — usa o início da aula como contexto.
  const refs = await fetchWebReferences(meta, md.slice(0, 4000));
  if (refs.tipo === "ok") {
    md +=
      "\n\n### 🔗 Referências na web (verificadas)\n\n" +
      "Links reais encontrados por busca — confira data e autoria antes de citar.\n\n" +
      refs.markdown +
      "\n";
  } else if (refs.tipo === "sem-capacidade") {
    md += `\n\n> **Referências omitidas.** ${refs.motivo} A aula acima está completa; só a lista de links externos não foi gerada.\n`;
  }

  const outPath = path.join(artifactPaths(meta.id).dir, "study.md");
  fs.writeFileSync(outPath, md + "\n");
  recordArtifact(meta.id, "study_md", outPath);
  return md;
}
