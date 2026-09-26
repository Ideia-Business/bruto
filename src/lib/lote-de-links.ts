/**
 * Avalia um texto colado com vários links, um por linha, contra a fonte
 * única de plataformas (`@/lib/plataformas`) — sem tocar rede nem estado.
 *
 * POR QUE SEPARADO DE `plataformas.ts`: aquele arquivo é compartilhado com a
 * extensão (esbuild, sem Node) e não pode ganhar peso; este é só do app, que
 * decide como colar N links vira N linhas avaliadas.
 */
import { reconhecerLink, type ReferenciaDeMidia } from "@/lib/plataformas";

export interface LinhaDoLote {
  readonly linha: string;
  /** `null` quando a linha não é um link de plataforma suportada. */
  readonly referencia: ReferenciaDeMidia | null;
}

/** Quebra por linha, descarta vazias/espaços, reconhece cada uma. */
export function avaliarLoteDeLinks(texto: string): LinhaDoLote[] {
  return texto
    .split("\n")
    .map((linha) => linha.trim())
    .filter((linha) => linha.length > 0)
    .map((linha) => ({ linha, referencia: reconhecerLink(linha) }));
}
