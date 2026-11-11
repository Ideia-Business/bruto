/**
 * atualizacao.ts — o aviso "há versão nova" do modo pacote.
 *
 * O contrato do instalador proíbe atualização silenciosa: o app só AVISA, com
 * o link da release. Aqui é a consulta que alimenta esse aviso: bate na API
 * de releases do GitHub no MÁXIMO uma vez por dia (cache em
 * `$BRUTO_DATA_ROOT/verificacao-versao.json`), compara com a versão do
 * package.json e devolve a novidade — ou silêncio.
 *
 * Silêncio é o estado de repouso: sem rede, resposta quebrada, release igual
 * ou mais velha, e modo clone — nada disso pode virar erro na tela de quem
 * usa. O `fetch` é injetável para os testes (que não tocam a rede).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { versaoDoApp } from "@/lib/versao";

const URL_RELEASE_LATEST =
  "https://api.github.com/repos/Ideia-Business/bruto/releases/latest";

const UM_DIA_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_FETCH_MS = 5_000;

export interface ResultadoAtualizacao {
  /** Versão mais nova disponível (sem o "v" da tag), ou null = silêncio. */
  nova: string | null;
  /** Link da release, quando `nova` não é null. */
  url: string | null;
}

export interface OpcoesVerificacao {
  /** Default: o `fetch` global. Injetado nos testes (rede proibida neles). */
  fetchFn?: typeof fetch;
  /** Default: Date.now(). */
  agora?: number;
  /** Default: `BRUTO_DATA_ROOT` ?? `~/.bruto` (mesma regra de paths.ts). */
  dataRoot?: string;
  /** Default: a versão do package.json do cwd. */
  versaoAtual?: string;
}

interface CacheVerificacao {
  /** Quando a ÚLTIMA tentativa de consulta aconteceu (epoch ms). */
  em: number;
  /** A tag vista na última consulta bem-sucedida, ou null (sem release/erro). */
  tag: string | null;
  url: string | null;
}

const SILENCIO: ResultadoAtualizacao = { nova: null, url: null };

function lerCache(cachePath: string): CacheVerificacao | null {
  try {
    const bruto = JSON.parse(fs.readFileSync(cachePath, "utf8")) as CacheVerificacao;
    if (typeof bruto.em !== "number") return null;
    return bruto;
  } catch {
    return null;
  }
}

function gravarCache(cachePath: string, entrada: CacheVerificacao): void {
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify(entrada));
  } catch {
    // O cache é conveniência de cadência: não gravar só repete a consulta
    // amanhã, nunca quebra o app.
  }
}

/** Compara "0.10.0" com "0.9.9" por componente numérico. */
function versaoMaisNova(candidata: string, atual: string): boolean {
  const parse = (v: string): number[] =>
    v
      .replace(/^v/i, "")
      .split(".")
      .map((parte) => Number.parseInt(parte, 10) || 0);
  const a = parse(candidata);
  const b = parse(atual);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

function comparar(cache: CacheVerificacao, versaoAtual: string): ResultadoAtualizacao {
  if (!cache.tag) return SILENCIO;
  const candidata = cache.tag.replace(/^v/i, "");
  if (!versaoMaisNova(candidata, versaoAtual)) return SILENCIO;
  return { nova: candidata, url: cache.url };
}

/**
 * Devolve a versão nova (se houver) ou silêncio. Modo clone: sempre silêncio
 * e zero rede — quem desenvolve atualiza com `git pull`.
 */
export async function verificarAtualizacao(
  opcoes: OpcoesVerificacao = {},
): Promise<ResultadoAtualizacao> {
  if (process.env.BRUTO_EMPACOTADO !== "1") return SILENCIO;

  const agora = opcoes.agora ?? Date.now();
  const versaoAtual = opcoes.versaoAtual ?? versaoDoApp();
  const dataRoot =
    opcoes.dataRoot ?? process.env.BRUTO_DATA_ROOT ?? path.join(os.homedir(), ".bruto");
  const cachePath = path.join(dataRoot, "verificacao-versao.json");

  const cache = lerCache(cachePath);
  if (cache && agora - cache.em < UM_DIA_MS) return comparar(cache, versaoAtual);

  // A marca de "tentei agora" é gravada MESMO na falha: a cadência do
  // contrato é "no máximo uma vez por dia" — uma máquina sem internet não
  // pode pagar uma ida à rede a cada pedido do aviso.
  const consulta: CacheVerificacao = { em: agora, tag: null, url: null };
  try {
    const fetchFn = opcoes.fetchFn ?? fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_FETCH_MS);
    try {
      const res = await fetchFn(URL_RELEASE_LATEST, {
        signal: controller.signal,
        headers: { accept: "application/vnd.github+json" },
      });
      if (res.ok) {
        const corpo = (await res.json()) as { tag_name?: unknown; html_url?: unknown };
        if (typeof corpo.tag_name === "string" && corpo.tag_name.trim() !== "") {
          consulta.tag = corpo.tag_name;
          consulta.url = typeof corpo.html_url === "string" ? corpo.html_url : null;
        }
      }
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // Sem rede, DNS, timeout, TLS: silêncio (o cache abaixo já vale como a
    // tentativa do dia).
  }
  gravarCache(cachePath, consulta);
  return comparar(consulta, versaoAtual);
}
