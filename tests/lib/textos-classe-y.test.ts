/**
 * CLASSE Y — em modo pacote, NENHUMA instrução ao usuário aponta para um
 * arquivo ou comando que não existe no pacote (`.env` do app, `npm run …`,
 * `launcher/…`, `bash install/…`).
 *
 * Duas frentes:
 *
 *  1. Asserções diretas sobre os textos de tela (`ERROR_HINT`): têm de ser
 *     verdadeiros nos DOIS modos (o componente que os mostra não sabe o
 *     modo) — nomeiam o caminho do app instalado (`~/.bruto/.env`) e o do
 *     código-fonte (`.env`), sem `.env.example`.
 *
 *  2. VARREDURA estática de `src/**`: toda instrução proibida em literal de
 *     string (fora de comentário) tem de estar num arquivo da lista
 *     `ARQUIVOS_JUSTIFICADOS` — cada um ou é por-modo/neutro, ou é CLI que
 *     só existe no clone. Arquivo NOVO com instrução proibida QUEBRA este
 *     teste até ser triado. É a trava que impede a classe de renascer.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ERROR_HINT } from "@/lib/format";

const RAIZ = process.cwd();
const SRC = path.join(RAIZ, "src");

/** Instruções que, soltas num texto de usuário, são armadilha no pacote. */
const PROIBIDO =
  /(["'`])(?:\\.|(?!\1).)*(\.env\b|npm run |bash install\/|launcher\/|npx drizzle-kit)(?:\\.|(?!\1).)*\1/;

/**
 * Os ÚNICOS arquivos onde instrução proibida pode aparecer, e por quê.
 * Mudou o conjunto de ocorrências? Este teste falha até a lista ser triada.
 */
const ARQUIVOS_JUSTIFICADOS: Record<string, string> = {
  "src/lib/format.ts": "textos de tela NEUTROS: nomeiam os dois caminhos (app instalado e código-fonte)",
  "src/pipeline/lib/llm/index.ts": "mensagem de LLM_NOT_CONFIGURED POR MODO",
  "src/scripts/doctor.ts": "texto POR MODO (modoPacote)",
  "src/db/migrate.ts": "saída do estado intermediário POR MODO",
  "src/lib/env-usuario.ts": "o próprio carregador do .env da pessoa + helper dos textos",
  "src/scripts/process-cli.ts": "CLI do clone (`npm run process`); não é empacotada",
};

function* arquivos(dir: string): Generator<string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* arquivos(p);
    else if (/\.(ts|tsx)$/.test(e.name)) yield p;
  }
}

/**
 * CLASSE DD — nenhuma mensagem, em nenhum modo, manda a pessoa apagar,
 * excluir ou sobrescrever dado dela (banco, biblioteca, `~/.bruto`) como
 * conserto. O achado que originou a classe: a saída do estado intermediário
 * da migração mandava apagar o `bruto.db` — com a biblioteca dentro.
 *
 * A varredura caça o PAR "verbo destrutivo + dado da pessoa" dentro do MESMO
 * literal de string (fora de comentário), em qualquer ordem. Toda ocorrência
 * tem de estar justificada em `ARQUIVOS_JUSTIFICADOS_DD`; ocorrência nova
 * quebra a suíte até ser triada.
 */
const DD_VERBO = "apague|apagar|exclua|excluir|remova|remover|deletar|delete";
const DD_DADO = "bruto\\.db|~\\/\\.bruto|dbPath|\\bbanco\\b|\\bbiblioteca\\b";
const DD_PROIBIDO = new RegExp(
  `(["'\`])(?:\\\\.|(?!\\1).)*(?:(?:${DD_VERBO})(?:\\\\.|(?!\\1).)*(?:${DD_DADO})|(?:${DD_DADO})(?:\\\\.|(?!\\1).)*(?:${DD_VERBO}))(?:\\\\.|(?!\\1).)*\\1`,
  "i",
);

/**
 * As ÚNICAS ocorrências do par verbo+dado permitidas, e por quê: AÇÃO
 * explícita da pessoa, com confirmação na tela — nunca orientação de
 * conserto. Mudou o conjunto? Este teste falha até a lista ser triada.
 */
const ARQUIVOS_JUSTIFICADOS_DD: Record<string, string> = {
  "src/components/filoes-client.tsx":
    "AÇÃO explícita da pessoa com confirmação (apagar um filão), não conserto — o próprio texto garante que os brutos continuam na biblioteca",
};

/** Heurística "não é comentário": comentário de linha, de bloco e JSX. */
function ehCodigo(linha: string): boolean {
  const t = linha.trim();
  return !(
    t.startsWith("//") ||
    t.startsWith("/*") ||
    t.startsWith("*") ||
    t.startsWith("{/*")
  );
}

