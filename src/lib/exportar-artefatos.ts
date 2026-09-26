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
  obterPastaSalva,
  permissaoAtual,
  sanitizarNomeArquivo,
} from "@/lib/pasta-exportacao";

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
 * Extrai o `filename` do `Content-Disposition`. Tenta primeiro a forma com
 * aspas, pegando TUDO entre elas — inclusive `;` — porque `filename="Aula;
 * parte 2.docx"` é um nome legítimo com ponto-e-vírgula, e um regex que para
 * no primeiro `;` (mesmo dentro das aspas) cortava o nome e fazia PDF/DOCX do
 * mesmo vídeo colidirem no mesmo arquivo truncado. Cai para a forma sem aspas
 * só quando não há par de aspas no cabeçalho.
 */
export function nomeArquivoDoCabecalho(header: string | null, fallback: string): string {
  if (!header) return fallback;
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

const CHAVE_LOCALSTORAGE_EXPORTADOS = "bruto:videos-exportados";

/** IDs já exportados com sucesso ou falha definitiva — para o catch-up nunca repetir a cada carga de página. */
export function obterExportados(): Set<string> {
  try {
    const bruto = localStorage.getItem(CHAVE_LOCALSTORAGE_EXPORTADOS);
    return new Set(bruto ? (JSON.parse(bruto) as string[]) : []);
  } catch {
    return new Set();
  }
}

function marcarExportado(videoId: string): void {
  try {
    const atual = obterExportados();
    atual.add(videoId);
    localStorage.setItem(CHAVE_LOCALSTORAGE_EXPORTADOS, JSON.stringify(Array.from(atual)));
  } catch {
    /* modo privado ou storage bloqueado — a marca só não persiste, tenta de novo na próxima carga */
  }
}

/**
 * Dos vídeos prontos no servidor, quais ainda não têm marca de exportação
 * neste navegador. Função pura — é o coração do catch-up (item ligar
 * automático depois de vídeos antigos existirem também cai aqui: `done` sem
 * marca é candidato, não importa há quanto tempo terminou).
 */
export function idsPendentesDeExportacao(idsProntos: string[], jaExportados: Set<string>): string[] {
  return idsProntos.filter((id) => !jaExportados.has(id));
}

/** Evita disparo concorrente do mesmo vídeo (ex.: heartbeat/evento duplicado, ou catch-up cruzando com o SSE ao vivo). */
const emAndamento = new Set<string>();

export async function exportarVideoAutomaticamente(videoId: string | null | undefined): Promise<void> {
  if (!videoId) return;
  if (!autoExportarAtivado()) return;
  if (emAndamento.has(videoId)) return;
  if (obterExportados().has(videoId)) return;

  // Marca ANTES do primeiro `await`: o SSE (onDone, ao vivo) e o timer de
  // 60s da sincronização podem chamar para o MESMO vídeo quase ao mesmo
  // tempo. As checagens de `emAndamento`/`obterExportados` acima sozinhas
  // não bastam se a marca só acontece depois de dois `await` (pasta,
  // permissão) — os dois disparos passam pela checagem antes de qualquer um
  // marcar, e os dois abrem `createWritable` (que TRUNCA o arquivo) juntos.
  // Como JS não interrompe um trecho síncrono no meio, tudo daqui até o
  // primeiro `await` roda atômico — nenhuma segunda chamada consegue entrar
  // depois deste ponto.
  emAndamento.add(videoId);
  let escritos = 0;
  let total = -1; // -1 = ainda não sabemos — o laço nem começou (ver deveMarcarExportado)
  try {
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
    if (deveMarcarExportado(escritos, total)) marcarExportado(videoId);
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
    if (deveMarcarExportado(escritos, total)) marcarExportado(videoId);
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

    let idsProntos: string[];
    try {
      const res = await fetchApp("/api/videos/concluidos");
      if (!res.ok) return;
      const data = (await res.json()) as { videoIds: string[] };
      idsProntos = data.videoIds;
    } catch {
      return;
    }

    const pendentes = idsPendentesDeExportacao(idsProntos, obterExportados());
    if (pendentes.length === 0) return;

    if (!(await pastaAindaExisteNoDisco(handle))) {
      toast.warning("A pasta de exportação não foi encontrada.", {
        description: `Pode ter sido movida, renomeada ou apagada. ${pendentes.length} vídeo(s) aguardando — abra Configurações para escolher a pasta de novo.`,
      });
      return;
    }

    for (const videoId of pendentes) {
      await exportarVideoAutomaticamente(videoId);
    }
  } finally {
    sincronizacaoEmAndamento = false;
  }
}
