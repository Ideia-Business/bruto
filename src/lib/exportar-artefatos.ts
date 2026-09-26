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

export function nomeArquivoDoCabecalho(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const match = /filename="?([^";]+)"?/i.exec(header);
  return match?.[1] ? sanitizarNomeArquivo(decodeURIComponent(match[1])) : fallback;
}

/** Evita disparo concorrente do mesmo vídeo (ex.: heartbeat/evento duplicado). */
const emAndamento = new Set<string>();

export async function exportarVideoAutomaticamente(videoId: string | null | undefined): Promise<void> {
  if (!videoId) return;
  if (!autoExportarAtivado()) return;
  if (emAndamento.has(videoId)) return;

  const handle = await obterPastaSalva();
  if (!handle) return; // nunca configurado — nada a fazer, sem ruído

  const permissao = await permissaoAtual(handle);
  if (permissao !== "granted") {
    toast.warning("Não deu para salvar cópia na pasta escolhida: a permissão expirou.", {
      description:
        "O vídeo está salvo normalmente na biblioteca. Abra Configurações para reconceder o acesso.",
    });
    return;
  }

  emAndamento.add(videoId);
  try {
    const res = await fetchApp(`/api/videos/${videoId}`);
    if (!res.ok) throw new Error("Não foi possível ler os dados do vídeo.");
    const detalhe = (await res.json()) as DetalheVideoWire;

    const categoriaNome = sanitizarNomeArquivo(detalhe.category?.name ?? "Sem categoria");
    const tituloNome = sanitizarNomeArquivo(detalhe.video.title);

    const pastaCategoria = await handle.getDirectoryHandle(categoriaNome, { create: true });
    const pastaVideo = await pastaCategoria.getDirectoryHandle(tituloNome, { create: true });

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
    }

    toast.success(`Salvo também em ${categoriaNome}/${tituloNome}`, {
      description: "Cópia na pasta escolhida — o original continua na biblioteca do Bruto.",
    });
  } catch {
    toast.warning("Não deu para salvar cópia na pasta escolhida.", {
      description:
        "O vídeo está salvo normalmente na biblioteca. Se a pasta sumiu ou mudou de lugar, reabra Configurações.",
    });
  } finally {
    emAndamento.delete(videoId);
  }
}
