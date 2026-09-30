/**
 * Link curto do TikTok (`vm.tiktok.com/…`, `vt.tiktok.com/…`) não expõe o ID
 * na URL — `reconhecerLink` devolve `id: ""` para esse caso (ver
 * `src/lib/plataformas.ts`). Isso fazia `POST /api/videos` pular o dedupe
 * (`if (videoId && isBrutoDone(videoId))`, string vazia é falsy): o vídeo
 * era enfileirado de novo, baixava áudio, transcrevia e resumia tudo de
 * novo, sem avisar que já existia.
 *
 * `ehDuplicataTardia` (src/pipeline/runner.ts) fecha esse buraco: só depois
 * do yt-dlp rodar (etapa metadata) o ID real aparece, e é aí que dá pra
 * comparar com o catálogo. Este arquivo cobre a função pura com deps
 * injetadas (sem banco) e, com o mesmo padrão de `tests/db/migrate.test.ts`,
 * com o banco de verdade — para provar que as deps DE PRODUÇÃO
 * (`isBrutoDone` + `parseMediaUrl`) resolvem o caso real.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const RAIZ = process.cwd();

let dataRoot: string;
let ehDuplicataTardia: typeof import("@/pipeline/runner").ehDuplicataTardia;
let processJob: typeof import("@/pipeline/runner").processJob;
let sincronizarTituloComBanco: typeof import("@/pipeline/runner").sincronizarTituloComBanco;
let db: typeof import("@/db/client").db;
let brutos: typeof import("@/db/schema").brutos;
let jobsTable: typeof import("@/db/schema").jobs;
let artifacts: typeof import("@/db/schema").artifacts;
let eq: typeof import("drizzle-orm").eq;
let artifactPaths: typeof import("@/pipeline/lib/paths").artifactPaths;
type VideoMetadata = import("@/pipeline/types").VideoMetadata;

function metaFake(id: string, title: string): VideoMetadata {
  return {
    id,
    url: `https://exemplo.test/${id}`,
    platform: "youtube",
    title,
    channel: null,
    durationSec: null,
    uploadDate: null,
    language: null,
    description: null,
    chapters: [],
    tags: [],
    subtitleLangs: [],
    autoCaptionLangs: [],
    thumbnailUrl: null,
  };
}

before(async () => {
  // Mesmo padrão de tests/db/migrate.test.ts: banco real, num diretório
  // temporário, migrado pelo caminho real (`npm run db:migrate`) — nunca uma
  // reimplementação do schema. `BRUTO_DATA_ROOT` precisa estar setado ANTES
  // do primeiro import de `@/db/client` (o singleton lê `DATA_ROOT` na
  // primeira avaliação do módulo), por isso o import de `@/pipeline/runner`
  // é dinâmico e só acontece aqui dentro.
  dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bruto-dedupe-tiktok-"));
  process.env.BRUTO_DATA_ROOT = dataRoot;
  execFileSync("npm", ["run", "db:migrate"], {
    cwd: RAIZ,
    env: { ...process.env, BRUTO_DATA_ROOT: dataRoot },
    stdio: "pipe",
  });

  ({ ehDuplicataTardia, processJob, sincronizarTituloComBanco } = await import("@/pipeline/runner"));
  ({ db } = await import("@/db/client"));
  ({ brutos, jobs: jobsTable, artifacts } = await import("@/db/schema"));
  ({ eq } = await import("drizzle-orm"));
  ({ artifactPaths } = await import("@/pipeline/lib/paths"));
});

after(() => {
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

/** Semeia um vídeo já concluído (id = ID real do TikTok), como se um job
 *  anterior — por link curto ou direto — já tivesse processado até o fim. */
function semearVideoDone(id: string, url: string): void {
  db.insert(brutos)
    .values({
      id,
      url,
      platform: "tiktok",
      title: `Vídeo ${id}`,
      createdAt: new Date(),
    })
    .run();
  db.insert(jobsTable)
    .values({
      id: `job-done-${id}`,
      videoId: id,
      url,
      status: "done",
      progressPct: 100,
      createdAt: new Date(),
    })
    .run();
}

