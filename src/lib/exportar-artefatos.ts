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
 * Uma falha DEPOIS de já ter escrito pelo menos um arquivo de verdade marca
 * "já tentado" (é uma cópia parcial, não repete a cada reload). Uma falha
 * ANTES de escrever nada — rede caiu no GET dos dados do vídeo, 500
 * transitório, pasta sumiu bem no início — NÃO marca: sem isso, um erro
 * passageiro bloqueava o vídeo pra sempre, e nem reabrir a pasta nem
 * reconceder permissão recuperava (não há retry se o id já está marcado).
 */
export function deveMarcarAposFalha(escritos: number): boolean {
  return escritos > 0;
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

  const handle = await obterPastaSalva();
  if (!handle) return; // nunca configurado — nada a fazer, sem ruído (condição prévia, não falha: não marca)

  const permissao = await permissaoAtual(handle);
  if (permissao !== "granted") {
    toast.warning("Não deu para salvar cópia na pasta escolhida: a permissão expirou.", {
      description:
        "O vídeo está salvo normalmente na biblioteca. Abra Configurações para reconceder o acesso.",
    });
    return; // condição prévia recuperável — não marca, tenta de novo quando a permissão voltar
  }

  emAndamento.add(videoId);
  // Fora do try para o catch poder ver quanto já foi escrito de verdade — é o
  // que decide se uma falha marca "já tentado" (parou o retry pra sempre) ou
  // fica livre pro catch-up tentar de novo na próxima carga de página.
  let escritos = 0;
  try {
    const res = await fetchApp(`/api/videos/${videoId}`);
    if (!res.ok) throw new Error("Não foi possível ler os dados do vídeo.");
    const detalhe = (await res.json()) as DetalheVideoWire;

    const categoriaNome = sanitizarNomeArquivo(detalhe.category?.name ?? "Sem categoria");
    const tituloNome = sanitizarNomeArquivo(detalhe.video.title);
    const pastaVideoNome = nomeDaPastaDoVideo(tituloNome, videoId);

    const pastaCategoria = await handle.getDirectoryHandle(categoriaNome, { create: true });
    const pastaVideo = await pastaCategoria.getDirectoryHandle(pastaVideoNome, { create: true });

    const total = detalhe.artifacts.length;
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
        description: "O vídeo está salvo normalmente na biblioteca. Um ou mais arquivos não copiaram — tente de novo mais tarde, se precisar.",
      });
    }
    marcarExportado(videoId);
  } catch {
    toast.warning("Não deu para salvar cópia na pasta escolhida.", {
      description:
        "O vídeo está salvo normalmente na biblioteca. Se a pasta sumiu ou mudou de lugar, reabra Configurações.",
    });
    if (deveMarcarAposFalha(escritos)) marcarExportado(videoId);
  } finally {
    emAndamento.delete(videoId);
  }
}

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
 * calma, em /configuracoes.
 */
export async function sincronizarExportacoesPendentes(): Promise<void> {
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
  for (const videoId of pendentes) {
    await exportarVideoAutomaticamente(videoId);
  }
}
