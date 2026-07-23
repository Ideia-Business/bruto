import fs from "node:fs";
import path from "node:path";
import { getArtifactById, getVideoById } from "@/db/queries";

/** Nome amigável do arquivo para download, por tipo de artefato. */
const DOWNLOAD_LABEL: Record<string, (title: string) => string> = {
  docx: (t) => `Resumo - ${t}.docx`,
  pdf: (t) => `Resumo - ${t}.pdf`,
  summary_md: (t) => `Resumo - ${t}.md`,
  study_md: (t) => `Aula - ${t}.md`,
  mindmap_md: (t) => `Mapa Mental - ${t}.md`,
  mindmap_svg: (t) => `Mapa Mental - ${t}.svg`,
  mindmap_png: (t) => `Mapa Mental - ${t}.png`,
  transcript: (t) => `Transcricao - ${t}.txt`,
  transcript_ts: (t) => `Transcricao (timestamps) - ${t}.txt`,
  transcript_translated: (t) => `Transcricao PT-BR - ${t}.txt`,
  info_json: (t) => `Metadados - ${t}.json`,
};

const MIME: Record<string, string> = {
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pdf": "application/pdf",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json; charset=utf-8",
};

function sanitize(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, "-").slice(0, 120);
}

/** GET /api/artifacts/[id] → download do arquivo com nome amigável. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const art = getArtifactById(id);
  if (!art || !fs.existsSync(art.filePath)) {
    return new Response("Artefato não encontrado", { status: 404 });
  }
  const video = getVideoById(art.videoId);
  const title = sanitize(video?.title ?? art.videoId);
  const labelFn = DOWNLOAD_LABEL[art.kind];
  const filename = sanitize(labelFn ? labelFn(title) : path.basename(art.filePath));
  const ext = path.extname(art.filePath).toLowerCase();

  const data = fs.readFileSync(art.filePath);
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": MIME[ext] ?? "application/octet-stream",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(data.length),
    },
  });
}
