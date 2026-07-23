/**
 * Parser de arquivos WebVTT (legendas baixadas via yt-dlp) → texto limpo + texto com timestamps.
 *
 * Suporta os dois formatos que o YouTube entrega:
 * - Auto-captions "rolling": cada cue repete a última linha do cue anterior e acrescenta
 *   uma nova, com timing tags por palavra (`<00:00:01.319><c> palavra</c>`) e atributos
 *   `align:start position:0%` na linha de timing. O dedupe com memória de 1 linha
 *   remove a repetição e mantém só o conteúdo novo de cada cue.
 * - Legendas manuais: cues limpos, possivelmente multi-linha, sem rolling — nesse caso
 *   o dedupe simplesmente não encontra repetições e tudo passa intacto.
 */

/** Linha de timing de cue: "00:00:00.000 --> 00:00:02.500 [attrs]" (horas opcionais). */
const CUE_TIMING_RE =
  /^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{3})\s+-->\s+(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{3})/;

/** Quebra de parágrafo quando o silêncio entre cues consecutivos excede este gap. */
const PARAGRAPH_GAP_SEC = 4;

/** Teto de linhas por parágrafo (evita parágrafos gigantes em fala contínua). */
const PARAGRAPH_MAX_LINES = 40;

/** Cue já limpo: tempo de início/fim e as linhas novas (pós-dedupe) que ele emitiu. */
interface CleanCue {
  startSec: number;
  endSec: number;
  lines: string[];
}

/** Decodifica as entidades HTML básicas que aparecem em VTTs do YouTube. */
function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&amp;/g, "&"); // por último, para não re-decodificar "&amp;lt;" em "<"
}

/**
 * Limpa uma linha de texto de cue: remove tags inline (<c>, </c>, <c.colorE5E5E5>,
 * timing tags <00:00:00.000> etc.), decodifica entidades e normaliza espaços.
 * No VTT, "<" literal vem escapado como &lt;, então remover tudo entre <> é seguro.
 */
function cleanCueLine(line: string): string {
  const semTags = line.replace(/<[^>]*>/g, "");
  return decodeHtmlEntities(semTags).replace(/\s+/g, " ").trim();
}

/** Converte os grupos capturados de um trecho hh?:mm:ss.mmm em segundos. */
function toSeconds(h: string | undefined, m: string, s: string, ms: string): number {
  return (h ? Number(h) * 3600 : 0) + Number(m) * 60 + Number(s) + Number(ms) / 1000;
}

/** Formata segundos como "hh:mm:ss" (sempre com horas, zero-padded). */
function formatTimestamp(totalSec: number): string {
  const t = Math.floor(totalSec);
  const hh = String(Math.floor(t / 3600)).padStart(2, "0");
  const mm = String(Math.floor((t % 3600) / 60)).padStart(2, "0");
  const ss = String(t % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

/**
 * Faz o parse de um VTT completo e retorna:
 * - `text`: linhas deduplicadas agrupadas em parágrafos. Quebra de parágrafo quando o
 *   gap entre o fim de um cue e o início do próximo excede {@link PARAGRAPH_GAP_SEC},
 *   ou quando o parágrafo atinge {@link PARAGRAPH_MAX_LINES} linhas (o que vier antes).
 * - `timestampedText`: uma linha "[hh:mm:ss] texto" por cue que emitiu conteúdo novo.
 */
export function parseVtt(vttContent: string): { text: string; timestampedText: string } {
  const rawLines = vttContent.split(/\r\n|\r|\n/);

  const cues: CleanCue[] = [];
  let current: CleanCue | null = null;
  let inCue = false; // estamos entre uma linha de timing e a próxima linha vazia?
  let skipBlock = false; // dentro de bloco NOTE/STYLE/REGION (ignorar até linha vazia)
  let lastEmitted = ""; // memória de 1 linha para o dedupe rolling

  for (const rawLine of rawLines) {
    const line = rawLine.trim();

    // Linha vazia encerra o cue/bloco atual.
    if (line === "") {
      if (current && current.lines.length > 0) cues.push(current);
      current = null;
      inCue = false;
      skipBlock = false;
      continue;
    }

    if (skipBlock) continue;

    const timing = line.match(CUE_TIMING_RE);
    if (timing) {
      // Novo cue (VTTs malformados sem linha vazia entre cues também são aceitos).
      if (current && current.lines.length > 0) cues.push(current);
      current = {
        startSec: toSeconds(timing[1], timing[2], timing[3], timing[4]),
        endSec: toSeconds(timing[5], timing[6], timing[7], timing[8]),
        lines: [],
      };
      inCue = true;
      continue;
    }

    if (!inCue) {
      // Fora de cue: header (WEBVTT, Kind:, Language:), identificador de cue,
      // ou início de bloco NOTE/STYLE/REGION — tudo ignorado.
      if (/^(NOTE|STYLE|REGION)\b/.test(line)) skipBlock = true;
      continue;
    }

    // Linha de texto do cue atual.
    const cleaned = cleanCueLine(line);
    if (cleaned === "") continue; // linhas só com tags/&nbsp; viram vazias → descartar
    if (cleaned === lastEmitted) continue; // dedupe rolling: repetição do cue anterior
    current?.lines.push(cleaned);
    lastEmitted = cleaned;
  }
  // Último cue do arquivo (quando o VTT não termina com linha vazia).
  if (current && current.lines.length > 0) cues.push(current);

  // timestampedText: uma linha por cue com conteúdo novo, no tempo de início do cue.
  const timestampedText = cues
    .map((cue) => `[${formatTimestamp(cue.startSec)}] ${cue.lines.join(" ")}`)
    .join("\n");

  // text: parágrafos separados por linha em branco.
  const paragraphs: string[] = [];
  let paragraphLines: string[] = [];
  let prevEndSec: number | null = null;

  const flushParagraph = () => {
    if (paragraphLines.length > 0) {
      paragraphs.push(paragraphLines.join(" "));
      paragraphLines = [];
    }
  };

  for (const cue of cues) {
    const gapExceeded = prevEndSec !== null && cue.startSec - prevEndSec > PARAGRAPH_GAP_SEC;
    if (gapExceeded || paragraphLines.length >= PARAGRAPH_MAX_LINES) flushParagraph();
    paragraphLines.push(...cue.lines);
    prevEndSec = cue.endSec;
  }
  flushParagraph();

  return { text: paragraphs.join("\n\n"), timestampedText };
}
