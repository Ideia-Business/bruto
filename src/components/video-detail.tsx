"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  Download,
  RefreshCw,
  Sparkles,
  Trash2,
  FileText,
  FileType,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Markdown } from "./markdown";
import { CopyButton } from "./copy-button";
import { TranscriptView } from "./transcript-view";
import { JobProgressBar, useJobProgress } from "./job-progress";
import { Thumb } from "./thumb";
import {
  formatDuration,
  formatUploadDate,
  TRANSCRIPT_SOURCE_LABEL,
  ERROR_HINT,
} from "@/lib/format";

const MindmapViewer = dynamic(
  () => import("./mindmap-viewer").then((m) => m.MindmapViewer),
  { ssr: false, loading: () => <p className="p-8 text-center text-muted-foreground">Carregando mapa…</p> },
);

interface Artifact {
  id: string;
  kind: string;
  filePath: string;
  sizeBytes: number | null;
}

interface DetailData {
  video: {
    id: string;
    url: string;
    title: string;
    channel: string | null;
    durationSec: number | null;
    uploadDate: string | null;
    transcriptSource: string | null;
  };
  category: { name: string } | null;
  artifacts: Artifact[];
  latestJob: {
    id: string;
    status: string;
    errorCode: string | null;
  } | null;
  content: {
    summaryMd: string | null;
    mindmapMd: string | null;
    transcript: string | null;
    transcriptTs: string | null;
    transcriptTranslated: string | null;
  };
  defaultTab?: string;
}

const EXPORT_META: Record<string, { label: string; icon: React.ReactNode }> = {
  docx: { label: "Word (.docx)", icon: <FileType className="size-4" /> },
  pdf: { label: "PDF", icon: <FileText className="size-4" /> },
  summary_md: { label: "Resumo (.md)", icon: <FileText className="size-4" /> },
  mindmap_md: { label: "Mapa mental (.md)", icon: <FileText className="size-4" /> },
  mindmap_svg: { label: "Mapa mental (.svg)", icon: <FileText className="size-4" /> },
  mindmap_png: { label: "Mapa mental (.png)", icon: <FileText className="size-4" /> },
  transcript: { label: "Transcrição (.txt)", icon: <FileText className="size-4" /> },
  transcript_translated: { label: "Transcrição PT-BR (.txt)", icon: <FileText className="size-4" /> },
};

function humanSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function VideoDetail({ data }: { data: DetailData }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const isActive = data.latestJob?.status === "queued" || data.latestJob?.status === "running";
  const progress = useJobProgress(isActive ? (data.latestJob?.id ?? null) : null, {
    onDone: () => router.refresh(),
    onError: () => router.refresh(),
  });

  async function action(path: string, okMsg: string) {
    setBusy(true);
    try {
      const res = await fetch(path, { method: "POST" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toast.error(d.error ?? "Falhou.");
        return;
      }
      toast.success(okMsg);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm("Excluir este vídeo e todos os arquivos gerados?")) return;
    setBusy(true);
    const res = await fetch(`/api/videos/${data.video.id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Vídeo excluído.");
      router.push("/");
    } else {
      toast.error("Não foi possível excluir.");
      setBusy(false);
    }
  }

  const exportable = data.artifacts.filter((a) => EXPORT_META[a.kind]);

  return (
    <div className="space-y-6">
      {/* Banner */}
      <div className="relative overflow-hidden rounded-xl">
        <div className="absolute inset-0">
          <Thumb videoId={data.video.id} alt={data.video.title} className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-background/40" />
        </div>
        <div className="relative space-y-3 p-6 sm:p-8">
          <Button variant="ghost" size="sm" asChild className="gap-1.5 -ml-2">
            <a href="/">
              <ArrowLeft className="size-4" /> Catálogo
            </a>
          </Button>
          <h1 className="max-w-3xl text-2xl font-black leading-tight sm:text-3xl">
            {data.video.title}
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>{data.video.channel}</span>
            {data.video.durationSec ? <span>· {formatDuration(data.video.durationSec)}</span> : null}
            {data.video.uploadDate ? <span>· {formatUploadDate(data.video.uploadDate)}</span> : null}
            {data.category && <Badge variant="secondary">{data.category.name}</Badge>}
            {data.video.transcriptSource && (
              <Badge variant="outline">
                {TRANSCRIPT_SOURCE_LABEL[data.video.transcriptSource] ?? data.video.transcriptSource}
              </Badge>
            )}
            <a
              href={data.video.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 hover:text-foreground"
            >
              <ExternalLink className="size-3.5" /> YouTube
            </a>
          </div>
        </div>
      </div>

      {/* Estado de processamento (substitui as abas enquanto roda) */}
      {isActive ? (
        <div className="mx-auto max-w-lg space-y-2 rounded-xl border border-border bg-card p-6">
          <p className="text-sm font-medium">Processando este vídeo…</p>
          <JobProgressBar progress={progress} />
        </div>
      ) : data.latestJob?.status === "error" ? (
        <div className="space-y-3 rounded-xl border border-destructive/40 bg-destructive/10 p-6">
          <p className="text-sm text-destructive">
            {ERROR_HINT[data.latestJob.errorCode ?? "UNKNOWN"]}
          </p>
          <div className="flex gap-2">
            <Button size="sm" disabled={busy} onClick={() => action(`/api/videos/${data.video.id}/retry`, "Reprocessando…")}>
              <RefreshCw className="mr-1.5 size-4" /> Tentar de novo
            </Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => action(`/api/videos/${data.video.id}/retry?whisper=1`, "Reprocessando com Whisper…")}>
              <Sparkles className="mr-1.5 size-4" /> Usar Whisper
            </Button>
          </div>
        </div>
      ) : (
        <>
          {/* Ações */}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={busy} onClick={() => action(`/api/videos/${data.video.id}/retry`, "Reprocessando…")}>
              <RefreshCw className="mr-1.5 size-4" /> Reprocessar
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => action(`/api/videos/${data.video.id}/retry?whisper=1`, "Retranscrevendo com Whisper…")}>
              <Sparkles className="mr-1.5 size-4" /> Retranscrever (Whisper)
            </Button>
            {!data.content.transcriptTranslated && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => action(`/api/videos/${data.video.id}/retry?traduzir=1`, "Traduzindo para PT-BR…")}>
                🇧🇷 Traduzir tudo
              </Button>
            )}
            <Button size="sm" variant="ghost" disabled={busy} onClick={remove} className="ml-auto text-destructive hover:text-destructive">
              <Trash2 className="mr-1.5 size-4" /> Excluir
            </Button>
          </div>

          {/* Abas */}
          <Tabs defaultValue={data.defaultTab ?? "summary"}>
            <TabsList>
              <TabsTrigger value="summary">Resumo</TabsTrigger>
              <TabsTrigger value="transcript">Transcrição</TabsTrigger>
              <TabsTrigger value="mindmap">Mapa Mental</TabsTrigger>
              <TabsTrigger value="exports">Exportações</TabsTrigger>
            </TabsList>

            <TabsContent value="summary" className="pt-4">
              {data.content.summaryMd ? (
                <div className="space-y-3">
                  <div className="flex justify-end">
                    <CopyButton text={data.content.summaryMd} label="Copiar resumo" />
                  </div>
                  <Markdown>{data.content.summaryMd}</Markdown>
                </div>
              ) : (
                <Empty>Resumo ainda não gerado.</Empty>
              )}
            </TabsContent>

            <TabsContent value="transcript" className="pt-4">
              {data.content.transcript || data.content.transcriptTs ? (
                <TranscriptView
                  plain={data.content.transcript}
                  timestamped={data.content.transcriptTs}
                  translated={data.content.transcriptTranslated}
                />
              ) : (
                <Empty>Transcrição não disponível.</Empty>
              )}
            </TabsContent>

            <TabsContent value="mindmap" className="pt-4">
              {data.content.mindmapMd ? (
                <div className="space-y-3">
                  <div className="flex justify-end">
                    <CopyButton text={data.content.mindmapMd} label="Copiar mapa (markdown)" />
                  </div>
                  <div className="h-[65vh] overflow-hidden rounded-xl border border-border bg-card/40">
                    <MindmapViewer markdown={data.content.mindmapMd} />
                  </div>
                </div>
              ) : (
                <Empty>Mapa mental ainda não gerado.</Empty>
              )}
            </TabsContent>

            <TabsContent value="exports" className="pt-4">
              {exportable.length > 0 ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {exportable.map((a) => (
                    <a
                      key={a.id}
                      href={`/api/artifacts/${a.id}`}
                      className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 transition-colors hover:border-white/20"
                    >
                      {EXPORT_META[a.kind].icon}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{EXPORT_META[a.kind].label}</p>
                        <p className="text-xs text-muted-foreground">{humanSize(a.sizeBytes)}</p>
                      </div>
                      <Download className="size-4 text-muted-foreground" />
                    </a>
                  ))}
                </div>
              ) : (
                <Empty>
                  Exportações .docx e .pdf serão geradas na próxima etapa do projeto (Fase 3).
                </Empty>
              )}
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border py-16 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}
