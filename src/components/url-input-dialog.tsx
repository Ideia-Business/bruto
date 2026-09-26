"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { CheckCircle2, XCircle, Copy } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Compatibilidade } from "./compatibilidade";
import { fetchApp } from "@/lib/fetch-app";
import {
  avaliarLoteDeLinks,
  chaveDeRastreio,
  contarEnvioDoLote,
  filtrarNaoEnviados,
  planejarEnvioDoLote,
} from "@/lib/lote-de-links";

/** Um item do resumo, na ordem em que a linha apareceu no textarea. */
interface ResultadoDoLote {
  readonly linha: string;
  readonly status: "invalido" | "fila" | "duplicado" | "erro";
  readonly mensagem: string;
  readonly videoId?: string;
  readonly jobId?: string;
}

async function enviarLinha(
  linha: string,
  opcoes: { forceWhisper: boolean; translate: boolean },
): Promise<ResultadoDoLote> {
  try {
    const res = await fetchApp("/api/videos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: linha, ...opcoes }),
    });
    const data = await res.json();
    if (res.status === 409 && data.duplicate) {
      return { linha, status: "duplicado", mensagem: "Já está no catálogo.", videoId: data.videoId };
    }
    if (!res.ok) {
      return { linha, status: "erro", mensagem: data.error ?? "Não foi possível processar." };
    }
    return { linha, status: "fila", mensagem: "Na fila.", jobId: data.jobId };
  } catch {
    return { linha, status: "erro", mensagem: "Erro de rede." };
  }
}

/**
 * Dialog para colar um ou vários links (um por linha) e disparar o
 * processamento em lote. Traduzir/Whisper valem para o lote inteiro.
 */
