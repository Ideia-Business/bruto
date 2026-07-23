import fs from "node:fs";
import { getVideoById } from "@/db/queries";

/** GET /api/media/[videoId]/thumb → thumbnail do disco (offline-first). */
export async function GET(_req: Request, { params }: { params: Promise<{ videoId: string }> }) {
  const { videoId } = await params;
  const video = getVideoById(videoId);
  if (video?.thumbnailPath && fs.existsSync(video.thumbnailPath)) {
    const data = fs.readFileSync(video.thumbnailPath);
    return new Response(new Uint8Array(data), {
      headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400" },
    });
  }
  // Fallback: redireciona para a thumbnail do YouTube.
  return Response.redirect(`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`, 302);
}
