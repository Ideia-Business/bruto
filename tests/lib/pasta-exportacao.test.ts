/**
 * A File System Access API real não existe no Node (ambiente de teste, via
 * `tsx --test`) — não há `window`, `indexedDB` nem `FileSystemDirectoryHandle`.
 * O que dá para testar sem navegador: (1) a sanitização de nomes, pura; (2)
 * que a detecção de suporte e a leitura de pasta salva nunca lançam fora do
 * navegador — voltam `false`/`null` em silêncio, o que é o comportamento que
 * `exportarVideoAutomaticamente` depende para nunca quebrar o processamento
 * quando a pessoa está num navegador sem a API; (3) a decisão de permissão,
 * com um duplo de `FileSystemDirectoryHandle` (só os dois métodos usados).
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  autoExportarAtivado,
  definirAutoExportar,
  obterPastaSalva,
  pedirPermissao,
  permissaoAtual,
  sanitizarNomeArquivo,
  suportaPastaLocal,
} from "@/lib/pasta-exportacao";
import { nomeArquivoDoCabecalho } from "@/lib/exportar-artefatos";

describe("sanitizarNomeArquivo", () => {
  test("troca caracteres inválidos em nome de pasta/arquivo por hífen", () => {
    assert.equal(sanitizarNomeArquivo('a/b\\c?d%e*f:g|h"i<j>k'), "a-b-c-d-e-f-g-h-i-j-k");
  });

  test("mantém acentuação e espaços comuns", () => {
    assert.equal(sanitizarNomeArquivo("Resumo - Não é bug, é feature"), "Resumo - Não é bug, é feature");
  });

  test("nome vazio ou só espaço vira 'sem-nome'", () => {
    assert.equal(sanitizarNomeArquivo(""), "sem-nome");
    assert.equal(sanitizarNomeArquivo("   "), "sem-nome");
  });

  test("trunca em 150 caracteres", () => {
    const longo = "x".repeat(300);
    assert.equal(sanitizarNomeArquivo(longo).length, 150);
  });
});

describe("nomeArquivoDoCabecalho", () => {
  test("extrai o filename do Content-Disposition", () => {
    assert.equal(
      nomeArquivoDoCabecalho('attachment; filename="Resumo - Aula 1.docx"', "fallback"),
      "Resumo - Aula 1.docx",
    );
  });

  test("sem cabeçalho usa o fallback", () => {
    assert.equal(nomeArquivoDoCabecalho(null, "docx"), "docx");
  });

  test("cabeçalho sem filename usa o fallback", () => {
    assert.equal(nomeArquivoDoCabecalho("attachment", "docx"), "docx");
  });
});

describe("ambiente sem File System Access API (Node/CI, Safari/Firefox)", () => {
  test("suportaPastaLocal() nunca lança — volta false", () => {
    assert.equal(suportaPastaLocal(), false);
  });

  test("obterPastaSalva() nunca lança — volta null quando não há suporte", async () => {
    assert.equal(await obterPastaSalva(), null);
  });

  test("autoExportarAtivado()/definirAutoExportar() nunca lançam sem localStorage", () => {
    assert.doesNotThrow(() => definirAutoExportar(true));
    assert.equal(autoExportarAtivado(), false);
  });
});

describe("permissaoAtual / pedirPermissao — com duplo de FileSystemDirectoryHandle", () => {
  function duplo(resultado: PermissionState | "lança"): FileSystemDirectoryHandle {
    const chamada = async () => {
      if (resultado === "lança") throw new Error("negado pelo navegador");
      return resultado;
    };
    return {
      queryPermission: chamada,
      requestPermission: chamada,
    } as unknown as FileSystemDirectoryHandle;
  }

  test("repassa o estado quando o handle responde 'granted'", async () => {
    const handle = duplo("granted");
    assert.equal(await permissaoAtual(handle), "granted");
    assert.equal(await pedirPermissao(handle), "granted");
  });

  test("repassa 'prompt' (permissão expirada após reiniciar o navegador)", async () => {
    const handle = duplo("prompt");
    assert.equal(await permissaoAtual(handle), "prompt");
  });

  test("erro do handle (ex.: pasta removida do disco) vira 'denied', nunca lança", async () => {
    const handle = duplo("lança");
    assert.equal(await permissaoAtual(handle), "denied");
    assert.equal(await pedirPermissao(handle), "denied");
  });
});
