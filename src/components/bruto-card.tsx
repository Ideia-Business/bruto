"use client";

import Link from "next/link";
import { Thumb } from "./thumb";
import { Badge } from "@/components/ui/badge";
import { formatDuration, TRANSCRIPT_SOURCE_LABEL } from "@/lib/format";
import { rotuloDaPlataforma } from "@/lib/plataformas";
import type { BrutoCard as BrutoCardData } from "@/lib/api-types";

/** Card de vídeo clean: thumbnail nítida (sem overlay) + texto ABAIXO dela. */
export function BrutoCard({ video }: { video: BrutoCardData }) {
  const duration = formatDuration(video.durationSec);
  return (
    <Link
      href={`/video/${video.id}`}
      className="group block overflow-hidden rounded-xl border border-border bg-card shadow-xs transition-[border-color,box-shadow] duration-200 hover:border-ring/40 hover:shadow-sm"
    >
      <div className="relative aspect-video bg-muted">
        <Thumb videoId={video.id} alt={video.title} className="h-full w-full object-cover" />
        {duration && (
          <span className="absolute bottom-1.5 right-1.5 rounded bg-background/90 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-foreground shadow-xs">
            {duration}
          </span>
        )}
        <div className="absolute left-1.5 top-1.5 flex items-center gap-1">
          <Badge variant="outline" className="bg-background/90 text-[10px]">
            {rotuloDaPlataforma(video.platform)}
          </Badge>
          {video.transcriptSource === "whisper" && (
            <span className="rounded border border-border bg-background/90 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {TRANSCRIPT_SOURCE_LABEL.whisper}
            </span>
          )}
          {/* Sem isto (achado do Grok, 10ª rodada), um vídeo que caiu em
              "Outros" por FALHA de classificação ficava indistinguível na
              tela de um vídeo que a IA classificou como "Outros" de
              propósito — a única forma de saber era rodar reclassificar-cli
              e ler a lista no terminal. */}
          {video.classificacaoPendente && (
            <span
              title="Classificação pendente — a IA ainda não confirmou categoria/tags deste vídeo"
              className="rounded border border-amber-500/40 bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400"
            >
              Pendente
            </span>
          )}
        </div>
      </div>
      <div className="space-y-1 p-3">
        <p className="line-clamp-2 text-[0.95rem] font-semibold leading-snug text-foreground">
          {video.title}
        </p>
        {video.channel && (
          <p className="line-clamp-1 text-[0.8rem] text-muted-foreground">{video.channel}</p>
        )}
        {video.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-0.5">
            {video.tags.slice(0, 2).map((t) => (
              <Badge key={t.id} variant="secondary" className="text-[10px]">
                {t.name}
              </Badge>
            ))}
            {video.tags.length > 2 && (
              <Badge variant="secondary" className="text-[10px] text-muted-foreground">
                +{video.tags.length - 2}
              </Badge>
            )}
          </div>
        )}
      </div>
    </Link>
  );
}
