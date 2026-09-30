/**
 * `persistMetadata` — REGRESSÃO (achado 2, Grok, 9ª rodada): o branch de
 * UPDATE gravava `title: meta.title` (o título CRU do yt-dlp) toda vez que um
 * vídeo já existente era reprocessado — mesmo que o passo 05 (ou correção
 * manual) já tivesse melhorado esse título antes. Reprocessar QUALQUER vídeo
 * já bem-classificado revertia o título silenciosamente para a versão crua, e
 * se o passo 05 seguinte falhasse por qualquer motivo, nada o restaurava — o
 * job terminava `done` normalmente, sem sinal de regressão.
 *
 * Mesmo padrão de `tests/pipeline/runner.test.ts`: banco real, num diretório
 * temporário, `BRUTO_DATA_ROOT` setado ANTES do primeiro import de
 * `@/db/client`, por isso os imports são dinâmicos.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const RAIZ = process.cwd();

let dataRoot: string;
let persistMetadata: typeof import("@/pipeline/steps/01-metadata").persistMetadata;
let db: typeof import("@/db/client").db;
let brutos: typeof import("@/db/schema").brutos;
let eq: typeof import("drizzle-orm").eq;
type VideoMetadata = import("@/pipeline/types").VideoMetadata;

function metaBase(id: string, title: string): VideoMetadata {
  return {
    id,
    url: `https://exemplo.test/${id}`,
    platform: "youtube",
    title,
    channel: "Canal de teste",
    durationSec: 120,
    uploadDate: "20260101",
    language: "pt",
    description: null,
    chapters: [],
    tags: [],
    subtitleLangs: [],
    autoCaptionLangs: [],
    thumbnailUrl: null, // evita rede — downloadThumbnail retorna cedo com null
  };
}

before(async () => {
  dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bruto-persist-metadata-"));
  process.env.BRUTO_DATA_ROOT = dataRoot;
  execFileSync("npm", ["run", "db:migrate"], {
    cwd: RAIZ,
    env: { ...process.env, BRUTO_DATA_ROOT: dataRoot },
    stdio: "pipe",
  });

  ({ persistMetadata } = await import("@/pipeline/steps/01-metadata"));
  ({ db } = await import("@/db/client"));
  ({ brutos } = await import("@/db/schema"));
  ({ eq } = await import("drizzle-orm"));
});

after(() => {
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

describe("persistMetadata", () => {
  test("na criação (INSERT), o título vem do yt-dlp normalmente", async () => {
    const id = "METAINSERT01";
    await persistMetadata(metaBase(id, "Título Cru Do YT-DLP"));

    const bruto = db.select().from(brutos).where(eq(brutos.id, id)).get();
    assert.equal(bruto?.title, "Título Cru Do YT-DLP");
  });

  /**
   * REGRESSÃO: reprocessar (retry) um vídeo que já tem um título melhorado
   * NÃO pode reverter para o título cru do yt-dlp.
   */
  test("REGRESSÃO: reprocessar (UPDATE) NUNCA reverte um título já melhorado", async () => {
    const id = "METAUPDATE01";
    await persistMetadata(metaBase(id, "titulo cru do yt-dlp em minusculas"));

    // Simula o passo 05 (ou correção manual) já tendo melhorado o título.
    db.update(brutos).set({ title: "Título Melhorado Pela IA" }).where(eq(brutos.id, id)).run();

    // Reprocessamento: o yt-dlp devolve o MESMO título cru de sempre.
    await persistMetadata(metaBase(id, "titulo cru do yt-dlp em minusculas"));

    const bruto = db.select().from(brutos).where(eq(brutos.id, id)).get();
    assert.equal(
      bruto?.title,
      "Título Melhorado Pela IA",
      "o título melhorado deveria ter sobrevivido ao reprocessamento",
    );
  });

  test("reprocessar atualiza os OUTROS campos normalmente (canal, duração, thumbnail) — só o título é protegido", async () => {
    const id = "METAUPDATE02";
    await persistMetadata(metaBase(id, "Título Original"));
    db.update(brutos).set({ title: "Título Melhorado Pela IA" }).where(eq(brutos.id, id)).run();

    const metaAtualizada = metaBase(id, "Título Original");
    metaAtualizada.channel = "Canal Novo";
    metaAtualizada.durationSec = 999;
    await persistMetadata(metaAtualizada);

    const bruto = db.select().from(brutos).where(eq(brutos.id, id)).get();
    assert.equal(bruto?.title, "Título Melhorado Pela IA", "título continua protegido");
    assert.equal(bruto?.channel, "Canal Novo", "canal deveria ter atualizado normalmente");
    assert.equal(bruto?.durationSec, 999, "duração deveria ter atualizado normalmente");
  });
});
