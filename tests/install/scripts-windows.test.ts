/**
 * Os .ps1 precisam de BOM UTF-8. Sem ele, o Windows PowerShell 5.1 lê o
 * arquivo como ANSI (Windows-1252): o travessão vira "â€”", cujo último byte
 * é uma aspa tipográfica, e o script para de compilar — instalador e atalho
 * morrem no Windows (achado do Codex, 25/09/2026). Editor que "limpa" o BOM
 * reintroduz o defeito sem que nada mais acuse.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const RAIZ = process.cwd();
const SCRIPTS = ["install/instalar.ps1", "launcher/serve.ps1", "launcher/atalho-windows.ps1"];
const BOM = [0xef, 0xbb, 0xbf];

describe("scripts PowerShell", () => {
  for (const rel of SCRIPTS) {
    test(`${rel} começa com BOM UTF-8`, () => {
      const b = fs.readFileSync(path.join(RAIZ, rel));
      assert.deepEqual([...b.subarray(0, 3)], BOM);
    });
  }
  test("controle: um arquivo sem BOM é detectado", () => {
    assert.notDeepEqual([...Buffer.from("# sem bom", "utf8").subarray(0, 3)], BOM);
  });
});
