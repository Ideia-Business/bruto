/**
 * binario.ts — resolução de binário no PATH, cross-platform.
 *
 * No Windows, o que o instalador de um pacote global deixa no PATH não é o
 * binário: é um shim de texto (`ffmpeg.exe`/`whisper.exe` às vezes, mas com
 * frequência `whisper.cmd`/`whisper.bat` quando vem de um pacote Python/Node
 * empacotado). `path.join(dir, "whisper")`, sem extensão, nunca bate com
 * nenhum desses arquivos — a busca de PATH precisa tentar cada extensão de
 * `PATHEXT`, que é a mesma lista que o próprio `cmd.exe`/PowerShell usam para
 * resolver um nome nu.
 *
 * Fora do win32 nada muda: só o nome nu, como sempre foi.
 *
 * O núcleo (`localizarBinario`) é puro — recebe os diretórios já divididos, a
 * plataforma-alvo e a função de teste de existência, todos injetáveis — para
 * poder ser testado sem depender do PATH real da máquina que roda o teste.
 */
import fs from "node:fs";
import path from "node:path";

/** Default de PATHEXT quando a variável não está presente no ambiente. */
const PATHEXT_PADRAO = ".EXE;.CMD;.BAT;.COM";

export interface AmbienteResolucao {
  /** Diretórios do PATH, já divididos pelo delimitador certo. */
  diretorios: string[];
  /** Plataforma-alvo. Default: `process.platform`. */
  plataforma?: NodeJS.Platform;
  /** Valor de PATHEXT a considerar no win32. Default: `process.env.PATHEXT` ou o padrão do Windows. */
  pathExt?: string;
  /** Testa se um caminho existe e é executável. Default: `fs.accessSync(caminho, X_OK)`. */
  existeEExecutavel?: (caminho: string) => boolean;
}

/**
 * Nomes candidatos para `bin`, na ordem em que devem ser testados.
 *
 * Fora do win32: só o nome nu. No win32, se `bin` já veio com extensão
 * (`ffmpeg.exe`), respeita — senão, tenta `bin + cada extensão de PATHEXT`,
 * e por fim o nome nu (cobre o caso raro de um binário sem extensão mesmo no
 * Windows, ex.: rodando sob WSL/MSYS no PATH do Windows).
 */
export function candidatosDoNome(
  bin: string,
  plataforma: NodeJS.Platform,
  pathExt: string,
): string[] {
  if (plataforma !== "win32") return [bin];
  if (path.extname(bin) !== "") return [bin];
  const extensoes = pathExt
    .split(";")
    .map((e) => e.trim())
    .filter(Boolean);
  return [...extensoes.map((ext) => bin + ext), bin];
}

