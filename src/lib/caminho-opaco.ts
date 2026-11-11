/**
 * caminho-opaco.ts — junção de caminho INVISÍVEL ao tracer do build
 * standalone.
 *
 * O tracer do `output: "standalone"` (Turbopack) analisa `path.join`/
 * `path.resolve` com segmentos literais ao lado de partes dinâmicas (env,
 * parâmetro, `process.cwd()`) e reage VARRENDO o projeto inteiro atrás de
 * arquivos cujo caminho contenha o literal. Medido nesta lane
 * (11/11/2026):
 *
 *  - `path.join(base, "bin", nome)` (base de env) → varredura `*bin*` que
 *    arrastava 441 MB de `dist/` para o payload de runtime: um segundo
 *    `node` (147 MB), `ffmpeg`, `ffprobe`, `uv`, os CLIs do npm e qualquer
 *    arquivo com "bin" no nome (binarios.json, binario.ts...), com os
 *    symlinks resolvidos — `.next/standalone` ia a 520 MB;
 *  - `path.join(process.cwd(), "drizzle")` → varredura `*drizzle*` que
 *    duplicava as migrações a partir da cópia antiga em `dist/Bruto.app`.
 *
 * Os caminhos montados com este helper são de RUNTIME — ferramentas sob
 * `$BRUTO_FERRAMENTAS`, venvs do uv, o diretório de migrações do cwd: nunca
 * precisam (nem podem) ser rastreados para o payload. Como `Array.join` não
 * é reconhecido pelo tracer como construção de caminho, o resultado é uma
 * string opaca e nada é varrido. O que PRECISA chegar ao pacote continua
 * chegando pelos canais explícitos (`outputFileTracingIncludes` no
 * next.config.ts, `serverExternalPackages`).
 *
 * Comportamento idêntico a `path.join` para os usos da casa (segmentos
 * limpos, sem `.`/`..`); separadores duplicados seriam tolerados pelo fs.
 */
import path from "node:path";

export function juntarCaminho(...partes: string[]): string {
  return partes.join(path.sep);
}
