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
let db: typeof import("@/db/client").db;
let brutos: typeof import("@/db/schema").brutos;
let jobsTable: typeof import("@/db/schema").jobs;

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

  ({ ehDuplicataTardia } = await import("@/pipeline/runner"));
  ({ db } = await import("@/db/client"));
  ({ brutos, jobs: jobsTable } = await import("@/db/schema"));
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