describe("ehDuplicataTardia — deps de produção (banco real)", () => {
  test("link curto cujo ID real já está done → true (duplicata tardia)", () => {
    const id = "7111111111111111111";
    const urlCanonica = `https://www.tiktok.com/@perfil/video/${id}`;
    semearVideoDone(id, urlCanonica);

    const eh = ehDuplicataTardia("https://vm.tiktok.com/ZMabc123/", id);
    assert.equal(eh, true);
  });

  test("link curto cujo ID real é novo → false (processa normal)", () => {
    const eh = ehDuplicataTardia("https://vt.tiktok.com/ZMxyz789/", "7222222222222222222");
    assert.equal(eh, false);
  });

  test("link direto (ID já na URL) nunca é 'duplicata tardia' aqui — o dedupe dele já roda em POST /api/videos antes do enqueue", () => {
    const id = "7333333333333333333";
    const urlCanonica = `https://www.tiktok.com/@perfil/video/${id}`;
    semearVideoDone(id, urlCanonica);

    const eh = ehDuplicataTardia(urlCanonica, id);
    assert.equal(eh, false);
  });

  test("URL de retry (canônica, reenfileirada por /api/videos/[id]/retry) não é bloqueada mesmo já done — é o caminho de reprocessamento intencional", () => {
    const id = "7444444444444444444";
    const urlCanonica = `https://www.tiktok.com/@perfil/video/${id}`;
    semearVideoDone(id, urlCanonica);

    // O retry chama enqueue(video.url, …); video.url é a URL canônica
    // gravada por runMetadata (meta.url = webpage_url do yt-dlp) — já carrega
    // o ID real, então parseMediaUrl nunca devolve id: "" aqui.
    const eh = ehDuplicataTardia(urlCanonica, id);
    assert.equal(eh, false);
  });

  test("YouTube (sempre tem ID na URL) nunca aciona o caminho de link curto", () => {
    const id = "dQw4w9WgXcQ";
    semearVideoDone(id, `https://www.youtube.com/watch?v=${id}`);

    const eh = ehDuplicataTardia(`https://youtu.be/${id}`, id);
    assert.equal(eh, false);
  });
});

describe("ehDuplicataTardia — deps injetadas (sem banco)", () => {
  test("link curto + já done → true", () => {
    const eh = ehDuplicataTardia("https://vm.tiktok.com/ZMabc/", "123", {
      parseMediaUrl: () => ({ id: "" }),
      isBrutoDone: () => true,
    });
    assert.equal(eh, true);
  });

  test("link curto + ainda não done → false", () => {
    const eh = ehDuplicataTardia("https://vm.tiktok.com/ZMabc/", "123", {
      parseMediaUrl: () => ({ id: "" }),
      isBrutoDone: () => false,
    });
    assert.equal(eh, false);
  });

  test("URL não reconhecida (parseMediaUrl null) → false, mesmo com isBrutoDone true — nunca deveria chegar aqui (o pipeline já rejeitaria a URL antes), mas na dúvida processa por completo em vez de encurtar", () => {
    const eh = ehDuplicataTardia("qualquer coisa que não é URL", "123", {
      parseMediaUrl: () => null,
      isBrutoDone: () => true,
    });
    assert.equal(eh, false);
  });
});

