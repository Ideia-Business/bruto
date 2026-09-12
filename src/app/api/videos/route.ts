import { NextResponse } from "next/server";
import { recusarSeNaoForChamadaDeCliente } from "@/lib/endpoint-local";
import { getCatalog, getHistory, getHeroBruto, getActiveJobs, searchBrutos, isBrutoDone } from "@/db/queries";
import { catalogoParaWire } from "@/lib/wire";
import { parseMediaUrl } from "@/pipeline/lib/paths";
import { enqueue } from "@/pipeline/runner";

/** GET /api/videos?q=... (busca) ou catálogo completo (hero + rows + histórico + ativos). */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q");
  if (q !== null) {
    return NextResponse.json({ results: searchBrutos(q) });
  }
  return NextResponse.json(
    catalogoParaWire({
      hero: getHeroBruto(),
      catalog: getCatalog(),
      history: getHistory(),
      activeJobs: getActiveJobs(),
    }),
  );
}

/** POST /api/videos { url, forceWhisper?, translate? } → cria job. Dedupe 409. */
export async function POST(req: Request) {
  const recusa = recusarSeNaoForChamadaDeCliente(req);
  if (recusa) return recusa;

  let body: { url?: string; forceWhisper?: boolean; translate?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const url = (body.url ?? "").trim();
  const ref = parseMediaUrl(url);
  if (!ref) {
    return NextResponse.json(
      { error: "Link inválido. Aceito YouTube, Instagram (reel/post) ou TikTok." },
      { status: 400 },
    );
  }
  const videoId = ref.id;
  // Dedupe: vídeo já processado → 409 com o id para a UI redirecionar.
  // (short links sem id extraível pulam esta checagem — o pipeline dedupa pelo id do yt-dlp.)
  if (videoId && isBrutoDone(videoId)) {
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
