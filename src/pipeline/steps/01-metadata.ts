import fs from "node:fs";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { categories, brutos } from "@/db/schema";
import { fetchMetadata, downloadThumbnail } from "@/pipeline/lib/ytdlp";
import { artifactPaths, ensureVideoDir } from "@/pipeline/lib/paths";
import { recordArtifact } from "@/pipeline/lib/artifacts";
import type { VideoMetadata } from "@/pipeline/types";

export { fetchMetadata };

/**
 * Grava no disco e no banco o que `fetchMetadata` só buscou: thumbnail,
 * info.json e o upsert em `brutos` (categoria provisória "outros").
 *
 * Separada de `fetchMetadata` (que só chama o yt-dlp, sem tocar em disco ou
 * banco) para o runner poder decidir SE vale a pena persistir ANTES de
 * chamar esta função — ver `ehDuplicataTardia` em `runner.ts`. Sem essa
 * separação, um link curto do TikTok cujo ID real já estivesse `done`
 * sobrescrevia silenciosamente título/thumbnail/info.json de um vídeo já
 * pronto, mesmo pulando as etapas caras (transcript/whisper/summary/…).
 */
export async function persistMetadata(meta: VideoMetadata): Promise<void> {
  const paths = artifactPaths(meta.id);
  ensureVideoDir(meta.id);

  // info.json bruto — útil para depuração e re-processamento offline.
  fs.writeFileSync(paths.infoJson, JSON.stringify(meta, null, 2));

  await downloadThumbnail(meta.thumbnailUrl, paths.thumb);

  // Categoria provisória: "outros" (a etapa 5 reclassifica).
  const outros = db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.slug, "outros"))
    .get();

  const existing = db.select({ id: brutos.id }).from(brutos).where(eq(brutos.id, meta.id)).get();
  const thumbnailPath = fs.existsSync(paths.thumb) ? paths.thumb : null;

  if (existing) {
    // NUNCA `title: meta.title` aqui — reprocessar (retry) já grava esta
    // etapa de novo em vídeo que PODE já ter um título melhor (proposto pelo
    // passo 05 ou corrigido à mão). Gravar o título CRU do yt-dlp aqui
    // revertia silenciosamente qualquer melhoria, mesmo se o passo 05
    // seguinte falhasse por qualquer motivo — o job terminava `done`, sem
    // sinal nenhum de que o título regrediu. O título só muda por
    // `setBrutoTitle` (a IA propondo de verdade) ou correção manual.
    db.update(brutos)
      .set({
        url: meta.url,
        platform: meta.platform,
        channel: meta.channel,
        durationSec: meta.durationSec,
        uploadDate: meta.uploadDate,
        language: meta.language,
        thumbnailPath,
      })
      .where(eq(brutos.id, meta.id))
      .run();
  } else {
    db.insert(brutos)
      .values({
        id: meta.id,
        url: meta.url,
        platform: meta.platform,
        title: meta.title,
        channel: meta.channel,
        durationSec: meta.durationSec,
        uploadDate: meta.uploadDate,
        language: meta.language,
        thumbnailPath,
        categoryId: outros?.id ?? null,
        // A categoria acima é PROVISÓRIA — o passo 05 é quem classifica de
        // verdade. Pendente até ele confirmar (ou até correção manual).
        classificacaoPendente: true,
        createdAt: new Date(),
      })
      .run();
  }

  recordArtifact(meta.id, "info_json", paths.infoJson);
}

/**
 * Etapa 1 — metadata: busca --dump-json, baixa thumbnail, faz upsert do
 * vídeo e grava info.json. Composição de `fetchMetadata` + `persistMetadata`
 * para quem quer o passo completo de uma vez só (o runner usa as duas
 * metades separadamente — ver o comentário de `persistMetadata`).
 */
export async function runMetadata(url: string): Promise<VideoMetadata> {
  const meta = await fetchMetadata(url);
  await persistMetadata(meta);
  return meta;
}