function padraoExisteEExecutavel(caminho: string): boolean {
  try {
    fs.accessSync(caminho, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Núcleo puro de busca: dado um nome de binário e um ambiente (diretórios,
 * plataforma, PATHEXT, testador de existência — todos injetáveis), devolve o
 * caminho completo do primeiro candidato encontrado, ou `null`.
 */
export function localizarBinario(bin: string, ambiente: AmbienteResolucao): string | null {
  const plataforma = ambiente.plataforma ?? process.platform;
  const pathExt = ambiente.pathExt ?? process.env.PATHEXT ?? PATHEXT_PADRAO;
  const existe = ambiente.existeEExecutavel ?? padraoExisteEExecutavel;
  const candidatos = candidatosDoNome(bin, plataforma, pathExt);

  for (const dir of ambiente.diretorios) {
    for (const nome of candidatos) {
      const caminho = path.join(dir, nome);
      if (existe(caminho)) return caminho;
    }
  }
  return null;
}

/**
 * Divide uma variável PATH pelo delimitador da plataforma dada — não do
 * processo em execução, que é o que `path.delimiter` sempre devolveria.
 * É essa diferença que torna a função testável para win32 rodando em CI
 * macOS/Linux.
 */
export function dividirPath(pathVar: string, plataforma: NodeJS.Platform = process.platform): string[] {
  const delimitador = plataforma === "win32" ? ";" : ":";
  return pathVar.split(delimitador).filter(Boolean);
}

// ── Python de dentro de uma ferramenta `uv tool install` ────────────────────

/**
 * `uv tool install <nome>` cria um venv ISOLADO para a ferramenta — o módulo
 * instalado (ex.: `mlx_whisper`) fica visível só para o Python DE DENTRO
 * desse venv, nunca para o `python3` global do sistema. Achado real: numa
 * máquina nova, `mlx-whisper` instalado pelo instalador (`uv tool install
 * mlx-whisper`) ficava invisível ao Bruto, porque `temMlx()` só perguntava ao
 * `python3` do PATH — e nesta estação de desenvolvimento só "funcionava"
 * porque o módulo também tinha sido instalado, por fora, no Python global.
 *
 * Diretório-base, medido com `uv tool dir` (uv 0.11.27) e confirmado contra a
 * doc oficial (`docs.astral.sh/uv/reference/storage`):
 *   1. `$UV_TOOL_DIR`, se setada — sobrescreve tudo, é o contrato do próprio uv.
 *   2. Default por plataforma:
 *      - POSIX (macOS/Linux): `$HOME/.local/share/uv/tools`
 *        (medido nesta estação: `uv tool dir` devolveu exatamente isso).
 *      - win32: `%APPDATA%\uv\data\tools` — não `%APPDATA%\uv\tools`; o
 *        `\data\` intermediário é o que a doc confirma (é fácil errar essa
 *        parte de memória, por isso o comentário registra a fonte).
 *
 * Dentro do diretório da ferramenta, o Python do venv:
 *   - POSIX: `<base>/<nome>/bin/python`
 *   - win32: `<base>/<nome>/Scripts/python.exe` (venv do Windows usa
 *     `Scripts\`, não `bin\` — convenção do próprio `venv` da stdlib, que o
 *     uv segue).
 */
export interface AmbienteUvTool {
  /** Plataforma-alvo. Default: `process.platform`. */
  plataforma?: NodeJS.Platform;
  /**
   * Ambiente de onde ler `UV_TOOL_DIR`/`HOME`/`APPDATA`. Default: `process.env`.
   * Tipo solto (não `NodeJS.ProcessEnv`) de propósito: só as três chaves
   * importam, e exigir o contrato inteiro do ambiente obrigaria cada teste a
   * inventar `NODE_ENV` e companhia para injetar só o que muda o resultado.
   */
  env?: Record<string, string | undefined>;
  /** Testa se um caminho existe e é executável. Default: `fs.accessSync(caminho, X_OK)`. */
  existeEExecutavel?: (caminho: string) => boolean;
}

function baseUvTools(plataforma: NodeJS.Platform, env: Record<string, string | undefined>): string | null {
  if (env.UV_TOOL_DIR) return env.UV_TOOL_DIR;
  if (plataforma === "win32") {
    if (!env.APPDATA) return null;
    return path.join(env.APPDATA, "uv", "data", "tools");
  }
  if (!env.HOME) return null;
  return path.join(env.HOME, ".local", "share", "uv", "tools");
}

/**
 * Caminho do Python de dentro do venv de uma ferramenta instalada via
 * `uv tool install <nomeFerramenta>`, ou `null` se a ferramenta não estiver
 * instalada por esse caminho (ou o diretório-base não puder ser determinado).
 * Núcleo puro — plataforma, ambiente e testador de existência são
 * injetáveis, para não depender de nenhuma instalação real do uv na máquina
 * que roda o teste.
 */
export function pythonDaFerramentaUv(nomeFerramenta: string, ambiente: AmbienteUvTool = {}): string | null {
  const plataforma = ambiente.plataforma ?? process.platform;
  const env = ambiente.env ?? process.env;
  const existe = ambiente.existeEExecutavel ?? padraoExisteEExecutavel;

  const base = baseUvTools(plataforma, env);
  if (!base) return null;

  const caminho =
    plataforma === "win32"
      ? path.join(base, nomeFerramenta, "Scripts", "python.exe")
      : path.join(base, nomeFerramenta, "bin", "python");

  return existe(caminho) ? caminho : null;
}
