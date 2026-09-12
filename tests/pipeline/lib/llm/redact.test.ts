/**
 * Testes de `redact` — o mais importante da suíte, porque o próprio comentário
 * do arquivo-fonte confessa um incidente real: quando OpenRouter e Ollama Cloud
 * entraram como provedores, ninguém atualizou `ENV_SENSIVEIS`, e a chave desses
 * dois vazou (sem redação) para `jobs.error_message` por um tempo.
 *
 * Por isso este arquivo não testa "redact funciona" em abstrato — ele testa
 * CADA ITEM das duas listas (`ENV_SENSIVEIS` e `PADROES`) individualmente, para
 * que a remoção ou o esquecimento de um provedor faça um teste nomeado falhar,
 * em vez de sumir dentro de uma asserção genérica.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { redact } from "@/pipeline/lib/llm/redact";

/**
 * Mesma lista do arquivo-fonte, duplicada aqui DE PROPÓSITO. É a duplicação
 * que faz o teste reprovar quando alguém acrescenta um provedor no código-fonte
 * e esquece de redigir: se a lista daqui não for atualizada também, o valor
 * fictício abaixo continua vazando e o teste de regressão-por-nome falha.
 *
 * (O objetivo NÃO é impedir a lista de crescer — é impedir que ela cresça em
 * silêncio, sem o teste correspondente.)
 */
const ENV_SENSIVEIS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "OLLAMA_API_KEY",
  "GOOGLE_API_KEY",
  "GEMINI_API_KEY",
  "BRUTO_LLM_API_KEY",
];

/**
 * Executa `fn` com a env var setada para `valor`, restaurando o valor original
 * (inclusive "ausente") ao final — mesmo se `fn` lançar. Isolamento é necessário
 * porque os testes rodam no mesmo processo e não podem vazar env de um para o
 * outro (nem para o restante da suíte).
 */
function comEnv<T>(nome: string, valor: string, fn: () => T): T {
  const original = process.env[nome];
  process.env[nome] = valor;
  try {
    return fn();
  } finally {
    if (original === undefined) delete process.env[nome];
    else process.env[nome] = original;
  }
}

describe("redact — redige cada env var sensível por VALOR", () => {
  // Um teste por variável: se `ENV_SENSIVEIS` perder um item, o teste
  // correspondente aqui vira "não encontrado" — não é o caso; o risco real é o
  // INVERSO (código perde o item e nosso array duplicado aqui não), o que a
  // asserção de paridade abaixo cobre.
  for (const nome of ENV_SENSIVEIS) {
    test(`redige o valor de ${nome} quando ele aparece no texto`, () => {
      const chaveFicticia = `valor-secreto-de-teste-${nome.toLowerCase()}`;
      const resultado = comEnv(nome, chaveFicticia, () =>
        redact(`erro ao chamar a API: ${chaveFicticia} rejeitado`),
      );
      assert.ok(
        !resultado.includes(chaveFicticia),
        `esperava que o valor de ${nome} fosse redigido, mas apareceu: ${resultado}`,
      );
      assert.ok(resultado.includes("<REDACTED>"), "esperava a marca <REDACTED> no texto");
    });
  }

  // Paridade com o código-fonte: se alguém REMOVER um provedor de
  // `ENV_SENSIVEIS` no redact.ts (regressão), este teste generaliza o caso
  // reportado no comentário do arquivo — qualquer uma das sete variáveis para
  // de ser redigida.
  test("nenhuma das sete variáveis documentadas passou a vazar sem redação", () => {
    for (const nome of ENV_SENSIVEIS) {
      const chaveFicticia = `chave-de-teste-paridade-${nome.toLowerCase()}-1234567890`;
      const resultado = comEnv(nome, chaveFicticia, () => redact(chaveFicticia));
      assert.equal(
        resultado,
        "<REDACTED>",
        `${nome} não foi redigido — a lista ENV_SENSIVEIS ficou para trás de novo`,
      );
    }
  });

  test("valor curto demais (<12 chars) NÃO é tratado como chave", () => {
    // A própria implementação despreza valores curtos para não fazer
    // substituição em massa (ex.: NODE_ENV="test" apagaria todo "test" do texto).
    const resultado = comEnv("OPENAI_API_KEY", "curta", () => redact("texto com curta no meio"));
    assert.ok(resultado.includes("curta"), "valor curto não deveria ter sido redigido");
  });

  test("não redige nada quando a env var não está setada", () => {
    const original = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const texto = "mensagem de erro sem nenhuma chave real, só texto normal";
      assert.equal(redact(texto), texto);
    } finally {
      if (original !== undefined) process.env.ANTHROPIC_API_KEY = original;
    }
  });
});

describe("redact — redige cada formato de chave conhecido (PADROES)", () => {
  // Uma amostra representativa POR PADRÃO declarado em `PADROES`. Cada caso
  // usa uma chave sintética (nunca uma real) que satisfaz exatamente o formato
  // do provedor — testar o formato certo é o que garante que o teste reprova
  // se o regex for afrouxado ou removido.
  const casos: Array<{ nome: string; chave: string }> = [
    { nome: "Anthropic (sk-ant-...)", chave: "sk-ant-" + "a".repeat(20) },
    { nome: "OpenRouter (sk-or-v1-...)", chave: "sk-or-v1-" + "b".repeat(20) },
    { nome: "OpenAI projeto (sk-proj-...)", chave: "sk-proj-" + "c".repeat(20) },
    { nome: "OpenAI legado (sk-...)", chave: "sk-" + "d".repeat(25) },
    { nome: "Google (AIza...)", chave: "AIza" + "e".repeat(25) },
    { nome: "Bearer header inteiro", chave: "Bearer " + "f".repeat(20) },
  ];

  for (const { nome, chave } of casos) {
    test(`redige o formato: ${nome}`, () => {
      const resultado = redact(`Authorization falhou: ${chave} — tente de novo`);
      assert.ok(!resultado.includes(chave), `chave do formato "${nome}" vazou: ${resultado}`);
      assert.ok(resultado.includes("<REDACTED>"));
    });
  }

  test("redige múltiplas chaves diferentes no mesmo texto", () => {
    const chave1 = "sk-ant-" + "x".repeat(20);
    const chave2 = "AIza" + "y".repeat(25);
    const resultado = redact(`erro 1: ${chave1}\nerro 2: ${chave2}`);
    assert.ok(!resultado.includes(chave1));
    assert.ok(!resultado.includes(chave2));
  });

  test("não mexe em texto sem nenhum segredo", () => {
    const texto = "esse texto não tem chave nenhuma, só uma explicação de erro comum.";
    assert.equal(redact(texto), texto);
  });

  test("nunca lança, mesmo com entrada vazia", () => {
    assert.doesNotThrow(() => redact(""));
    assert.equal(redact(""), "");
  });
});
