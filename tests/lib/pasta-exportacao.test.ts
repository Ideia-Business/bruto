/**
 * A File System Access API real não existe no Node (ambiente de teste, via
 * `tsx --test`) — não há `window`, `indexedDB` nem `FileSystemDirectoryHandle`.
 * O que dá para testar sem navegador: (1) a sanitização de nomes e o nome de
 * pasta com id, puros; (2) que a detecção de suporte e a leitura de pasta
 * salva nunca lançam fora do navegador — voltam `false`/`null` em silêncio,
 * o que é o comportamento que `exportarVideoAutomaticamente` depende para
 * nunca quebrar o processamento quando a pessoa está num navegador sem a
 * API; (3) a decisão de permissão, com um duplo de `FileSystemDirectoryHandle`
 * (só os dois métodos usados); (4) o parser do Content-Disposition; (5) a
 * lógica pura do catch-up ("quais IDs prontos ainda não foram exportados").
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  autoExportarAtivado,
  definirAutoExportar,
  nomeDaPastaDoVideo,
  obterPastaSalva,
  pedirPermissao,
  permissaoAtual,
  sanitizarNomeArquivo,
  suportaPastaLocal,
} from "@/lib/pasta-exportacao";
import {
  idsPendentesDeExportacao,
  nomeArquivoDoCabecalho,
  resultadoDaCopia,
} from "@/lib/exportar-artefatos";

describe("sanitizarNomeArquivo", () => {
  test("troca caracteres inválidos em nome de pasta/arquivo por hífen", () => {
    assert.equal(sanitizarNomeArquivo('a/b\\c?d%e*f:g|h"i<j>k'), "a-b-c-d-e-f-g-h-i-j-k");
  });

  test("mantém acentuação e espaços comuns", () => {
    assert.equal(sanitizarNomeArquivo("Resumo - Não é bug, é feature"), "Resumo - Não é bug, é feature");
  });

  test("nome vazio ou só espaço vira 'Sem título'", () => {
    assert.equal(sanitizarNomeArquivo(""), "Sem título");
    assert.equal(sanitizarNomeArquivo("   "), "Sem título");
  });

  test("trunca em 150 caracteres", () => {
    const longo = "x".repeat(300);
    assert.equal(sanitizarNomeArquivo(longo).length, 150);
  });

  // Item 3 — achado do Grok: ponto final, "."/".." puros e caracteres de
  // controle fazem getDirectoryHandle/getFileHandle REJEITAR a promessa.
  test("remove ponto final — Windows recusa 'Espere...' como nome", () => {
    assert.equal(sanitizarNomeArquivo("Espere..."), "Espere");
    assert.equal(sanitizarNomeArquivo("Aula 1."), "Aula 1");
  });

  test("'.' e '..' puros viram 'Sem título' — a própria API rejeita esses nomes", () => {
    assert.equal(sanitizarNomeArquivo("."), "Sem título");
    assert.equal(sanitizarNomeArquivo(".."), "Sem título");
    assert.equal(sanitizarNomeArquivo("..."), "Sem título");
  });

  test("remove caracteres de controle (U+0000–U+001F)", () => {
    assert.equal(sanitizarNomeArquivo("Aula\u0000 1\u001f Parte"), "Aula 1 Parte");
  });

  test("título terminado em ponto e truncado pelo limite ainda não sobra ponto final", () => {
    const longoComPontoNoCorte = "x".repeat(149) + "." + "y".repeat(50);
    const resultado = sanitizarNomeArquivo(longoComPontoNoCorte);
    assert.equal(resultado.endsWith("."), false);
  });
});

describe("nomeDaPastaDoVideo — item 1, evita colisão entre vídeos de mesmo título", () => {
  test("acrescenta o id entre parênteses", () => {
    assert.equal(nomeDaPastaDoVideo("Aula de Piano", "dQw4w9WgXcQ"), "Aula de Piano (dQw4w9WgXcQ)");
  });

  test("dois vídeos com o MESMO título sanitizado geram pastas DIFERENTES", () => {
    const a = nomeDaPastaDoVideo("Aula de Piano", "id-um");
    const b = nomeDaPastaDoVideo("Aula de Piano", "id-dois");
    assert.notEqual(a, b);
  });

  test("título muito longo cede espaço, mas o id NUNCA é cortado", () => {
    const tituloLongo = "x".repeat(200);
    const resultado = nomeDaPastaDoVideo(tituloLongo, "id-completo-123");
    assert.ok(resultado.endsWith("(id-completo-123)"), `deveria terminar com o id inteiro: ${resultado}`);
    assert.ok(resultado.length <= 150, `deveria caber no teto de 150: ${resultado.length}`);
  });
});

describe("nomeArquivoDoCabecalho", () => {
  test("extrai o filename do Content-Disposition", () => {
    assert.equal(
      nomeArquivoDoCabecalho('attachment; filename="Resumo - Aula 1.docx"', "fallback"),
      "Resumo - Aula 1.docx",
    );
  });

  // Item 2 — achado do Codex: o regex antigo parava no primeiro ';', mesmo
  // dentro das aspas, cortando o nome e colidindo artefatos do mesmo vídeo.
  test("ponto-e-vírgula DENTRO das aspas não corta o nome", () => {
    assert.equal(
      nomeArquivoDoCabecalho('attachment; filename="Aula; parte 2.docx"', "fallback"),
      "Aula; parte 2.docx",
    );
  });

  test("sem cabeçalho usa o fallback", () => {
    assert.equal(nomeArquivoDoCabecalho(null, "docx"), "docx");
  });

  test("cabeçalho sem filename usa o fallback", () => {
    assert.equal(nomeArquivoDoCabecalho("attachment", "docx"), "docx");
  });

  test("forma sem aspas (fallback do RFC) ainda funciona", () => {
    assert.equal(nomeArquivoDoCabecalho("attachment; filename=simples.txt", "fallback"), "simples.txt");
  });
});

describe("resultadoDaCopia — item 5, nunca anuncia sucesso pleno com artefato faltando", () => {
  test("todos os artefatos escritos → sucesso", () => {
    assert.equal(resultadoDaCopia(5, 5).tipo, "sucesso");
  });

  test("nenhum artefato (vídeo sem artefato nenhum) → sucesso trivial, nada para copiar", () => {
    assert.equal(resultadoDaCopia(0, 0).tipo, "sucesso");
  });

  test("parte dos artefatos falhou → parcial, com a contagem na mensagem", () => {
    const r = resultadoDaCopia(3, 5);
    assert.equal(r.tipo, "parcial");
    assert.match(r.titulo, /3 de 5/);
  });
});

describe("idsPendentesDeExportacao — item 4, lógica pura do catch-up", () => {
  test("vídeo done sem marca de exportado é pendente", () => {
    assert.deepEqual(idsPendentesDeExportacao(["a", "b"], new Set()), ["a", "b"]);
  });

  test("vídeo já exportado (marca no localStorage) não volta como pendente", () => {
    assert.deepEqual(idsPendentesDeExportacao(["a", "b"], new Set(["a"])), ["b"]);
  });

  test("todos já exportados → nenhum pendente", () => {
    assert.deepEqual(idsPendentesDeExportacao(["a", "b"], new Set(["a", "b"])), []);
  });

  test("nenhum vídeo pronto no servidor → nenhum pendente, mesmo com marcas antigas", () => {
    assert.deepEqual(idsPendentesDeExportacao([], new Set(["a"])), []);
  });

  test("vídeo antigo (done antes de a pessoa ligar o interruptor) também é pendente — sem data de corte", () => {
    // O catch-up não distingue "terminou agora" de "terminou há uma semana":
    // done sem marca de exportado é sempre candidato (decisão consciente do item 4).
    assert.deepEqual(idsPendentesDeExportacao(["antigo-1", "antigo-2", "novo"], new Set(["novo"])), [
      "antigo-1",
      "antigo-2",
    ]);
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
