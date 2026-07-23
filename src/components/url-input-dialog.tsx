"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
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
import { Input } from "@/components/ui/input";

/**
 * Dialog para colar uma URL do YouTube e disparar o processamento.
 * Opções: forçar Whisper e traduzir para PT-BR.
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
  const [url, setUrl] = useState("");
  const [whisper, setWhisper] = useState(false);
  const [translate, setTranslate] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit() {
    if (!url.trim()) return;
    setLoading(true);
    try {
      const res = await fetch("/api/videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, forceWhisper: whisper, translate }),
      });
      const data = await res.json();
      if (res.status === 409 && data.duplicate) {
        toast.info("Esse vídeo já está no catálogo.");
        setOpen(false);
        router.push(`/video/${data.videoId}`);
        return;
      }
      if (!res.ok) {
        toast.error(data.error ?? "Não foi possível processar.");
        return;
      }
      toast.success("Vídeo na fila! Acompanhe o progresso abaixo.");
      setUrl("");
      setOpen(false);
      onQueued?.(data.jobId);
      router.refresh();
    } catch {
      toast.error("Erro de rede ao enviar o vídeo.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo vídeo</DialogTitle>
          <DialogDescription>
            Cole o link do YouTube. Geramos resumo, transcrição e mapa mental.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Input
            autoFocus
            placeholder="https://www.youtube.com/watch?v=..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !loading && submit()}
          />
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
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={loading || !url.trim()}>
            {loading ? "Enviando…" : "Processar vídeo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
