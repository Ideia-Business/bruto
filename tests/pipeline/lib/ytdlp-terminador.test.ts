/**
 * A URL vai ao yt-dlp DEPOIS de `--` (achado de segurança de 05/11/2026): um "ID
 * puro" de 11 caracteres começando com `-` (ex.: `-Uxxxxxxxxx`) passa na
 * checagem de ID do YouTube e, sem o terminador, chegava ao yt-dlp como opção
 * (o `-U` faz o programa se atualizar sozinho). Usa um `yt-dlp` falso na frente
 * do PATH que só grava os argumentos recebidos.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fetchMetadata, downloadAudio } from "@/pipeline/lib/ytdlp";

const ID_HOSTIL = "-Uxxxxxxxxx";
let dir: string;
let registro: string;
let pathOriginal: string | undefined;

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "bruto-ytdlp-falso-"));
  registro = path.join(dir, "argumentos.txt");
  const falso = path.join(dir, "yt-dlp");
  fs.writeFileSync(
    falso,
    `#!/bin/sh\nfor a in "$@"; do printf '%s\\n' "$a" >> "${registro}"; done\nprintf '%s\\n' '---' >> "${registro}"\nprintf '{"id":"x","title":"t"}'\n`,
    { mode: 0o755 },
  );
  pathOriginal = process.env.PATH;
  process.env.PATH = `${dir}${path.delimiter}${pathOriginal ?? ""}`;
});

after(() => {
  process.env.PATH = pathOriginal;
  fs.rmSync(dir, { recursive: true, force: true });
});

function ultimaChamada(): string[] {
  const blocos = fs.readFileSync(registro, "utf8").split("---\n").filter(Boolean);
  return (blocos.at(-1) ?? "").split("\n").filter(Boolean);
}

describe("terminador `--` antes da URL no yt-dlp", () => {
  test("fetchMetadata: o ID hostil chega depois de `--`, nunca como opção", async () => {
    await fetchMetadata(ID_HOSTIL).catch(() => undefined); // o falso devolve JSON mínimo; só importam os argumentos
    const args = ultimaChamada();
    assert.ok(args.includes(ID_HOSTIL), `o yt-dlp falso não foi chamado (args: ${JSON.stringify(args)})`);
    assert.equal(args.at(-1), ID_HOSTIL);
    assert.equal(args.at(-2), "--");
  });

  test("downloadAudio: idem", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bruto-audio-"));
    try {
      await downloadAudio(ID_HOSTIL, tmp).catch(() => undefined);
      const args = ultimaChamada();
      assert.equal(args.at(-1), ID_HOSTIL);
      assert.equal(args.at(-2), "--");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
