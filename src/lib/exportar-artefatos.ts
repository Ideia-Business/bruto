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
  obterPastaAtual,
  obterPastaId,
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
 * Mapa `videoId -> jobId` já exportado com sucesso pleno, DA PASTA cujo id é
 * passado — nunca relê a pasta atual. Escopar por pasta é o que faz trocar de
 * pasta A para uma pasta B vazia voltar a exportar tudo em B (a marca de A
 * não "vaza" pra B). Tomar o `pastaId` como parâmetro, em vez de reler
 * `obterPastaId()` aqui dentro, é o que fecha a corrida do item 1 da 5ª
 * revisão: se a leitura e a escrita relessem a pasta atual cada uma na sua
 * vez, uma troca de pasta no MEIO de uma exportação gravaria a marca de
 * sucesso na pasta NOVA mesmo com os bytes tendo ido pra pasta ANTIGA — quem
 * chama precisa capturar o `pastaId` UMA vez, junto com o handle, e usar o
 * mesmo valor do início ao fim (ver `exportarVideoAutomaticamente`).
 */
async function obterExportadosDaPasta(pastaId: string | null): Promise<Record<string, string>> {
  try {
    const bruto = localStorage.getItem(chaveExportados(pastaId));
    return bruto ? (JSON.parse(bruto) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

async function marcarExportadoNaPasta(videoId: string, jobId: string, pastaId: string | null): Promise<void> {
  try {
    const atual = await obterExportadosDaPasta(pastaId);
    atual[videoId] = jobId;
    localStorage.setItem(chaveExportados(pastaId), JSON.stringify(atual));
  } catch {
    /* modo privado ou storage bloqueado — a marca só não persiste, tenta de novo na próxima carga */
  }
}

/**
 * Só marca (sucesso pleno, `deveMarcarExportado`) se a pasta ATUAL ainda for
 * a mesma capturada no INÍCIO desta exportação (`pastaCapturada`). Item 1 da
 * 5ª revisão: se a pessoa trocou de pasta A→B enquanto esta exportação
 * estava no meio do caminho, os bytes foram pra A (o handle que foi
 * capturado junto com `pastaCapturada`), mas o mundo já é B agora — marcar
 * em qualquer uma das duas mentiria (A não é mais "a pasta atual" pra
 * ninguém checar essa marca de novo; B nunca recebeu esses bytes). Fica sem
 * marca, e quem decide o que fazer na pasta nova é o próximo catch-up.
 */
async function marcarSeAPastaNaoMudou(
  videoId: string,
  jobId: string,
  pastaCapturada: string | null,
  escritos: number,
  total: number,
): Promise<void> {
  if (!deveMarcarExportado(escritos, total)) return;
  if ((await obterPastaId()) !== pastaCapturada) return;
  await marcarExportadoNaPasta(videoId, jobId, pastaCapturada);
}

/**
 * Esquece a marca de exportação de um vídeo NA PASTA ATUAL. Usado quando um
 * artefato novo é gerado SOB DEMANDA (aula, transcrição organizada, contexto
 * pra IA) depois que o vídeo já tinha sido exportado: esses três endpoints
 * não criam job novo — não tocam a tabela `jobs` — então o `jobId` do vídeo
 * continua o mesmo de antes, e a marca (chaveada por jobId) nunca invalidava
 * sozinha. Sem isto, a pasta ficava pra sempre sem o artefato novo, em
 * silêncio (ver `reexportarAposArtefatoNovo`, chamado pela UI que gera esses
 * artefatos).
 */
export async function esquecerExportacaoDoVideo(videoId: string): Promise<void> {
  try {
    const pastaId = await obterPastaId();
    const atual = await obterExportadosDaPasta(pastaId);
    if (!(videoId in atual)) return;
    delete atual[videoId];
    localStorage.setItem(chaveExportados(pastaId), JSON.stringify(atual));
  } catch {
    /* modo privado ou storage bloqueado — nada a desfazer */
  }
}

/**
 * Esquece a marca e tenta exportar de novo na hora — a pessoa que acabou de
 * gerar a aula/transcrição organizada/contexto pra IA não devia precisar
 * navegar pra outra página só pra a cópia pegar o artefato novo.
 */
export async function reexportarAposArtefatoNovo(videoId: string): Promise<void> {
  await esquecerExportacaoDoVideo(videoId);
  void sincronizarExportacoesPendentes();
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

/**
 * Evita repetir o MESMO toast de aviso pro mesmo (vídeo, job) a cada 60s do
 * timer — item 3 da 6ª revisão (Grok): uma falha PERSISTENTE (pasta apagada,
 * artefato 404 permanente) não marca (corretamente — ver `deveMarcarExportado`),
 * então o catch-up tenta de novo a cada 60s pra sempre, e sem isto avisava
 * de novo a cada vez, indefinidamente. Chave por `${videoId}:${jobId}`, não
 * só `videoId`: um job novo (retry) que falhe de novo merece aviso de novo —
 * é uma falha diferente, não a mesma repetindo.
 */
const ultimoAvisoPorVideo = new Map<string, string>();

export function avisarUmaVez(videoId: string, jobId: string, tipoAviso: string, mostrar: () => void): void {
  const chave = `${videoId}:${jobId}`;
  if (ultimoAvisoPorVideo.get(chave) === tipoAviso) return;
  ultimoAvisoPorVideo.set(chave, tipoAviso);
  mostrar();
}

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
  // Capturado junto com o handle, logo abaixo, e usado do início ao fim desta
  // chamada — nunca relido no meio. Ver o comentário perto de
  // `marcarExportadoNaPasta` pra o porquê.
  let pastaId: string | null = null;
  try {
    // Handle e pastaId vêm da MESMA leitura do IndexedDB (`obterPastaAtual`,
    // item 2 da 6ª revisão — duas leituras separadas, mesmo cada uma rápida,
    // deixavam uma janela pra pasta trocar ENTRE elas). É o que garante que
    // os bytes (escritos no `handle` capturado aqui) e a marca de sucesso (no
    // fim, gravada só se `pastaId` ainda bater) sempre se refiram à MESMA
    // pasta. Sem isto: pessoa troca de pasta A→B no meio da exportação, os
    // bytes vão pra A (handle já capturado), mas a marca seria gravada na
    // chave de B (lida de novo, fresca, no fim) — B "acharia" que já tinha
    // esse vídeo sem nunca ter recebido nada, e o catch-up nunca mais
    // tentaria esse vídeo em B.
    const pastaAtual = await obterPastaAtual();
    if (!pastaAtual) return; // nunca configurado — nada a fazer, sem ruído (condição prévia: não marca)
    const { handle } = pastaAtual;
    pastaId = pastaAtual.pastaId;

    const exportados = await obterExportadosDaPasta(pastaId);
    if (exportados[videoId] === jobId) return; // já exportado ESTE job nesta pasta — nada a fazer

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

    // Reconfere o total ANTES de decidir sucesso. Se um artefato novo
    // apareceu (aula/transcrição gerada sob demanda) enquanto este laço
    // rodava, a contagem capturada no início já está desatualizada:
    // `escritos` podia bater com aquele total antigo sem o pacote estar
    // completo de verdade. Sem isto (item 1 da 6ª revisão): uma exportação
    // em andamento terminava o laço com a lista velha, marcava "sucesso
    // pleno" bem na hora em que `reexportarAposArtefatoNovo` tentava
    // invalidar essa marca pra pegar o artefato novo — o artefato nunca
    // chegava na pasta, e como a marca passava a existir de qualquer jeito,
    // o catch-up nunca mais tentava esse vídeo.
    try {
      const resFresco = await fetchApp(`/api/videos/${videoId}`);
      if (resFresco.ok) {
        const detalheFresco = (await resFresco.json()) as DetalheVideoWire;
        total = Math.max(total, detalheFresco.artifacts.length);
      }
    } catch {
      /* reconferência falhou — segue com o total que já tínhamos: uma checagem
         extra não deve travar a exportação inteira se ela mesma falhar */
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
      avisarUmaVez(videoId, jobId, "parcial", () => {
        toast.warning(`${resultado.titulo} ${destino}.`, {
          description:
            "O vídeo está salvo normalmente na biblioteca. Vai tentar de novo na próxima vez que a página carregar.",
        });
      });
    }
    await marcarSeAPastaNaoMudou(videoId, jobId, pastaId, escritos, total);
  } catch {
    avisarUmaVez(videoId, jobId, "falha", () => {
      toast.warning("Não deu para salvar cópia na pasta escolhida.", {
        description:
          "O vídeo está salvo normalmente na biblioteca. Se a pasta sumiu ou mudou de lugar, reabra Configurações.",
      });
    });
    // Na prática esta condição quase nunca é verdadeira aqui — uma exceção
    // significa que o laço foi interrompido (ou nem começou), então
    // `escritos === total` só valeria se a falha tivesse acontecido DEPOIS
    // do laço terminar por completo. É a mesma regra do caminho normal,
    // aplicada por consistência — não uma regra nova para o catch.
    await marcarSeAPastaNaoMudou(videoId, jobId, pastaId, escritos, total);
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

/** Assinatura (pastaId + vídeos pendentes) do último aviso "pasta não encontrada" já mostrado — item 3 da 6ª revisão, mesmo mecanismo de `avisarUmaVez`. */
let ultimoAvisoPastaAusente: string | null = null;

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
    // Handle e pastaId da MESMA leitura (ver o comentário em
    // `exportarVideoAutomaticamente`) — aqui não decide uma escrita
    // sozinho, mas filtrar "pendentes" contra o pastaId errado faria o
    // catch-up pular vídeo que devia tentar, ou tentar vídeo que a pasta
    // atual já tem.
    const pastaAtual = await obterPastaAtual();
    if (!pastaAtual) return;
    const { handle, pastaId } = pastaAtual;
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

    const exportados = await obterExportadosDaPasta(pastaId);
    const pendentes = idsPendentesDeExportacao(prontos, exportados);
    if (pendentes.length === 0) return;

    if (!(await pastaAindaExisteNoDisco(handle))) {
      // Assinatura de QUAIS vídeos estão pendentes (não só a contagem) — se
      // a pasta some de novo mais tarde com um conjunto DIFERENTE de
      // pendentes, é um episódio novo, e merece aviso novo.
      const assinatura = `${pastaId ?? "default"}|${[...pendentes]
        .map((p) => p.videoId)
        .sort()
        .join(",")}`;
      if (ultimoAvisoPastaAusente !== assinatura) {
        ultimoAvisoPastaAusente = assinatura;
        toast.warning("A pasta de exportação não foi encontrada.", {
          description: `Pode ter sido movida, renomeada ou apagada. ${pendentes.length} vídeo(s) aguardando — abra Configurações para escolher a pasta de novo.`,
        });
      }
      return;
    }
    // A pasta respondeu de novo — o próximo episódio de "sumiu", mesmo com
    // o mesmo conjunto de pendentes de antes, é digno de aviso novo.
    ultimoAvisoPastaAusente = null;

    for (const { videoId, jobId } of pendentes) {
      await exportarVideoAutomaticamente(videoId, jobId);
    }
  } finally {
    sincronizacaoEmAndamento = false;
  }
}
