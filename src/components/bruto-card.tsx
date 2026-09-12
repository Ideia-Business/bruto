"use client";

import Link from "next/link";
import { Thumb } from "./thumb";
import { formatDuration, TRANSCRIPT_SOURCE_LABEL } from "@/lib/format";
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
        {video.transcriptSource === "whisper" && (
          <span className="absolute left-1.5 top-1.5 rounded border border-border bg-background/90 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {TRANSCRIPT_SOURCE_LABEL.whisper}
          </span>
        )}
      </div>
      <div className="space-y-1 p-3">
        <p className="line-clamp-2 text-[0.95rem] font-semibold leading-snug text-foreground">
          {video.title}
        </p>
        {video.channel && (
          <p className="line-clamp-1 text-[0.8rem] text-muted-foreground">{video.channel}</p>
        )}
      </div>
    </Link>
  );
}
