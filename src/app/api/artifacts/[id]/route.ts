import fs from "node:fs";
import path from "node:path";
import { getArtifactById, getBrutoById } from "@/db/queries";

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
  return name.replace(/[/\\?%*:|"<>]/g, "-");
}

/**
 * Corta o nome pelo teto preservando a extensão. A versão antiga cortava a
 * STRING FINAL já com sufixo (`.docx` etc.) em 120 chars — com título longo
 * (111+ chars, comum em vídeo do TikTok ou depois de um PATCH de título), o
 * corte caía ANTES da extensão, que desaparecia inteira; docx/pdf/md do
 * mesmo vídeo colapsavam no mesmo nome truncado, e o loop de exportação
 * automática sobrescrevia um com o outro em silêncio — o toast ainda assim
 * anunciava sucesso pleno.
 */
export function comLimiteDeNome(nome: string, limite = 120): string {
  const ext = path.extname(nome);
  const base = ext ? nome.slice(0, nome.length - ext.length) : nome;
  const disponivel = Math.max(limite - ext.length, 1);
  return `${base.slice(0, disponivel)}${ext}`;
}

/** GET /api/artifacts/[id] → download do arquivo com nome amigável. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const art = getArtifactById(id);
  if (!art || !fs.existsSync(art.filePath)) {
    return new Response("Artefato não encontrado", { status: 404 });
  }
  const video = getBrutoById(art.videoId);
  const title = sanitize(video?.title ?? art.videoId);
  const labelFn = DOWNLOAD_LABEL[art.kind];
  const filename = comLimiteDeNome(sanitize(labelFn ? labelFn(title) : path.basename(art.filePath)));
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
