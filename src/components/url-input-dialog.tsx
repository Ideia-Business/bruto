"use client";

import { useState } from "react";
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
import { avaliarLoteDeLinks } from "@/lib/lote-de-links";

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

  function fecharEResetar() {
    setOpen(false);
    setTexto("");
    setResultados(null);
    setLoading(false);
  }

  async function submit() {
    const lote = avaliarLoteDeLinks(texto);
    if (lote.length === 0) return;

    setLoading(true);
    setResultados(null);

    const invalidos: ResultadoDoLote[] = lote
      .filter((item) => item.referencia === null)
      .map((item) => ({
        linha: item.linha,
        status: "invalido" as const,
        mensagem: "Link não reconhecido — veja a lista de plataformas abaixo.",
      }));

    const validos = lote.filter((item) => item.referencia !== null);
    const respostas = await Promise.allSettled(
      validos.map((item) => enviarLinha(item.linha, { forceWhisper: whisper, translate })),
    );
    const enviados = respostas.map((r, i) =>
      r.status === "fulfilled" ? r.value : { linha: validos[i].linha, status: "erro" as const, mensagem: "Erro inesperado." },
    );

    // Preserva a ordem original do que foi colado.
    const porLinha = new Map<string, ResultadoDoLote>();
    for (const item of [...invalidos, ...enviados]) porLinha.set(item.linha, item);
    const resultado = lote.map((item) => porLinha.get(item.linha)!);

    setResultados(resultado);
    setLoading(false);

    const naFila = resultado.filter((r) => r.status === "fila").length;
    const duplicados = resultado.filter((r) => r.status === "duplicado").length;
    const falhas = resultado.filter((r) => r.status === "erro" || r.status === "invalido").length;

    if (naFila > 0) {
      const primeiro = resultado.find((r) => r.status === "fila" && r.jobId);
      if (primeiro?.jobId) onQueued?.(primeiro.jobId);
      router.refresh();
    }

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
              onChange={(e) => setTexto(e.target.value)}
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
