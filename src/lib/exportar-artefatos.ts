/**
 * Exportação automática de um vídeo concluído para a pasta escolhida pela
 * pessoa (settings em /configuracoes). Sempre uma CÓPIA client-side (ADR
 * 0002): lê cada artefato pelo endpoint que já existe
 * (`GET /api/artifacts/[id]`) e escreve na pasta via File System Access API.
 *
 * Falhar aqui NUNCA é falha do processamento — o vídeo já está salvo em
 * `~/.bruto/library/<id>/` de qualquer forma. O pior caso é um aviso.
 */
import { toast } from "sonner";
import { fetchApp } from "@/lib/fetch-app";
import {
  autoExportarAtivado,
  nomeDaPastaDoVideo,
  obterPastaId,
  obterPastaSalva,
  permissaoAtual,
  sanitizarNomeArquivo,
} from "@/lib/pasta-exportacao";

export interface VideoProntoParaExportar {
  videoId: string;
  jobId: string;
}

interface ArtefatoWire {
  id: string;
  kind: string;
}

interface DetalheVideoWire {
  video: { title: string };
  category: { name: string } | null;
  artifacts: ArtefatoWire[];
}

/**
 * Extrai o `filename` do `Content-Disposition`. Prioridade:
 *
 * 1. `filename*=UTF-8''...` (RFC 6266) — a fonte confiável, sempre em UTF-8.
 *    O servidor manda essa forma desde que o `filename=` cru passou a
 *    quebrar com 500 para título com aspas curvas, emoji ou CJK (code point
 *    > 255, fora do ByteString que o cabeçalho aceita cru).
 * 2. `filename="..."` com aspas — pegando TUDO entre elas, inclusive `;`,
 *    porque `filename="Aula; parte 2.docx"` é nome legítimo e um regex que
 *    para no primeiro `;` (mesmo dentro das aspas) cortava o nome e fazia
 *    PDF/DOCX do mesmo vídeo colidirem no mesmo arquivo truncado.
 * 3. `filename=` sem aspas, só como último recurso.
 */
export function nomeArquivoDoCabecalho(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (utf8?.[1]) return sanitizarNomeArquivo(decodeURIComponent(utf8[1]));
  const comAspas = /filename="([^"]*)"/i.exec(header);
  if (comAspas?.[1]) return sanitizarNomeArquivo(decodeURIComponent(comAspas[1]));
  const semAspas = /filename=([^;]+)/i.exec(header);
  return semAspas?.[1] ? sanitizarNomeArquivo(decodeURIComponent(semAspas[1].trim())) : fallback;
}

/**
 * Só marca como exportado em SUCESSO PLENO (`escritos === total`) — nunca em
 * cópia parcial, nem no caminho normal (todo artefato pedido, mas só parte
 * escreveu) nem no catch (onde, por definição, alguma coisa interrompeu o
 * laço antes de completar — `total` fica no sentinela `-1` se a exceção
 * aconteceu antes até de saber quantos artefatos existem). A mesma regra nos
 * dois caminhos: um vídeo com cópia incompleta continua candidato no
 * catch-up, e tenta de novo — nunca fica marcado "já tentado" com menos
 * arquivo do que devia.
 */
export function deveMarcarExportado(escritos: number, total: number): boolean {
  return total >= 0 && escritos === total;
}

/** Decide a mensagem de conclusão a partir do que realmente foi escrito — nunca "sucesso" quando faltou artefato. */
export function resultadoDaCopia(
  escritos: number,
  total: number,
): { tipo: "sucesso" | "parcial"; titulo: string } {
  if (escritos >= total) return { tipo: "sucesso", titulo: "Salvo também em" };
  return { tipo: "parcial", titulo: `Cópia incompleta: ${escritos} de ${total} arquivos salvos em` };
}

const PREFIXO_LOCALSTORAGE_EXPORTADOS = "bruto:videos-exportados";

/** Chave de localStorage escopada pela pasta atual — sem pasta escolhida (ou nunca escolhida) cai num escopo "default" próprio. */
function chaveExportados(pastaId: string | null): string {
  return `${PREFIXO_LOCALSTORAGE_EXPORTADOS}:${pastaId ?? "default"}`;
}

/**
 * Mapa `videoId -> jobId` já exportado com sucesso pleno, ESCOPADO pela pasta
 * atualmente escolhida (`obterPastaId`). Escopar por pasta é o que faz trocar
 * de pasta A para uma pasta B vazia voltar a exportar tudo em B — sem isso, a
 * marca de A "vazava" para B e o catch-up pulava todo vídeo já marcado, numa
 * pasta que nunca tinha recebido nada. Guardar o `jobId` (não só o `videoId`)
 * é o que faz reprocessar o vídeo (retry) disparar exportação de novo: o job
 * novo tem um id diferente do que está marcado, então não bate mais.
 */
