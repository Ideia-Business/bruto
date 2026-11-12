/**
 * `mensagemSemBackend` — a mensagem de "sem transcritor" tem de dizer a CAUSA
 * verdadeira (demanda b311ebf9).
 *
 * O bug real, visto no vídeo `jNQXAC9IVRw` (TEM legenda) com a opção de
 * transcrição por IA marcada: com `forceWhisper=true` a etapa 02-transcript
 * pula as legendas e, sem backend instalado, mostrava "Vídeo sem legenda…" —
 * FALSO, a legenda nem foi consultada. A mensagem nova diz que a transcrição
 * local foi PEDIDA e não está instalada, e oferece os DOIS caminhos: instalar
 * (no pacote: Configurações → "Instalar transcrição local", ~3 GB; no clone: o
 * texto de instalação atual) OU desmarcar a opção para usar a legenda do vídeo.
 *
 * Sem forçar (legenda consultada e não veio), a mensagem atual continua.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

let mensagemSemBackend: typeof import("@/pipeline/lib/transcribe").mensagemSemBackend;
let SEM_BACKEND: typeof import("@/pipeline/lib/transcribe").SEM_BACKEND;

let salvaEmpacotado: string | undefined;

before(async () => {
  salvaEmpacotado = process.env.BRUTO_EMPACOTADO;
  ({ mensagemSemBackend, SEM_BACKEND } = await import("@/pipeline/lib/transcribe"));
});

after(() => {
  if (salvaEmpacotado === undefined) delete process.env.BRUTO_EMPACOTADO;
  else process.env.BRUTO_EMPACOTADO = salvaEmpacotado;
});

describe("mensagemSemBackend — Whisper pedido (forçado)", () => {
  test("pacote: não culpa a legenda; oferece instalar OU desmarcar a opção", () => {
    process.env.BRUTO_EMPACOTADO = "1";
    const msg = mensagemSemBackend(true);
    // A legenda NEM FOI consultada — a mensagem não pode afirmar que faltou.
    assert.ok(!msg.includes("sem legenda"), `mensagem culpou a legenda: ${msg}`);
    // A causa verdadeira: a transcrição local foi pedida e não está instalada.
    assert.match(msg, /transcri/i);
    assert.match(msg, /pedida|pedido|marcad/i);
    assert.ok(msg.includes("não está instalada"));
    // Caminho 1 — instalar (o do pacote): Configurações → Instalar transcrição local (~3 GB).
    assert.ok(msg.includes("Configurações"));
    assert.ok(msg.includes("Instalar transcrição local"));
    assert.ok(msg.includes("3 GB"));
    // Caminho 2 — desmarcar a opção para usar a legenda do vídeo.
    assert.ok(msg.toLowerCase().includes("desmarque"));
    assert.ok(msg.includes("legenda do vídeo"));
  });

  test("clone: o texto de instalação atual + o caminho de desmarcar", () => {
    delete process.env.BRUTO_EMPACOTADO;
    const msg = mensagemSemBackend(true);
    assert.ok(!msg.includes("sem legenda"), `mensagem culpou a legenda: ${msg}`);
    // O texto de instalação que o clone já usa, inteiro:
    assert.ok(msg.includes("sem --sem-whisper"));
    assert.ok(msg.includes("uv tool install mlx-whisper"));
    assert.ok(msg.includes("uv tool install openai-whisper"));
    // E o segundo caminho:
    assert.ok(msg.toLowerCase().includes("desmarque"));
    assert.ok(msg.includes("legenda do vídeo"));
  });
});

describe("mensagemSemBackend — sem forçar (mensagem atual intacta)", () => {
  test("pacote: continua dizendo 'Vídeo sem legenda e a transcrição local…'", () => {
    process.env.BRUTO_EMPACOTADO = "1";
    const msg = mensagemSemBackend(false);
    assert.ok(
      msg.startsWith("Vídeo sem legenda e a transcrição local (Whisper) não está instalada."),
      `mensagem atual do pacote mudou: ${msg}`,
    );
    assert.ok(msg.includes("Instalar transcrição local"));
    assert.ok(msg.includes("3 GB"));
  });

  test("clone: SEM_BACKEND exato, começando por 'Vídeo sem legenda'", () => {
    delete process.env.BRUTO_EMPACOTADO;
    assert.equal(mensagemSemBackend(false), SEM_BACKEND);
    assert.equal(mensagemSemBackend(), SEM_BACKEND);
    assert.ok(SEM_BACKEND.startsWith("Vídeo sem legenda"));
    assert.ok(SEM_BACKEND.includes("uv tool install mlx-whisper"));
  });
});
