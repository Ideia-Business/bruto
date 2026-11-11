import fs from "node:fs";
import path from "node:path";

let cache: string | null = null;

/**
 * A versão do app, lida do `package.json` do `cwd` (no pacote, `…/Resources/
 * app/package.json`, que o W1 copia; no clone, a raiz do repositório).
 * Memoizada: não muda durante a vida do processo.
 */
export function versaoDoApp(): string {
  if (cache !== null) return cache;
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
    ) as { version?: string };
    cache = pkg.version ?? "0.0.0";
  } catch {
    cache = "0.0.0";
  }
  return cache;
}