describe("textos de tela (ERROR_HINT) — verdadeiros nos dois modos", () => {
  test("LLM_NOT_CONFIGURED: plano primeiro, ~/.bruto/.env presente, sem .env.example", () => {
    const h = ERROR_HINT.LLM_NOT_CONFIGURED;
    assert.ok(h.includes("claude") && h.includes("codex"), h);
    assert.ok(h.includes("~/.bruto/.env"), h);
    assert.ok(!h.includes(".env.example"), h);
  });

  test("LLM_AUTH: aponta o ~/.bruto/.env do app instalado e o .env do código-fonte", () => {
    const h = ERROR_HINT.LLM_AUTH;
    assert.ok(h.includes("~/.bruto/.env"), h);
    assert.ok(!h.includes(".env.example"), h);
  });

  test("NO_TRANSCRIPT e YTDLP_OUTDATED: o caminho do app instalado está nomeado", () => {
    assert.ok(ERROR_HINT.NO_TRANSCRIPT.includes("app instalado"), ERROR_HINT.NO_TRANSCRIPT);
    assert.ok(ERROR_HINT.YTDLP_OUTDATED.includes("app instalado"), ERROR_HINT.YTDLP_OUTDATED);
  });

  test("NENHUM hint manda a arquivo/comando que o pacote não tem", () => {
    for (const [codigo, hint] of Object.entries(ERROR_HINT)) {
      assert.ok(!hint.includes(".env.example"), `${codigo}: ${hint}`);
      assert.ok(!/npm run /.test(hint), `${codigo}: ${hint}`);
      assert.ok(!hint.includes("bash install/"), `${codigo}: ${hint}`);
      assert.ok(!hint.includes("launcher/"), `${codigo}: ${hint}`);
    }
  });
});

describe("varredura da classe Y em src/**", () => {
  test("toda instrução proibida está num arquivo justificado (nenhum a mais, nenhum a menos)", () => {
    const ocorrencias = new Map<string, string[]>();
    for (const arq of arquivos(SRC)) {
      const rel = path.relative(RAIZ, arq);
      const linhas = fs.readFileSync(arq, "utf8").split("\n");
      linhas.forEach((linha, i) => {
        if (!ehCodigo(linha)) return;
        if (PROIBIDO.test(linha)) {
          const lista = ocorrencias.get(rel) ?? [];
          lista.push(`${i + 1}: ${linha.trim().slice(0, 120)}`);
          ocorrencias.set(rel, lista);
        }
      });
    }

    const achados = [...ocorrencias.keys()].sort();
    const esperados = Object.keys(ARQUIVOS_JUSTIFICADOS).sort();
    const detalhe = [...ocorrencias.entries()]
      .map(([a, ls]) => `\n  ${a}\n    ${ls.join("\n    ")}`)
      .join("");
    assert.deepEqual(
      achados,
      esperados,
      `a varredura mudou — triar antes de seguir.${detalhe}`,
    );
  });

  test("arquivos por-modo/neutros trazem o caminho do pacote no próprio arquivo", () => {
    const porModo: ReadonlyArray<readonly [string, string]> = [
      ["src/lib/format.ts", "~/.bruto/.env"],
      ["src/pipeline/lib/llm/index.ts", "~/.bruto/.env"],
      ["src/scripts/doctor.ts", "~/.bruto/.env"],
      ["src/db/migrate.ts", "app instalado"],
    ];
    for (const [arquivo, vocabulo] of porModo) {
      const conteudo = fs.readFileSync(path.join(RAIZ, arquivo), "utf8");
      assert.ok(
        conteudo.includes(vocabulo),
        `${arquivo} deveria conter "${vocabulo}" (${ARQUIVOS_JUSTIFICADOS[arquivo]})`,
      );
    }
  });
});

describe("varredura da classe DD em src/**", () => {
  test("nenhuma instrução destrutiva sobre dado da pessoa fora dos justificados (nenhum a mais, nenhum a menos)", () => {
    const ocorrencias = new Map<string, string[]>();
    for (const arq of arquivos(SRC)) {
      const rel = path.relative(RAIZ, arq);
      const linhas = fs.readFileSync(arq, "utf8").split("\n");
      linhas.forEach((linha, i) => {
        if (!ehCodigo(linha)) return;
        if (DD_PROIBIDO.test(linha)) {
          const lista = ocorrencias.get(rel) ?? [];
          lista.push(`${i + 1}: ${linha.trim().slice(0, 120)}`);
          ocorrencias.set(rel, lista);
        }
      });
    }

    const achados = [...ocorrencias.keys()].sort();
    const esperados = Object.keys(ARQUIVOS_JUSTIFICADOS_DD).sort();
    const detalhe = [...ocorrencias.entries()]
      .map(([a, ls]) => `\n  ${a}\n    ${ls.join("\n    ")}`)
      .join("");
    assert.deepEqual(
      achados,
      esperados,
      `a varredura DD mudou — triar antes de seguir.${detalhe}`,
    );
  });
});
