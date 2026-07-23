import { NextResponse } from "next/server";
import { getCatalog, getHistory, getHeroVideo, getActiveJobs, searchVideos, isVideoDone } from "@/db/queries";
import { parseYoutubeUrl } from "@/pipeline/lib/paths";
import { enqueue } from "@/pipeline/runner";

/** GET /api/videos?q=... (busca) ou catálogo completo (hero + rows + histórico + ativos). */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q");
  if (q !== null) {
    return NextResponse.json({ results: searchVideos(q) });
  }
  return NextResponse.json({
    hero: getHeroVideo(),
    catalog: getCatalog(),
    history: getHistory(),
    activeJobs: getActiveJobs(),
  });
}

/** POST /api/videos { url, forceWhisper?, translate? } → cria job. Dedupe 409. */
export async function POST(req: Request) {
  let body: { url?: string; forceWhisper?: boolean; translate?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const url = (body.url ?? "").trim();
  const videoId = parseYoutubeUrl(url);
  if (!videoId) {
    return NextResponse.json({ error: "URL do YouTube inválida" }, { status: 400 });
  }
  // Dedupe: vídeo já processado → 409 com o id para a UI redirecionar.
  if (isVideoDone(videoId)) {
    return NextResponse.json(
      { error: "Vídeo já processado", videoId, duplicate: true },
      { status: 409 },
    );
  }
  const jobId = enqueue(url, {
    forceWhisper: body.forceWhisper ?? false,
    translate: body.translate ?? false,
  });
  return NextResponse.json({ jobId, videoId }, { status: 202 });
}
