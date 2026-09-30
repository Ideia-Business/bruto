/**
 * Nome de arquivo de download e o cabeçalho `Content-Disposition` que o
 * carrega — puro, sem tocar banco. Extraído de
 * `src/app/api/artifacts/[id]/route.ts` (achado da 5ª revisão cross-vendor,
 * Grok): a rota importa `@/db/queries`, que abre `~/.bruto/bruto.db` de
 * verdade em WAL ao ser carregada — testar estas funções puras através da
 * rota puxava esse efeito colateral sem necessidade. `path`, aqui, só serve
 * pra achar a extensão (`path.extname`), não toca disco.
 */
import path from "node:path";

/**
 * Trunca por BYTES UTF-8, nunca no meio de um caractere multi-byte. Mesma
 * técnica de `truncarUtf8SemPartirCaractere` em `servidor/lib/ollama.ts`
 * (modo grátis) — reimplementada aqui, não importada de lá: são dois deploys
 * independentes, sem dependência entre eles.
 */
export function truncarPorBytesUtf8(texto: string, limiteBytes: number): string {
  const bytes = new TextEncoder().encode(texto);
  if (bytes.length <= limiteBytes) return texto;
  let fim = limiteBytes;
  if ((bytes[fim] & 0xc0) === 0x80) {
    while (fim > 0 && (bytes[fim] & 0xc0) === 0x80) fim--;
  }
  return new TextDecoder("utf-8").decode(bytes.subarray(0, fim));
}

/**
 * Corta o nome pelo teto (BYTES UTF-8, não `.length`) preservando a extensão.
 * Duas rodadas de conserto aqui: (1) a versão original cortava a STRING FINAL
 * já com sufixo em 120 CHARS — título longo (111+, comum em vídeo do TikTok
 * ou PATCH de título) fazia a extensão desaparecer inteira, e docx/pdf/md do
 * mesmo vídeo colapsavam no mesmo nome truncado. (2) cortar por `.length`
 * (unidades UTF-16) em vez de bytes UTF-8 ainda deixava passar título muito
 * CJK/emoji que cabia nos 120 "caracteres" mas estourava os 255 bytes reais
 * do sistema de arquivos — `getFileHandle` rejeitava na exportação, e como a
 * marca de "já exportado" agora exige sucesso pleno, o vídeo nunca marcava:
 * retry pra sempre.
 */
export function comLimiteDeNome(nome: string, limiteBytes = 200): string {
  const ext = path.extname(nome); // extensão é sempre ASCII (.docx, .pdf, ...) — bytes === chars aqui
  const base = ext ? nome.slice(0, nome.length - ext.length) : nome;
  const disponivel = Math.max(limiteBytes - ext.length, 1);
  return `${truncarPorBytesUtf8(base, disponivel)}${ext}`;
}

/** Retira tudo que não é ASCII imprimível — só para o `filename=` comum (fallback de navegador antigo); o nome de verdade vai no `filename*` (UTF-8). */
function paraAsciiFallback(nome: string): string {
  return nome.replace(/[^\x20-\x7E]/g, "_");
}

/**
 * `Content-Disposition` com o nome em UTF-8 (RFC 6266, `filename*`) mais um
 * fallback ASCII (`filename=`, para navegador que não entende `filename*`).
 * O nome cru direto no cabeçalho quebra com 500 (`TypeError: Cannot convert
 * argument to a ByteString`) para qualquer título com code point > 255 —
 * aspas curvas (“”), emoji, CJK. `encodeURIComponent` é sempre ASCII-safe,
 * então nunca reproduz o erro, não importa o título.
 */
export function cabecalhoContentDisposition(filename: string): string {
  const fallback = paraAsciiFallback(filename);
  const codificado = encodeURIComponent(filename);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${codificado}`;
}