describe("processJob — o atalho de duplicata tardia não persiste metadata", () => {
  /**
   * Achado do Grok (revisão cross-vendor): `runMetadata` fazia o --dump-json
   * E o upsert em `brutos` (título, thumbnail, info.json) numa função só. O
   * atalho pulava transcript/summary/etc, mas o UPDATE do metadado já tinha
   * rodado e sobrescrito silenciosamente o que já estava salvo. Corrigido
   * separando `fetchMetadata` (só busca) de `persistMetadata` (só grava) —
   * este teste prova que, no caminho da duplicata tardia, `persistMetadata`
   * NUNCA roda: nem o `brutos.title`, nem `artifacts`, nem `info.json`/thumb
   * em disco são tocados além da própria atualização do job.
   */
  test("link curto cujo ID real já está done → banco e disco intocados, só o job muda", async () => {
    const id = "7666666666666666666";
    const urlCanonica = `https://www.tiktok.com/@perfil/video/${id}`;
    semearVideoDone(id, urlCanonica);
    const tituloOriginal = db.select().from(brutos).where(eq(brutos.id, id)).get()?.title;

    const jobId = "job-teste-duplicata-tardia";
    db.insert(jobsTable)
      .values({
        id: jobId,
        videoId: null,
        url: "https://vm.tiktok.com/ZMduplicado/",
        status: "queued",
        progressPct: 0,
        createdAt: new Date(),
      })
      .run();

    let persistMetadataChamado = false;
    await processJob(jobId, {
      // `fetchMetadata` fake: simula o yt-dlp revelando que o link curto é,
      // na verdade, o vídeo `id` (já `done`) — com um título diferente do
      // salvo, para provar que ele NÃO sobrescreve o que já está no banco.
      fetchMetadata: async () => ({
        id,
        url: urlCanonica,
        platform: "tiktok",
        title: "Título vindo do yt-dlp — NÃO deveria substituir o salvo",
        channel: null,
        durationSec: null,
        uploadDate: null,
        language: null,
        description: null,
        chapters: [],
        tags: [],
        subtitleLangs: [],
        autoCaptionLangs: [],
        thumbnailUrl: null,
      }),
      persistMetadata: async () => {
        persistMetadataChamado = true;
      },
    });

    assert.equal(
      persistMetadataChamado,
      false,
      "persistMetadata não deveria rodar no atalho de duplicata tardia",
    );

    const brutoDepois = db.select().from(brutos).where(eq(brutos.id, id)).get();
    assert.equal(brutoDepois?.title, tituloOriginal, "o título salvo não pode ter sido sobrescrito");

    const artifactsDoId = db.select().from(artifacts).where(eq(artifacts.videoId, id)).all();
    assert.equal(artifactsDoId.length, 0, "nenhum artifact deveria ter sido gravado para esse ID");

    const paths = artifactPaths(id);
    assert.equal(fs.existsSync(paths.infoJson), false, "info.json não deveria ter sido gravado");
    assert.equal(fs.existsSync(paths.thumb), false, "thumbnail não deveria ter sido baixada");

    const jobDepois = db.select().from(jobsTable).where(eq(jobsTable.id, jobId)).get();
    assert.equal(jobDepois?.status, "done");
    assert.equal(jobDepois?.videoId, id);
    assert.equal(jobDepois?.progressPct, 100);
  });
});

/**
 * REGRESSÃO (achado 2, Codex + Grok, 10ª rodada): `persistMetadata` nunca
 * toca no título num reprocessamento (achado da 9ª rodada), mas `meta.title`
 * (a variável local que segue pro resto do pipeline) continuava com o título
 * CRU do yt-dlp. Os prompts de categoria/tags desta passada avaliariam o
 * título CRU como "o original", e a IA podia então SOBRESCREVER um título bom
 * já confirmado com uma reescrita do texto cru.
 */
describe("sincronizarTituloComBanco — deps de produção (banco real)", () => {
  test("REGRESSÃO: repõe meta.title com o título ATUAL do banco antes do resto do pipeline rodar", () => {
    const id = "SINCTITULO01";
    db.insert(brutos)
      .values({
        id,
        url: `https://exemplo.test/${id}`,
        platform: "youtube",
        title: "Título Bom Já Confirmado Antes",
        createdAt: new Date(),
      })
      .run();

    const meta = metaFake(id, "titulo cru que o yt-dlp devolveu nesta passada");
    sincronizarTituloComBanco(meta);

    assert.equal(meta.title, "Título Bom Já Confirmado Antes");
  });

  test("vídeo NOVO (ainda não existe no banco) não mexe em meta.title — nada para sincronizar ainda", () => {
    const meta = metaFake("SINCTITULONOVO01", "Título Cru De Um Vídeo Novo");
    sincronizarTituloComBanco(meta);
    assert.equal(meta.title, "Título Cru De Um Vídeo Novo");
  });
});

describe("sincronizarTituloComBanco — deps injetadas (sem banco)", () => {
  test("aplica o título devolvido pela dep", () => {
    const meta = metaFake("x", "cru");
    sincronizarTituloComBanco(meta, { getBrutoById: () => ({ title: "bom" }) });
    assert.equal(meta.title, "bom");
  });

  test("dep devolvendo null (vídeo novo) não mexe no título", () => {
    const meta = metaFake("x", "cru");
    sincronizarTituloComBanco(meta, { getBrutoById: () => null });
    assert.equal(meta.title, "cru");
  });
});
