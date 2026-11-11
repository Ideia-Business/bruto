/**
 * O `.env` DA PESSOA no app empacotado (`$BRUTO_DATA_ROOT/.env`, default
 * `~/.bruto/.env`) — o substituto do `.env` do checkout, que é segredo da
 * máquina de build e NÃO viaja no pacote.
 *
 * Cobre o parser (deliberadamente simples, nada executa nem expande), a
 * carga (só modo pacote, só variáveis conhecidas, nunca sobrescreve o
 * ambiente, log sem valor), o aviso de permissão e a trava da lista de
 * variáveis conhecidas contra o registro de provedores.
 */
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  analisarEnv,
  carregarEnvDoUsuario,
  alvoEnvUsuario,
  VARIAVEIS_CONHECIDAS,
} from "@/lib/env-usuario";
import { listarProvedores } from "@/pipeline/lib/llm";

const CHAVE_FALSA = "chave-falsa-de-teste";

let raiz: string;
let dataRoot: string;
let salvas: Record<string, string | undefined>;

const VARS = ["BRUTO_EMPACOTADO", "BRUTO_DATA_ROOT", "MALICIOSA", ...VARIAVEIS_CONHECIDAS];

beforeEach(() => {
  raiz = fs.mkdtempSync(path.join(os.tmpdir(), "bruto-env-usuario-"));
  dataRoot = path.join(raiz, "dados");
  fs.mkdirSync(dataRoot, { recursive: true });
  salvas = {};
  for (const v of VARS) {
    salvas[v] = process.env[v];
    delete process.env[v];
  }
  process.env.BRUTO_DATA_ROOT = dataRoot;
});

afterEach(() => {
  for (const v of VARS) {
    if (salvas[v] === undefined) delete process.env[v];
    else process.env[v] = salvas[v]!;
  }
  fs.rmSync(raiz, { recursive: true, force: true });
});

/** Escreve o `.env` da pessoa com a permissão EXATA (chmod depois: o umask mascara o mode do create). */
function escreverEnv(conteudo: string, modo = 0o600): string {
  const arquivo = path.join(dataRoot, ".env");
  fs.writeFileSync(arquivo, conteudo);
  fs.chmodSync(arquivo, modo);
  return arquivo;
}

describe("analisarEnv — parser deliberadamente simples", () => {
  test("CHAVE=valor, comentário # e aspas opcionais", () => {
    const pares = analisarEnv(
      [
        "# comentário ignorado",
        "",
        "ANTHROPIC_API_KEY=sk-ant-teste",
        'OPENAI_API_KEY="sk-com-aspas-duplas"',
        "GOOGLE_API_KEY='sk-com-aspas-simples'",
        "  BRUTO_MODEL_FAST  =  modelo-com-espacos  ",
      ].join("\n"),
    );
    assert.deepEqual(pares, [
      ["ANTHROPIC_API_KEY", "sk-ant-teste"],
      ["OPENAI_API_KEY", "sk-com-aspas-duplas"],
      ["GOOGLE_API_KEY", "sk-com-aspas-simples"],
      ["BRUTO_MODEL_FAST", "modelo-com-espacos"],
    ]);
  });

  test("aceita CRLF e ignora linhas malformadas sem quebrar o boot", () => {
    const pares = analisarEnv(
      ["sem-sinal-de-igual", "=sem-nome", "1COMECA_COM_DIGITO=x", "A=1\r", "B=2"].join("\n"),
    );
    assert.deepEqual(pares, [
      ["A", "1"],
      ["B", "2"],
    ]);
  });

  test("NADA é executado nem expandido: $(...) e crases ficam LITERAIS", () => {
    const marcador = path.join(raiz, "nao-pode-existir");
    const pares = analisarEnv(`ANTHROPIC_API_KEY=sk-$(touch ${marcador})\`whoami\``);
    assert.equal(pares.length, 1);
    assert.equal(pares[0][1], `sk-$(touch ${marcador})\`whoami\``);
    assert.equal(fs.existsSync(marcador), false, "o parser EXECUTOU o valor");
  });
});