export async function obterExportados(): Promise<Record<string, string>> {
  try {
    const pastaId = await obterPastaId();
    const bruto = localStorage.getItem(chaveExportados(pastaId));
    return bruto ? (JSON.parse(bruto) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

async function marcarExportado(videoId: string, jobId: string): Promise<void> {
  try {
    const pastaId = await obterPastaId();
    const atual = await obterExportados();
    atual[videoId] = jobId;
    localStorage.setItem(chaveExportados(pastaId), JSON.stringify(atual));
  } catch {
    /* modo privado ou storage bloqueado — a marca só não persiste, tenta de novo na próxima carga */
  }
}

/**
 * Dos vídeos prontos no servidor, quais ainda não têm marca de exportação
 * (deste JOB, não só deste vídeo) neste navegador/pasta. Função pura — é o
 * coração do catch-up: `done` sem marca é candidato, não importa há quanto
 * tempo terminou (vídeo antigo, ligar o interruptor depois, cai aqui do
 * mesmo jeito), e job novo (retry) com jobId diferente do marcado também.
 */
export function idsPendentesDeExportacao(
  prontos: VideoProntoParaExportar[],
  jaExportados: Record<string, string>,
): VideoProntoParaExportar[] {
  return prontos.filter((v) => jaExportados[v.videoId] !== v.jobId);
}

/** Evita disparo concorrente do mesmo vídeo (ex.: heartbeat/evento duplicado, ou catch-up cruzando com o SSE ao vivo). */
const emAndamento = new Set<string>();

export async function exportarVideoAutomaticamente(
  videoId: string | null | undefined,
  jobId: string | null | undefined,
): Promise<void> {
  if (!videoId || !jobId) return;
  if (!autoExportarAtivado()) return;
  if (emAndamento.has(videoId)) return;

  // Marca ANTES do primeiro `await`: o SSE (onDone, ao vivo) e o timer de
  // 60s da sincronização podem chamar para o MESMO vídeo quase ao mesmo
  // tempo. Como JS não interrompe um trecho síncrono no meio, tudo daqui até
  // o primeiro `await` roda atômico — nenhuma segunda chamada consegue
  // entrar depois deste ponto. A checagem de "já exportado" (precisa ler a
  // pasta atual no IndexedDB, logo é assíncrona) fica DEPOIS do lock, não
  // antes — senão reabriria a mesma janela de corrida que ele fecha.
  emAndamento.add(videoId);
  let escritos = 0;
  let total = -1; // -1 = ainda não sabemos — o laço nem começou (ver deveMarcarExportado)
  try {
    const exportados = await obterExportados();
    if (exportados[videoId] === jobId) return; // já exportado ESTE job — nada a fazer

    const handle = await obterPastaSalva();
    if (!handle) return; // nunca configurado — nada a fazer, sem ruído (condição prévia: não marca)

    const permissao = await permissaoAtual(handle);
    if (permissao !== "granted") {
      toast.warning("Não deu para salvar cópia na pasta escolhida: a permissão expirou.", {
        description:
          "O vídeo está salvo normalmente na biblioteca. Abra Configurações para reconceder o acesso.",
      });
      return; // condição prévia recuperável — não marca, tenta de novo quando a permissão voltar
    }

    const res = await fetchApp(`/api/videos/${videoId}`);
    if (!res.ok) throw new Error("Não foi possível ler os dados do vídeo.");
    const detalhe = (await res.json()) as DetalheVideoWire;

    const categoriaNome = sanitizarNomeArquivo(detalhe.category?.name ?? "Sem categoria");
    const tituloNome = sanitizarNomeArquivo(detalhe.video.title);
    const pastaVideoNome = nomeDaPastaDoVideo(tituloNome, videoId);

    const pastaCategoria = await handle.getDirectoryHandle(categoriaNome, { create: true });
    const pastaVideo = await pastaCategoria.getDirectoryHandle(pastaVideoNome, { create: true });

    total = detalhe.artifacts.length;
    for (const artefato of detalhe.artifacts) {
      const artRes = await fetchApp(`/api/artifacts/${artefato.id}`);
      if (!artRes.ok) continue; // um artefato faltando não derruba o resto do pacote
      const nomeArquivo = nomeArquivoDoCabecalho(
        artRes.headers.get("content-disposition"),
        artefato.kind,
      );
      const dados = await artRes.arrayBuffer();
      const fileHandle = await pastaVideo.getFileHandle(nomeArquivo, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(dados);
      await writable.close();
      escritos++;
    }

    const resultado = resultadoDaCopia(escritos, total);
    // A pasta REAL no disco é `pastaVideoNome` (com o sufixo do id, item 1 da
    // rodada anterior) — mostrar `tituloNome` sozinho aqui anunciava um
    // caminho que não existe.
    const destino = `${categoriaNome}/${pastaVideoNome}`;
    if (resultado.tipo === "sucesso") {
      toast.success(`${resultado.titulo} ${destino}`, {
        description: "Cópia na pasta escolhida — o original continua na biblioteca do Bruto.",
      });
    } else {
      toast.warning(`${resultado.titulo} ${destino}.`, {
        description:
          "O vídeo está salvo normalmente na biblioteca. Vai tentar de novo na próxima vez que a página carregar.",
      });
    }
    if (deveMarcarExportado(escritos, total)) await marcarExportado(videoId, jobId);
  } catch {
    toast.warning("Não deu para salvar cópia na pasta escolhida.", {
      description:
        "O vídeo está salvo normalmente na biblioteca. Se a pasta sumiu ou mudou de lugar, reabra Configurações.",
    });
    // Na prática esta condição quase nunca é verdadeira aqui — uma exceção
    // significa que o laço foi interrompido (ou nem começou), então
    // `escritos === total` só valeria se a falha tivesse acontecido DEPOIS
    // do laço terminar por completo. É a mesma regra do caminho normal,
    // aplicada por consistência — não uma regra nova para o catch.
    if (deveMarcarExportado(escritos, total)) await marcarExportado(videoId, jobId);
  } finally {
    emAndamento.delete(videoId);
  }
}

/**
 * Sonda barata: a pasta escolhida ainda existe no disco? `queryPermission`
 * NÃO sabe responder isso — o navegador continua dizendo "granted" mesmo com
 * a pasta apagada, movida ou renomeada; só uma operação real na revela.
 * `values().next()` de um único passo confirma sem ler o conteúdo inteiro e
 * sem criar nada (ao contrário de sondar com `getDirectoryHandle(create:
 * true)`, que deixaria uma pasta bruta pra trás). Resolve tanto para pasta
 * vazia quanto com conteúdo; só lança se o diretório em si sumiu.
 */
export async function pastaAindaExisteNoDisco(handle: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    await handle.values().next();
    return true;
  } catch {
    return false;
  }
}

/** Evita duas rodadas do timer/SSE processando o mesmo lote de pendentes ao mesmo tempo (item 3 da 3ª revisão). */
let sincronizacaoEmAndamento = false;

/**
 * Catch-up: roda ao carregar qualquer página do app (ver `SincronizacaoExportacao`
 * no layout raiz). Cobre o caso em que o `onDone` do SSE nunca disparou porque
 * a pessoa navegou para longe do componente que o assina (ex.: foi para
 * /configuracoes ligar o interruptor bem quando o vídeo terminou) — sem isto,
 * aquela exportação se perde para sempre, sem nenhum sinal de que sumiu.
 *
 * Permissão é checada UMA vez para o lote inteiro, não por vídeo: do
 * contrário, N vídeos pendentes com a permissão expirada disparariam N
 * avisos idênticos a cada navegação. O estado de permissão já é visível, com
 * calma, em /configuracoes. Pelo mesmo motivo, "a pasta sumiu do disco" é
 * checado UMA vez antes do lote (ver `pastaAindaExisteNoDisco`) — sem isso,
 * cada vídeo pendente cairia no próprio catch e toastaria sozinho, a cada
 * 60s, para sempre, até alguém religar a pasta.
 */
export async function sincronizarExportacoesPendentes(): Promise<void> {
  if (sincronizacaoEmAndamento) return;
  sincronizacaoEmAndamento = true;
  try {
    if (!autoExportarAtivado()) return;
    const handle = await obterPastaSalva();
    if (!handle) return;
    if ((await permissaoAtual(handle)) !== "granted") return;

    let prontos: VideoProntoParaExportar[];
    try {
      const res = await fetchApp("/api/videos/concluidos");
      if (!res.ok) return;
      const data = (await res.json()) as { videos: VideoProntoParaExportar[] };
      prontos = data.videos;
    } catch {
      return;
    }

    const exportados = await obterExportados();
    const pendentes = idsPendentesDeExportacao(prontos, exportados);
    if (pendentes.length === 0) return;

    if (!(await pastaAindaExisteNoDisco(handle))) {
      toast.warning("A pasta de exportação não foi encontrada.", {
        description: `Pode ter sido movida, renomeada ou apagada. ${pendentes.length} vídeo(s) aguardando — abra Configurações para escolher a pasta de novo.`,
      });
      return;
    }

    for (const { videoId, jobId } of pendentes) {
      await exportarVideoAutomaticamente(videoId, jobId);
    }
  } finally {
    sincronizacaoEmAndamento = false;
  }
}
