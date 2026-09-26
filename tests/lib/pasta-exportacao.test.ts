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
  obterPastaId,
  obterPastaSalva,
  pedirPermissao,
  permissaoAtual,
  sanitizarNomeArquivo,
  suportaPastaLocal,
} from "@/lib/pasta-exportacao";
import {
  deveMarcarExportado,
  idsPendentesDeExportacao,
  nomeArquivoDoCabecalho,
  esquecerExportacaoDoVideo,
  obterExportados,
  pastaAindaExisteNoDisco,
  reexportarAposArtefatoNovo,
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

  test("trunca em 200 BYTES (ASCII: bytes == chars)", () => {
    const longo = "x".repeat(300);
    const resultado = sanitizarNomeArquivo(longo);
    assert.equal(resultado.length, 200);
    assert.equal(new TextEncoder().encode(resultado).length, 200);
  });

  // Item 4 (4ª revisão, Grok): truncar por `.length` (UTF-16) deixava passar
  // título muito CJK/emoji que cabia em 150/200 "caracteres" JS mas estourava
  // os 255 BYTES reais do sistema de arquivos — getDirectoryHandle rejeitava
  // na hora de exportar, e como a marca de "já exportado" agora exige
  // sucesso pleno, o vídeo nunca marcava: retry pra sempre.
  test("título muito emoji: o corte é por BYTES, nunca separa um emoji ao meio", () => {
    const emoji = "🔥"; // 2 unidades UTF-16 (par substituto), 4 bytes UTF-8
    const titulo = emoji.repeat(60); // 240 bytes UTF-8 — acima do teto de 200
    const resultado = sanitizarNomeArquivo(titulo);
    const bytes = new TextEncoder().encode(resultado).length;
    assert.ok(bytes <= 200, `deveria caber em 200 bytes: ${bytes}`);
    // Nenhum caractere de substituição (U+FFFD) nem meio-par-substituto —
    // só emoji inteiros, do início ao fim.
    assert.ok(!resultado.includes("�"), "não deveria haver caractere de substituição");
    assert.ok(
      [...resultado].every((c) => c === emoji),
      `todo caractere deveria ser o emoji inteiro: ${JSON.stringify(resultado)}`,
    );
  });

  test("título CJK: o corte é por BYTES (3 bytes cada), não por unidade UTF-16", () => {
    const titulo = "字".repeat(100); // 1 unidade UTF-16 cada, mas 3 bytes UTF-8 cada = 300 bytes
    const resultado = sanitizarNomeArquivo(titulo);
    const bytes = new TextEncoder().encode(resultado).length;
    assert.ok(bytes <= 200, `deveria caber em 200 bytes: ${bytes}`);
    assert.ok(
      [...resultado].every((c) => c === "字"),
      "todo caractere deveria ser o CJK inteiro, nunca um byte solto decodificado errado",
    );
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
    const tituloLongo = "x".repeat(300);
    const resultado = nomeDaPastaDoVideo(tituloLongo, "id-completo-123");
    assert.ok(resultado.endsWith("(id-completo-123)"), `deveria terminar com o id inteiro: ${resultado}`);
    const bytes = new TextEncoder().encode(resultado).length;
    assert.ok(bytes <= 200, `deveria caber no teto de 200 bytes: ${bytes}`);
  });

  test("título muito emoji: o corte pro sufixo caber é por BYTES, nunca separa um emoji ao meio", () => {
    const titulo = "🔥".repeat(60);
    const resultado = nomeDaPastaDoVideo(titulo, "abc123");
    assert.ok(resultado.endsWith("(abc123)"), `deveria terminar com o id inteiro: ${resultado}`);
    const bytes = new TextEncoder().encode(resultado).length;
    assert.ok(bytes <= 200, `deveria caber no teto de 200 bytes: ${bytes}`);
    assert.ok(!resultado.includes("�"), "não deveria haver caractere de substituição");
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

  // Item 1 (4ª revisão): o servidor manda filename* (RFC 6266) pra título com
  // aspas curvas/emoji/CJK, que quebrava o filename= cru com 500. O parser
  // prefere essa forma quando presente.
  test("prefere filename*=UTF-8'' (RFC 6266) quando presente — é a fonte confiável", () => {
    const titulo = "Comenta “IA” que eu te mando o passo a passo"; // aspas curvas — o título real que derrubava o 500
    const codificado = encodeURIComponent(titulo);
    const header = `attachment; filename="Comenta _IA_ que eu te mando o passo a passo.docx"; filename*=UTF-8''${codificado}.docx`;
    assert.equal(nomeArquivoDoCabecalho(header, "fallback"), `${titulo}.docx`);
  });

  test("emoji no filename* chega intacto", () => {
    const titulo = "Aula 🔥 de verdade";
    const header = `attachment; filename="Aula _ de verdade.docx"; filename*=UTF-8''${encodeURIComponent(titulo)}.docx`;
    assert.equal(nomeArquivoDoCabecalho(header, "fallback"), `${titulo}.docx`);
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

describe("deveMarcarExportado — item 2 da 3ª revisão, só marca em sucesso PLENO", () => {
  test("sucesso pleno (escreveu tudo) → marca", () => {
    assert.equal(deveMarcarExportado(5, 5), true);
    assert.equal(deveMarcarExportado(0, 0), true); // vídeo sem artefato nenhum — trivialmente pleno
  });

  test("cópia parcial (faltou pelo menos 1) → NÃO marca, mesmo já tendo escrito algo", () => {
    assert.equal(deveMarcarExportado(3, 5), false);
    assert.equal(deveMarcarExportado(1, 5), false);
  });

  test("nada escrito antes de uma exceção (ex.: rede caiu no GET do vídeo) → NÃO marca", () => {
    assert.equal(deveMarcarExportado(0, 5), false);
  });

  test("exceção antes até de saber quantos artefatos existem (total no sentinela -1) → NÃO marca", () => {
    assert.equal(deveMarcarExportado(0, -1), false);
  });

  test("mesma regra nos dois caminhos: catch com laço interrompido no meio nunca bate escritos === total", () => {
    // Um catch só teria escritos === total se o laço tivesse terminado por
    // completo antes da exceção — cenário legítimo, tratado igual ao sucesso.
    assert.equal(deveMarcarExportado(5, 5), true);
    assert.equal(deveMarcarExportado(4, 5), false);
  });
});

describe("pastaAindaExisteNoDisco — item 4, distingue 'pasta sumiu' de erro comum", () => {
  function duploComIterador(comportamento: "existe" | "sumiu"): FileSystemDirectoryHandle {
    return {
      values: () => ({
        next: async () => {
          if (comportamento === "sumiu") {
            throw new DOMException("A requested file or directory could not be found", "NotFoundError");
          }
          return { done: true, value: undefined };
        },
      }),
    } as unknown as FileSystemDirectoryHandle;
  }

  test("pasta existe (mesmo vazia) → true, sem lançar", async () => {
    assert.equal(await pastaAindaExisteNoDisco(duploComIterador("existe")), true);
  });

  test("pasta apagada do disco → false, nunca lança", async () => {
    assert.equal(await pastaAindaExisteNoDisco(duploComIterador("sumiu")), false);
  });
});

describe("idsPendentesDeExportacao — lógica pura do catch-up (chave por videoId+jobId)", () => {
  test("vídeo done sem marca de exportado é pendente", () => {
    const prontos = [{ videoId: "a", jobId: "job-a1" }, { videoId: "b", jobId: "job-b1" }];
    assert.deepEqual(idsPendentesDeExportacao(prontos, {}), prontos);
  });

  test("vídeo já exportado (mesmo jobId marcado) não volta como pendente", () => {
    const prontos = [{ videoId: "a", jobId: "job-a1" }, { videoId: "b", jobId: "job-b1" }];
    const jaExportados = { a: "job-a1" };
    assert.deepEqual(idsPendentesDeExportacao(prontos, jaExportados), [{ videoId: "b", jobId: "job-b1" }]);
  });

  test("todos já exportados (mesmo job) → nenhum pendente", () => {
    const prontos = [{ videoId: "a", jobId: "job-a1" }, { videoId: "b", jobId: "job-b1" }];
    const jaExportados = { a: "job-a1", b: "job-b1" };
    assert.deepEqual(idsPendentesDeExportacao(prontos, jaExportados), []);
  });

  test("nenhum vídeo pronto no servidor → nenhum pendente, mesmo com marcas antigas", () => {
    assert.deepEqual(idsPendentesDeExportacao([], { a: "job-antigo" }), []);
  });

  test("vídeo antigo (done antes de a pessoa ligar o interruptor) também é pendente — sem data de corte", () => {
    // O catch-up não distingue "terminou agora" de "terminou há uma semana":
    // done sem marca de exportado é sempre candidato.
    const prontos = [
      { videoId: "antigo-1", jobId: "j1" },
      { videoId: "antigo-2", jobId: "j2" },
      { videoId: "novo", jobId: "j3" },
    ];
    const jaExportados = { novo: "j3" };
    assert.deepEqual(idsPendentesDeExportacao(prontos, jaExportados), [
      { videoId: "antigo-1", jobId: "j1" },
      { videoId: "antigo-2", jobId: "j2" },
    ]);
  });

  // Item 2 (4ª revisão, os dois revisores) — o achado central desta rodada:
  // reprocessar o vídeo (retry) gera um jobId NOVO. A marca do job antigo
  // não bate mais com o job novo, então o vídeo volta a ser pendente — sem
  // isso, a transcrição/tradução nova do retry nunca chegava na pasta.
  test("mesmo vídeo com jobId DIFERENTE do marcado (retry) volta a ser pendente", () => {
    const prontos = [{ videoId: "a", jobId: "job-novo-do-retry" }];
    const jaExportados = { a: "job-antigo-ja-exportado" };
    assert.deepEqual(idsPendentesDeExportacao(prontos, jaExportados), prontos);
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

  test("obterPastaId() nunca lança — volta null quando não há suporte", async () => {
    assert.equal(await obterPastaId(), null);
  });

  test("obterExportados() nunca lança sem localStorage/IndexedDB — volta objeto vazio", async () => {
    assert.deepEqual(await obterExportados(), {});
  });

  // Item 2 (5ª revisão, Grok): endpoints sob demanda (aula, transcrição
  // organizada/pra IA) chamam isto depois de gerar o artefato. Nunca deve
  // travar a UI mesmo sem suporte à API — a pessoa continua vendo o toast de
  // sucesso do endpoint normalmente.
  test("esquecerExportacaoDoVideo()/reexportarAposArtefatoNovo() nunca lançam sem suporte", async () => {
    await assert.doesNotReject(esquecerExportacaoDoVideo("algum-video-id"));
    await assert.doesNotReject(reexportarAposArtefatoNovo("algum-video-id"));
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