export function UrlInputDialog({
  trigger,
  onQueued,
}: {
  trigger: React.ReactNode;
  onQueued?: (jobId: string) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [texto, setTexto] = useState("");
  const [whisper, setWhisper] = useState(false);
  const [translate, setTranslate] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resultados, setResultados] = useState<ResultadoDoLote[] | null>(null);
  // Cada submit ganha um número; se um envio mais novo começar antes de um
  // mais velho terminar (ou o diálogo fechar/reabrir no meio do caminho), a
  // EXIBIÇÃO da resposta atrasada do mais velho é descartada — mas os
  // efeitos de rede (job já criado no servidor) sempre propagam, ver submit().
  const envioAtualRef = useRef(0);
  // Chaves (id, ou texto cru sem id) das linhas que já voltaram fila/duplicado
  // nesta sessão do diálogo — para reenviar depois de editar não duplicar um
  // vídeo que já está queued/running (isBrutoDone só barra o que é done).
  const enviadosAnteriormenteRef = useRef<Set<string>>(new Set());

  function fecharEResetar() {
    envioAtualRef.current += 1;
    enviadosAnteriormenteRef.current = new Set();
    setOpen(false);
    setTexto("");
    setResultados(null);
    setLoading(false);
  }

  async function submit() {
    const loteCompleto = avaliarLoteDeLinks(texto);
    if (loteCompleto.length === 0) return;

    const lote = filtrarNaoEnviados(loteCompleto, enviadosAnteriormenteRef.current);
    if (lote.length === 0) {
      toast.info("Nada novo para enviar — esses links já foram processados.");
      return;
    }

    const meuEnvio = ++envioAtualRef.current;
    setLoading(true);
    setResultados(null);

    // Slot por POSIÇÃO no lote, nunca por texto — duas linhas idênticas
    // (mesmo agrupadas para uma única chamada de rede, ver `planejarEnvioDoLote`)
    // têm cada uma o seu resultado no resumo.
    const resultado: ResultadoDoLote[] = lote.map((item) => ({
      linha: item.linha,
      status: "invalido" as const,
      mensagem: "Link não reconhecido — veja a lista de plataformas abaixo.",
    }));

    const { tarefas, seguidores } = planejarEnvioDoLote(lote);
    const respostas = await Promise.allSettled(
      tarefas.map((t) => enviarLinha(t.linha, { forceWhisper: whisper, translate })),
    );
    tarefas.forEach((t, i) => {
      const r = respostas[i];
      resultado[t.index] =
        r.status === "fulfilled"
          ? { ...r.value, linha: t.linha }
          : { linha: t.linha, status: "erro", mensagem: "Erro inesperado." };
    });
    // Seguidoras copiam o resultado do líder do mesmo id — mesma URL em
    // grafia diferente não dispara uma segunda chamada nem processa o
    // vídeo duas vezes.
    seguidores.forEach((s) => {
      resultado[s.index] = { ...resultado[s.liderIndex], linha: lote[s.index].linha };
    });

    // Registra o que o servidor de fato confirmou — vale mesmo se este
    // envio for superado a seguir: é fato do servidor, não da exibição.
    lote.forEach((item, i) => {
      if (resultado[i].status === "fila" || resultado[i].status === "duplicado") {
        enviadosAnteriormenteRef.current.add(chaveDeRastreio(item));
      }
    });

    const { naFila, duplicados, falhas } = contarEnvioDoLote(resultado);

    // Efeitos de rede propagam mesmo se este envio foi superado (diálogo
    // fechado, ou um novo envio disparado no meio do caminho): o job já
    // existe no servidor, quem está olhando a home precisa saber — só a
    // exibição do resumo é que não faz mais sentido.
    if (naFila > 0) {
      const primeiro = resultado.find((r) => r.status === "fila" && r.jobId);
      if (primeiro?.jobId) onQueued?.(primeiro.jobId);
      router.refresh();
    }

    if (meuEnvio !== envioAtualRef.current) return; // envio superado — exibição para aqui

    setResultados(resultado);
    setLoading(false);

    if (falhas === 0 && duplicados === 0) {
      toast.success(naFila === 1 ? "Vídeo na fila! Acompanhe o progresso abaixo." : `${naFila} vídeos na fila!`);
      fecharEResetar();
      return;
    }

    toast.info(
      [
        naFila > 0 ? `${naFila} na fila` : null,
        duplicados > 0 ? `${duplicados} já no catálogo` : null,
        falhas > 0 ? `${falhas} com problema` : null,
      ]
        .filter(Boolean)
        .join(" · "),
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) fecharEResetar();
        else setOpen(true);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo vídeo</DialogTitle>
          <DialogDescription>
            Cole um ou vários links (um por linha) de plataformas suportadas.
            Geramos resumo, transcrição e mapa mental de cada um.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Textarea
              autoFocus
              placeholder={"YouTube, Instagram ou TikTok…\num link por linha"}
              value={texto}
              onChange={(e) => {
                setTexto(e.target.value);
                // Editar depois de ver o resumo volta para "Destrinchar" —
                // sem isso, a única saída do resumo era fechar o diálogo
                // (que apaga o texto) e não dava para corrigir e reenviar.
                if (resultados) setResultados(null);
              }}
              rows={4}
              disabled={loading}
            />
            <Compatibilidade compacta />
          </div>
          <div className="flex flex-col gap-2 text-sm">
            <label className="flex items-center gap-2 text-muted-foreground">
              <input
                type="checkbox"
                checked={translate}
                onChange={(e) => setTranslate(e.target.checked)}
                className="size-4 accent-primary"
              />
              Traduzir tudo para português (vídeos em outro idioma)
            </label>
            <label className="flex items-center gap-2 text-muted-foreground">
              <input
                type="checkbox"
                checked={whisper}
                onChange={(e) => setWhisper(e.target.checked)}
                className="size-4 accent-primary"
              />
              Forçar transcrição por IA (Whisper) — mais fiel, mais lento
            </label>
          </div>
          {resultados && (
            <ul className="space-y-1.5 rounded-lg border border-border bg-muted/30 p-2.5 text-xs">
              {resultados.map((r, i) => (
                <li key={`${r.linha}-${i}`} className="flex items-start gap-1.5">
                  {r.status === "fila" ? (
                    <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-foreground" />
                  ) : r.status === "duplicado" ? (
                    <Copy className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <XCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-muted-foreground">{r.linha}</span>
                    {r.status === "duplicado" && r.videoId ? (
                      <button
                        type="button"
                        className="underline underline-offset-2 hover:text-foreground"
                        onClick={() => {
                          fecharEResetar();
                          router.push(`/video/${r.videoId}`);
                        }}
                      >
                        {r.mensagem} Ver vídeo.
                      </button>
                    ) : (
                      <span className={r.status === "erro" || r.status === "invalido" ? "text-destructive" : ""}>
                        {r.mensagem}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <DialogFooter>
          {resultados ? (
            <Button onClick={fecharEResetar}>Fechar</Button>
          ) : (
            <Button onClick={submit} disabled={loading || !texto.trim()}>
              {loading ? "Enviando…" : "Destrinchar"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