describe("carregarEnvDoUsuario — modo pacote", () => {
  test("carrega a variável conhecida e a desconhecida NÃO entra; o log nomeia, nunca vaza valor", () => {
    process.env.BRUTO_EMPACOTADO = "1";
    escreverEnv(`ANTHROPIC_API_KEY=${CHAVE_FALSA}\nMALICIOSA=1\n`);

    const linhas: string[] = [];
    const r = carregarEnvDoUsuario((m) => linhas.push(m));

    assert.equal(process.env.ANTHROPIC_API_KEY, CHAVE_FALSA);
    assert.equal(process.env.MALICIOSA, undefined, "variável desconhecida NÃO pode entrar");
    assert.deepEqual(r.carregadas, ["ANTHROPIC_API_KEY"]);

    const log = linhas.join("\n");
    assert.match(log, /ANTHROPIC_API_KEY/, "o log diz QUAIS nomes foram carregados");
    assert.ok(!log.includes(CHAVE_FALSA), "o log NUNCA pode conter o valor");
  });

  test("NUNCA sobrescreve variável já definida no ambiente", () => {
    process.env.BRUTO_EMPACOTADO = "1";
    process.env.OPENAI_API_KEY = "valor-do-ambiente";
    escreverEnv("OPENAI_API_KEY=valor-do-arquivo\n");

    const r = carregarEnvDoUsuario(() => {});

    assert.equal(process.env.OPENAI_API_KEY, "valor-do-ambiente");
    assert.deepEqual(r.carregadas, []);
  });

  test("permissão aberta (0644): carrega e registra UM aviso de permissão, sem valor", () => {
    process.env.BRUTO_EMPACOTADO = "1";
    escreverEnv(`GOOGLE_API_KEY=${CHAVE_FALSA}\n`, 0o644);

    const linhas: string[] = [];
    const r = carregarEnvDoUsuario((m) => linhas.push(m));

    assert.equal(process.env.GOOGLE_API_KEY, CHAVE_FALSA, "carrega mesmo assim");
    assert.equal(r.avisoPermissao, true);
    const avisos = linhas.filter((l) => /chmod 600/.test(l));
    assert.equal(avisos.length, 1, `esperava UM aviso, veio: ${linhas.join(" | ")}`);
    assert.ok(!avisos[0].includes(CHAVE_FALSA), "o aviso não pode conter valor");
  });

  test("permissão fechada (0600): carrega sem aviso", () => {
    process.env.BRUTO_EMPACOTADO = "1";
    escreverEnv(`GOOGLE_API_KEY=${CHAVE_FALSA}\n`, 0o600);

    const linhas: string[] = [];
    const r = carregarEnvDoUsuario((m) => linhas.push(m));

    assert.equal(process.env.GOOGLE_API_KEY, CHAVE_FALSA);
    assert.equal(r.avisoPermissao, false);
    assert.equal(linhas.filter((l) => /chmod 600/.test(l)).length, 0);
  });

  test("arquivo ausente: silêncio", () => {
    process.env.BRUTO_EMPACOTADO = "1";
    const linhas: string[] = [];
    const r = carregarEnvDoUsuario((m) => linhas.push(m));

    assert.deepEqual(r, { carregadas: [], avisoPermissao: false });
    assert.deepEqual(linhas, []);
  });
});

describe("carregarEnvDoUsuario — modo clone", () => {
  test("não carrega NADA, mesmo com o arquivo lá — o clone não muda de comportamento", () => {
    // BRUTO_EMPACOTADO ausente = clone.
    escreverEnv(`ANTHROPIC_API_KEY=${CHAVE_FALSA}\n`);

    const linhas: string[] = [];
    const r = carregarEnvDoUsuario((m) => linhas.push(m));

    assert.equal(process.env.ANTHROPIC_API_KEY, undefined);
    assert.deepEqual(r.carregadas, []);
    assert.deepEqual(linhas, [], "no clone nem log sai");
  });
});

describe("a lista de variáveis conhecidas não fica para trás", () => {
  test("toda chave de provedor do registro (listarProvedores) está na lista", () => {
    const chaves = listarProvedores()
      .map((p) => p.envVar)
      .filter((v): v is string => v !== null);
    for (const c of chaves) {
      assert.ok(
        (VARIAVEIS_CONHECIDAS as readonly string[]).includes(c),
        `o provedor usa ${c}, mas o .env da pessoa não a conhece — provedor novo? atualize env-usuario.ts`,
      );
    }
  });

  test("a lista inteira é exatamente esta (mudou? atualize o teste DE PROPÓSITO)", () => {
    assert.deepEqual(
      [...VARIAVEIS_CONHECIDAS].sort(),
      [
        "ANTHROPIC_API_KEY",
        "BRUTO_LLM_PROVIDER",
        "BRUTO_MODEL_BALANCED",
        "BRUTO_MODEL_DEEP",
        "BRUTO_MODEL_FAST",
        "BRUTO_WHISPER_CPP_MODEL",
        "BRUTO_WHISPER_MODEL",
        "GEMINI_API_KEY",
        "GOOGLE_API_KEY",
        "OLLAMA_API_KEY",
        "OPENAI_API_KEY",
        "OPENROUTER_API_KEY",
      ].sort(),
    );
  });
});

describe("alvoEnvUsuario — o caminho que os textos de ajuda apontam", () => {
  test("pacote → ~/.bruto/.env; clone → .env", () => {
    process.env.BRUTO_EMPACOTADO = "1";
    assert.equal(alvoEnvUsuario(), "~/.bruto/.env");
    delete process.env.BRUTO_EMPACOTADO;
    assert.equal(alvoEnvUsuario(), ".env");
  });
});
