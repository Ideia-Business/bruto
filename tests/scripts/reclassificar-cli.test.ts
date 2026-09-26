/**
 * `npm run reclassificar` — o reprocessamento retroativo do passo 05, rodando
 * SEQUENCIAL sobre uma amostra pequena de um banco de teste (nunca contra a
 * biblioteca de verdade). Mesmo padrão de `tests/db/migrate.test.ts`: exercita
 * o CAMINHO REAL (o script publicado, via subprocesso), não uma reimplementação.
 *
 * `BRUTO_LLM_PROVIDER` aponta para um provedor que não existe — a chamada à IA
 * falha de forma síncrona e determinística (LLM_NOT_CONFIGURED), sem rede e sem
 * depender de haver `claude`/`codex` autenticados nesta máquina.
 *
 * Este arquivo é o teste de regressão do achado da revisão cross-vendor: uma
 * falha na chamada de categoria NUNCA pode gravar "outros" por cima da
 * categoria que o vídeo já tinha — rodar este script com a IA indisponível
 * apagava a organização do catálogo inteiro reportando sucesso. O vídeo
 * `COM_ARTEFATO` nasce JÁ CLASSIFICADO (categoria "tecnologia") de propósito:
 * é o que prova que a categoria sobrevive intacta quando a IA falha.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const RAIZ = process.cwd();

const COM_ARTEFATO = { id: "COMARTEFATO01", title: "Vídeo com transcrição e resumo" };
const SEM_ARTEFATO = { id: "SEMARTEFATO01", title: "Vídeo sem transcrição nem resumo" };

let dataRoot: string;
let dbPath: string;
let categoriaTecnologiaId: number;

interface ResultadoCli {
  saida: string;
  codigo: number;
}

/** O script sai com 1 quando há erro — captura a saída dos dois casos (sucesso e falha). */
function rodar(args: string[] = []): ResultadoCli {
  try {
    const saida = execFileSync("npm", ["run", "reclassificar", "--", ...args], {
      cwd: RAIZ,
      env: {
        ...process.env,
        BRUTO_DATA_ROOT: dataRoot,
        BRUTO_LLM_PROVIDER: "provedor-inexistente-para-teste",
      },
      encoding: "utf8",
    });
    return { saida, codigo: 0 };
  } catch (err) {
    const e = err as { stdout?: string; status?: number | null };
    return { saida: e.stdout ?? "", codigo: e.status ?? 1 };
  }
}

describe("npm run reclassificar — reprocessamento retroativo sequencial", () => {
  before(() => {
    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bruto-reclassificar-"));
    dbPath = path.join(dataRoot, "bruto.db");

    execFileSync("npm", ["run", "db:migrate"], {
      cwd: RAIZ,
      env: { ...process.env, BRUTO_DATA_ROOT: dataRoot },
      stdio: "pipe",
    });
    execFileSync("npm", ["run", "db:seed"], {
      cwd: RAIZ,
      env: { ...process.env, BRUTO_DATA_ROOT: dataRoot },
      stdio: "pipe",
    });

    const sqlite = new Database(dbPath);
    const tecnologia = sqlite
      .prepare("SELECT id FROM categories WHERE slug = 'tecnologia'")
      .get() as { id: number };
    categoriaTecnologiaId = tecnologia.id;

    const now = Math.floor(Date.now() / 1000);
    // COM_ARTEFATO nasce JÁ classificado — é a organização prévia que a falha
    // de IA não pode apagar.
    sqlite
      .prepare(
        "INSERT INTO brutos (id, url, platform, title, category_id, created_at) VALUES (?, ?, 'youtube', ?, ?, ?)",
      )
      .run(COM_ARTEFATO.id, `https://exemplo.test/${COM_ARTEFATO.id}`, COM_ARTEFATO.title, categoriaTecnologiaId, now);
    sqlite
      .prepare("INSERT INTO brutos (id, url, platform, title, created_at) VALUES (?, ?, 'youtube', ?, ?)")
      .run(SEM_ARTEFATO.id, `https://exemplo.test/${SEM_ARTEFATO.id}`, SEM_ARTEFATO.title, now);
    sqlite.close();

    // Só o COM_ARTEFATO ganha transcript.txt + summary.md em disco — é o que
    // separa "reclassificável" de "pulado" no script.
    const dir = path.join(dataRoot, "library", COM_ARTEFATO.id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "transcript.txt"), "Transcrição de teste, sem conteúdo real.");
    fs.writeFileSync(path.join(dir, "summary.md"), "## Visão Geral\nResumo de teste.");
  });

  after(() => {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });

  test("termina rodando os 2 brutos, sem travar o lote mesmo com a IA indisponível", () => {
    const { saida } = rodar();
    assert.match(saida, /Reclassificando 2 bruto\(s\)/);
  });

  test("REGRESSÃO: com a IA indisponível, o vídeo é reportado como FALHA — nunca como 'outros'", () => {
    const { saida } = rodar();
    assert.match(saida, new RegExp(`✖ ${COM_ARTEFATO.title} — a IA não respondeu, categoria mantida como estava`));
    assert.doesNotMatch(
      saida,
      new RegExp(`✔ ${COM_ARTEFATO.title}`),
      "não pode ser reportado como sucesso quando a IA nem respondeu",
    );
  });

  test("o vídeo SEM artefato foi pulado, não classificado", () => {
    const { saida } = rodar();
    assert.match(saida, new RegExp(`⏭ {2}${SEM_ARTEFATO.title} — sem transcrição/resumo em disco, pulado`));
    assert.doesNotMatch(saida, new RegExp(`✔ ${SEM_ARTEFATO.title}`));
  });

  test("resumo final reporta 0 reclassificado, 1 pulado e 1 com erro", () => {
    const { saida } = rodar();
    assert.match(saida, /Concluído: 0 reclassificado\(s\), 1 pulado\(s\) \(sem artefato\), 1 com erro\./);
  });

  test("sai com código não-zero quando há erro (para automação perceber a falha)", () => {
    const { codigo } = rodar();
    assert.equal(codigo, 1);
  });

  test("REGRESSÃO: a categoria PRÉVIA do vídeo sobrevive intacta — nunca vira 'outros'", () => {
    rodar();
    const sqlite = new Database(dbPath, { readonly: true });
    const linhas = sqlite
      .prepare("SELECT id, category_id FROM brutos ORDER BY id")
      .all() as { id: string; category_id: number | null }[];
    sqlite.close();

    const comArtefato = linhas.find((l) => l.id === COM_ARTEFATO.id);
    const semArtefato = linhas.find((l) => l.id === SEM_ARTEFATO.id);
    assert.equal(
      comArtefato?.category_id,
      categoriaTecnologiaId,
      "a categoria 'tecnologia' que o vídeo já tinha deveria ter sobrevivido intacta",
    );
    assert.equal(semArtefato?.category_id, null, "o vídeo pulado não deveria ter sido tocado");
  });

  test("filtrar por um único id processa só aquele vídeo", () => {
    const { saida, codigo } = rodar([SEM_ARTEFATO.id]);
    assert.equal(codigo, 0);
    assert.match(saida, /Reclassificando 1 bruto\(s\)/);
    assert.match(saida, new RegExp(`⏭ {2}${SEM_ARTEFATO.title}`));
    assert.doesNotMatch(saida, new RegExp(COM_ARTEFATO.title));
  });
});
