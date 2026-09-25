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
