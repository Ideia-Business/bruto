/**
 * Testes de `db/queries.ts` sobre um banco real (mesmo padrão de
 * `tests/pipeline/runner.test.ts` e `tests/db/migrate.test.ts`): banco
 * migrado pelo caminho real (`npm run db:migrate`), `BRUTO_DATA_ROOT` setado
 * ANTES do primeiro import de `@/db/client` (o singleton lê `DATA_ROOT` na
 * primeira avaliação do módulo), por isso os imports são dinâmicos.
 *
 * Este arquivo nasceu do achado 2 da 5ª rodada de revisão cross-vendor
 * (Grok): `05-category.ts` só chamava `setBrutoTagsFromNames` quando a IA
 * sugeria ALGUMA tag — se um vídeo já classificado fosse reclassificado e a
 * IA respondesse de propósito "nenhuma tag boa desta vez" (`tags: []`,
 * parsing bem-sucedido), a chamada era pulada e as tags ANTIGAS ficavam no
 * banco, com `reclassificar-cli` reportando sucesso sem ter tocado em nada.
 * A correção passou a chamar `setBrutoTagsFromNames` sempre que o parsing
 * teve sucesso, INCLUSIVE com lista vazia — o que só funciona porque esta
 * função (substituição completa via `setTagIdsForBruto`) já sabia limpar tudo
 * quando o alvo é vazio. Este teste prova o mecanismo de que a correção
 * depende, sem precisar de IA nem mockar `runCategory`.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const RAIZ = process.cwd();

let dataRoot: string;
let setBrutoTagsFromNames: typeof import("@/db/queries").setBrutoTagsFromNames;
let getTagsForBruto: typeof import("@/db/queries").getTagsForBruto;
let setTagIdsForBruto: typeof import("@/db/queries").setTagIdsForBruto;
let db: typeof import("@/db/client").db;
let brutos: typeof import("@/db/schema").brutos;

before(async () => {
  dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bruto-queries-tags-"));
  process.env.BRUTO_DATA_ROOT = dataRoot;
  execFileSync("npm", ["run", "db:migrate"], {
    cwd: RAIZ,
    env: { ...process.env, BRUTO_DATA_ROOT: dataRoot },
    stdio: "pipe",
  });

  ({ setBrutoTagsFromNames, getTagsForBruto, setTagIdsForBruto } = await import("@/db/queries"));
  ({ db } = await import("@/db/client"));
  ({ brutos } = await import("@/db/schema"));
});

after(() => {
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

function semearBruto(id: string): void {
  db.insert(brutos)
    .values({ id, url: `https://exemplo.test/${id}`, platform: "youtube", title: `Vídeo ${id}`, createdAt: new Date() })
    .run();
}

describe("setBrutoTagsFromNames", () => {
  test("REGRESSÃO: chamar com [] REMOVE as tags que o vídeo já tinha (substituição completa, não só adição)", () => {
    const id = "TAGSVAZIO001";
    semearBruto(id);

    setBrutoTagsFromNames(id, ["python", "inteligência artificial"]);
    assert.equal(getTagsForBruto(id).length, 2, "deveria ter 2 tags depois da primeira classificação");

    setBrutoTagsFromNames(id, []);
    assert.deepEqual(
      getTagsForBruto(id),
      [],
      "reclassificar com lista vazia deveria LIMPAR as tags antigas, não deixá-las intocadas",
    );
  });

  test("reaproveita tag existente por nome (mesmo slug) em vez de duplicar", () => {
    const idA = "TAGSREUSE001";
    const idB = "TAGSREUSE002";
    semearBruto(idA);
    semearBruto(idB);

    const primeiraVez = setBrutoTagsFromNames(idA, ["Python"]);
    const segundaVez = setBrutoTagsFromNames(idB, ["python"]);

    assert.equal(primeiraVez[0].id, segundaVez[0].id, "duas grafias do mesmo assunto deveriam reaproveitar a MESMA tag");
  });

  test("substitui o conjunto: tag antiga que não está na lista nova sai, a nova entra", () => {
    const id = "TAGSSUBST001";
    semearBruto(id);

    setBrutoTagsFromNames(id, ["ciência"]);
    setBrutoTagsFromNames(id, ["negócios"]);

    const nomes = getTagsForBruto(id).map((t) => t.name);
    assert.deepEqual(nomes, ["negócios"]);
  });
});

describe("setTagIdsForBruto — transação", () => {
  test("REGRESSÃO: um tagId inválido no meio da lista não deixa estado parcial (tudo ou nada)", () => {
    const id = "TAGSTX001";
    semearBruto(id);

    const [{ id: tagValidoId }] = setBrutoTagsFromNames(id, ["válida"]);

    assert.throws(
      () => setTagIdsForBruto(id, [tagValidoId, "id-de-tag-que-nao-existe"]),
      "um FK inválido deveria fazer a transação inteira falhar",
    );

    // Se a transação funcionou, o estado ANTERIOR (só "válida") continua
    // intacto — nem o insert do id inválido, nem qualquer delete
    // intermediário do loop, ficaram commitados pela metade.
    const nomes = getTagsForBruto(id).map((t) => t.name);
    assert.deepEqual(nomes, ["válida"]);
  });
});
