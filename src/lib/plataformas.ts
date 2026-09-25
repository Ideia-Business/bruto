/**
 * A FONTE ÚNICA do que o Bruto destrincha.
 *
 * POR QUE EXISTE: a lista de plataformas vivia em quatro lugares que não se
 * falavam — o parser de URL do app, a heurística sobre o yt-dlp, o rótulo
 * do badge e a extensão (que só conhecia o YouTube). Cada um envelhecia num
 * ritmo, e a tela dizia uma coisa enquanto o código aceitava outra. Agora
 * a lista é uma só: quem mostra compatibilidade e quem decide se um link
 * entra leem daqui.
 *
 * ESTE ARQUIVO NÃO IMPORTA NADA. Ele é compartilhado pelo app (Next.js) e
 * pela extensão (esbuild, contexto do popup), então não pode depender de
 * `node:*`, de React nem de nada do pipeline.
 */

export type PlataformaId = "youtube" | "instagram" | "tiktok";

/** Como a fala do vídeo chega ao Bruto. */
export type ModoDeTranscricao = "legenda" | "audio";

export interface Plataforma {
  readonly id: PlataformaId;
  /** Nome como aparece na tela. */
  readonly label: string;
  /** Domínios reconhecidos (sem `www.`/`m.`; subdomínios contam quando marcado). */
  readonly hosts: readonly string[];
  readonly aceitaSubdominios: boolean;
  /** Formatos que o parser reconhece nessa plataforma, para listar na tela. */
  readonly tiposDeVideo: readonly string[];
  /** Exemplo de link aceito, para ilustrar na tela. */
  readonly exemplo: string;
  /** Preferência de transcrição: legenda publicada, ou áudio (Whisper local). */
  readonly transcricao: readonly ModoDeTranscricao[];
  /** A extensão do navegador destrincha sozinha nessa plataforma? */
  readonly naExtensao: boolean;
  /** O app local destrincha nessa plataforma? */
  readonly noAppLocal: boolean;
  /** Frase curta para a tela — o "como" em uma linha. */
  readonly nota: string;
}

export const PLATAFORMAS: readonly Plataforma[] = [
  {
    id: "youtube",
    label: "YouTube",
    hosts: ["youtube.com", "youtu.be", "music.youtube.com"],
    aceitaSubdominios: false,
    tiposDeVideo: ["Vídeo", "Shorts", "Live gravada", "Embed"],
    exemplo: "youtube.com/watch?v=…",
    transcricao: ["legenda", "audio"],
    naExtensao: true,
    noAppLocal: true,
    nota: "Lê a legenda publicada. Sem legenda, o app local transcreve o áudio.",
  },
  {
    id: "instagram",
    label: "Instagram",
    hosts: ["instagram.com"],
    aceitaSubdominios: true,
    tiposDeVideo: ["Reel", "Post com vídeo", "IGTV"],
    exemplo: "instagram.com/reel/…",
    transcricao: ["audio"],
    naExtensao: false,
    noAppLocal: true,
    nota: "Quase nunca tem legenda: o app local baixa o áudio e transcreve na sua máquina.",
  },
  {
    id: "tiktok",
    label: "TikTok",
    hosts: ["tiktok.com"],
    aceitaSubdominios: true,
    tiposDeVideo: ["Vídeo", "Link curto (vm/vt)"],
    exemplo: "tiktok.com/@perfil/video/…",
    transcricao: ["audio"],
    naExtensao: false,
    noAppLocal: true,
    nota: "Quase nunca tem legenda: o app local baixa o áudio e transcreve na sua máquina.",
  },
];

export const PLATAFORMA_POR_ID: Readonly<Record<PlataformaId, Plataforma>> = Object.fromEntries(
  PLATAFORMAS.map((p) => [p.id, p]),
) as Record<PlataformaId, Plataforma>;

/** Rótulo para badge. Aceita string solta porque o banco guarda `text`. */
export function rotuloDaPlataforma(id: string): string {
  return (PLATAFORMA_POR_ID as Record<string, Plataforma | undefined>)[id]?.label ?? id;
}

/** O que NÃO entra, dito de uma vez para a tela não prometer. */
export const NAO_SUPORTADO: readonly string[] = [
  "Playlists e canais inteiros",
  "Lives ao vivo (só depois de gravadas)",
  "Vídeo privado ou que exige login",
  "Arquivo de vídeo local",
];

export interface ReferenciaDeMidia {
  readonly plataforma: PlataformaId;
  /** ID canônico. Vazio quando a URL não o expõe (link curto do TikTok);
   *  nesse caso o pipeline usa o id que o yt-dlp devolver. */
  readonly id: string;
}

const ID_YOUTUBE = /^[A-Za-z0-9_-]{11}$/;

function hostNormalizado(url: URL): string {
  return url.hostname.toLowerCase().replace(/^(www|m)\./, "");
}

/**
 * Só a plataforma, pelo host. É o que a extensão precisa para dizer "isto é
 * um Reel" antes de saber se o link é válido. `null` para host desconhecido.
 */
export function detectarPlataforma(href: string): PlataformaId | null {
  let url: URL;
  try {
    url = new URL(href.trim());
  } catch {
    return null;
  }
  const host = hostNormalizado(url);
  for (const p of PLATAFORMAS) {
    for (const h of p.hosts) {
      if (host === h) return p.id;
      if (p.aceitaSubdominios && host.endsWith(`.${h}`)) return p.id;
    }
  }
  return null;
}

/**
 * Reconhece um link e extrai plataforma + ID. `null` quando o host é
 * desconhecido OU quando o caminho não é de um vídeo (ex.: a home do
 * Instagram, um perfil do TikTok). Aceita também um ID puro do YouTube
 * (11 caracteres), por compatibilidade com o CLI.
 */
export function reconhecerLink(input: string): ReferenciaDeMidia | null {
  const texto = input.trim();
  if (ID_YOUTUBE.test(texto)) return { plataforma: "youtube", id: texto };

  let url: URL;
  try {
    url = new URL(texto);
  } catch {
    return null;
  }
  const host = hostNormalizado(url);
  const plataforma = detectarPlataforma(texto);
  if (plataforma === null) return null;

  switch (plataforma) {
    case "youtube": {
      if (host === "youtu.be") {
        const id = url.pathname.slice(1).split("/")[0];
        return ID_YOUTUBE.test(id) ? { plataforma, id } : null;
      }
      const v = url.searchParams.get("v");
      if (v && ID_YOUTUBE.test(v)) return { plataforma, id: v };
      const m = url.pathname.match(/^\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{11})/);
      return m ? { plataforma, id: m[1] } : null;
    }
    case "instagram": {
      const m = url.pathname.match(/^\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/);
      return m ? { plataforma, id: m[1] } : null;
    }
    case "tiktok": {
      const m = url.pathname.match(/\/video\/(\d+)/);
      if (m) return { plataforma, id: m[1] };
      // vm./vt.tiktok.com/<código>: o id só aparece depois do redirect.
      return host !== "tiktok.com" ? { plataforma, id: "" } : null;
    }
  }
}
