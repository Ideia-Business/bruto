"use client";

import Link from "next/link";
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
  GraduationCap,
  Pencil,
  Check,
  X,
  Languages,
  ScrollText,
  Network,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Markdown } from "./markdown";
import { FilaoPicker } from "./filao-picker";
import { CopyButton } from "./copy-button";
import { TranscriptView } from "./transcript-view";
import { JobProgressBar, useJobProgress } from "./job-progress";
import {
  formatDuration,
  formatUploadDate,
  TRANSCRIPT_SOURCE_LABEL,
  PLATFORM_LABEL,
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

interface Category {
  id: number;
  name: string;
}

interface DetailData {
  video: {
    id: string;
    url: string;
    platform: string;
    title: string;
    channel: string | null;
    durationSec: number | null;
    uploadDate: string | null;
    transcriptSource: string | null;
    categoryId: number | null;
  };
  category: { id: number; name: string } | null;
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
    studyMd: string | null;
  };
  defaultTab?: string;
}

const EXPORT_META: Record<string, { label: string; icon: React.ReactNode }> = {
  docx: { label: "Word (.docx)", icon: <FileType className="size-4" /> },
  pdf: { label: "PDF", icon: <FileText className="size-4" /> },
  summary_md: { label: "Resumo (.md)", icon: <FileText className="size-4" /> },
  study_md: { label: "Aula didática (.md)", icon: <GraduationCap className="size-4" /> },
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

export function VideoDetail({
  data,
  categories,
}: {
  data: DetailData;
  categories: Category[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const isActive = data.latestJob?.status === "queued" || data.latestJob?.status === "running";
  const progress = useJobProgress(isActive ? (data.latestJob?.id ?? null) : null, {
    onDone: () => router.refresh(),
    onError: () => router.refresh(),
  });

  const [studyBusy, setStudyBusy] = useState(false);
  async function generateStudy() {
    setStudyBusy(true);
    try {
      const res = await fetch(`/api/videos/${data.video.id}/study`, { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(d.error ?? "Não foi possível montar a aula.");
        return;
      }
      toast.success("Aula pronta!");
      router.refresh();
    } catch {
      toast.error("Erro de rede ao montar a aula.");
    } finally {
      setStudyBusy(false);
    }
  }

  // Edição inline do título cadastrado.
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(data.video.title);
  async function saveTitle() {
    const title = titleDraft.trim();
    if (!title) {
      toast.error("O título não pode ficar vazio.");
      return;
    }
    if (title === data.video.title) {
      setEditingTitle(false);
      return;
    }
    const res = await fetch(`/api/videos/${data.video.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (res.ok) {
      toast.success("Título atualizado.");
      setEditingTitle(false);
      router.refresh();
    } else {
      const d = await res.json().catch(() => ({}));
      toast.error(d.error ?? "Não foi possível renomear.");
    }
  }

  async function changeCategory(categoryId: string) {
    const res = await fetch(`/api/videos/${data.video.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryId: Number(categoryId) }),
    });
    if (res.ok) {
      toast.success("Categoria atualizada.");
      router.refresh();
    } else {
      toast.error("Não foi possível mudar a categoria.");
    }
  }

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
    <div className="space-y-8">
      {/* Cabeçalho de documento — claro, sem imagem de fundo nem gradiente. */}
      <div className="space-y-3">
        <Button variant="ghost" size="sm" asChild className="-ml-2 gap-1.5 text-muted-foreground">
          <Link href="/">
            <ArrowLeft className="size-4" /> Catálogo
          </Link>
        </Button>

        {editingTitle ? (
          <div className="flex max-w-3xl flex-col gap-2">
            <Input
              autoFocus
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveTitle();
                if (e.key === "Escape") {
                  setTitleDraft(data.video.title);
                  setEditingTitle(false);
                }
              }}
              className="h-auto py-2 font-heading text-2xl font-semibold sm:text-3xl"
              placeholder="Título do vídeo"
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={saveTitle} className="gap-1.5">
                <Check className="size-4" /> Salvar
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setTitleDraft(data.video.title);
                  setEditingTitle(false);
                }}
                className="gap-1.5"
              >
                <X className="size-4" /> Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <div className="group flex max-w-3xl items-start gap-2">
            <h1 className="font-heading text-3xl font-semibold leading-tight text-foreground">
              {data.video.title}
            </h1>
            <button
              onClick={() => {
                setTitleDraft(data.video.title);
                setEditingTitle(true);
              }}
              title="Renomear"
              aria-label="Renomear título"
              className="mt-1.5 shrink-0 rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus:opacity-100 group-hover:opacity-100"
            >
              <Pencil className="size-4" />
            </button>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm text-muted-foreground">
          <span>{data.video.channel}</span>
          {data.video.durationSec ? (
            <span className="tabular-nums">· {formatDuration(data.video.durationSec)}</span>
          ) : null}
          {data.video.uploadDate ? <span>· {formatUploadDate(data.video.uploadDate)}</span> : null}
          <Select
            value={data.video.categoryId ? String(data.video.categoryId) : undefined}
            onValueChange={changeCategory}
          >
            <SelectTrigger size="sm" className="h-7 w-auto gap-1 border-border bg-secondary text-xs">
              <SelectValue placeholder="Categoria" />
            </SelectTrigger>
            <SelectContent>
              {categories.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FilaoPicker videoId={data.video.id} />
          <Badge variant="secondary">
            {PLATFORM_LABEL[data.video.platform] ?? data.video.platform}
          </Badge>
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
            <ExternalLink className="size-3.5" /> Ver original
          </a>
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
                <Languages className="mr-1.5 size-4" /> Traduzir tudo
              </Button>
            )}
            <Button size="sm" variant="ghost" disabled={busy} onClick={remove} className="ml-auto text-destructive hover:text-destructive">
              <Trash2 className="mr-1.5 size-4" /> Excluir
            </Button>
          </div>

          {/* Abas — estilo sublinhado (underline), sem preenchimento pesado. */}
          <Tabs defaultValue={data.defaultTab ?? "summary"}>
            <TabsList className="h-auto w-full justify-start gap-1 rounded-none border-b border-border bg-transparent p-0">
              {[
                { v: "summary", label: "Resumo", Icon: FileText },
                { v: "study", label: "Estudar", Icon: GraduationCap },
                { v: "transcript", label: "Transcrição", Icon: ScrollText },
                { v: "mindmap", label: "Mapa Mental", Icon: Network },
                { v: "exports", label: "Exportações", Icon: Download },
              ].map(({ v, label, Icon }) => (
                <TabsTrigger
                  key={v}
                  value={v}
                  className="gap-1.5 rounded-none border-0 border-b-2 border-transparent bg-transparent px-3 py-2.5 text-muted-foreground shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
                >
                  <Icon className="size-4" />
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value="summary" className="pt-6">
              {data.content.summaryMd ? (
                <div className="space-y-3">
                  <div className="mx-auto flex max-w-[42rem] justify-end">
                    <CopyButton text={data.content.summaryMd} label="Copiar resumo" />
                  </div>
                  <article className="mx-auto max-w-[42rem]">
                    <Markdown>{data.content.summaryMd}</Markdown>
                  </article>
                </div>
              ) : (
                <Empty>Resumo ainda não gerado.</Empty>
              )}
            </TabsContent>

            <TabsContent value="study" className="pt-6">
              {data.content.studyMd ? (
                <div className="space-y-3">
                  <div className="mx-auto flex max-w-[42rem] items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground">
                      Aula gerada a partir do conteúdo do vídeo.
                    </p>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={studyBusy}
                        onClick={generateStudy}
                        className="gap-1.5"
                      >
                        <RefreshCw className="size-3.5" /> Refazer
                      </Button>
                      <CopyButton text={data.content.studyMd} label="Copiar aula" />
                    </div>
                  </div>
                  <article className="mx-auto max-w-[42rem]">
                    <Markdown allowHtml>{data.content.studyMd}</Markdown>
                  </article>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-border py-16 text-center">
                  <GraduationCap className="size-10 text-primary" />
                  <div className="max-w-md space-y-1">
                    <h3 className="text-lg font-semibold">Estudar sobre o conteúdo</h3>
                    <p className="text-sm text-muted-foreground">
                      Monte uma aula didática que ensina o que importa do zero — com
                      objetivos, conceitos explicados, teste de fixação e referências
                      para aprofundar.
                    </p>
                  </div>
                  <Button disabled={studyBusy} onClick={generateStudy} className="gap-1.5">
                    {studyBusy ? (
                      <>
                        <RefreshCw className="size-4 animate-spin" /> Montando aula…
                      </>
                    ) : (
                      <>
                        <GraduationCap className="size-4" /> Montar aula didática
                      </>
                    )}
                  </Button>
                  {studyBusy && (
                    <p className="text-xs text-muted-foreground">
                      Isso leva cerca de um minuto — estou preparando a aula.
                    </p>
                  )}
                </div>
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

            <TabsContent value="mindmap" className="pt-6">
              {data.content.mindmapMd ? (
                <div className="space-y-3">
                  <div className="flex justify-end">
                    <CopyButton text={data.content.mindmapMd} label="Copiar mapa (markdown)" />
                  </div>
                  <div className="h-[65vh] overflow-hidden rounded-xl border border-border bg-card">
                    <MindmapViewer markdown={data.content.mindmapMd} />
                  </div>
                </div>
              ) : (
                <Empty>Mapa mental ainda não gerado.</Empty>
              )}
            </TabsContent>

            <TabsContent value="exports" className="pt-6">
              {exportable.length > 0 ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {exportable.map((a) => (
                    <a
                      key={a.id}
                      href={`/api/artifacts/${a.id}`}
                      className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 shadow-xs transition-[border-color,box-shadow] hover:border-ring/40 hover:shadow-sm"
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
