"use client";

import Link from "next/link";
import { Thumb } from "./thumb";
import { formatDuration, TRANSCRIPT_SOURCE_LABEL } from "@/lib/format";
import type { VideoCard as VideoCardData } from "@/lib/api-types";

/** Card de vídeo estilo Netflix: thumb 16:9, hover scale, overlay de título. */
export function VideoCard({ video }: { video: VideoCardData }) {
  const duration = formatDuration(video.durationSec);
  return (
    <Link
      href={`/video/${video.id}`}
      className="group relative block overflow-hidden rounded-md ring-1 ring-white/5 transition-transform duration-200 ease-out hover:z-10 hover:scale-[1.04] hover:ring-white/20"
    >
      <div className="relative aspect-video bg-muted">
        <Thumb
          videoId={video.id}
          alt={video.title}
          className="h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent opacity-90" />
        {duration && (
          <span className="absolute bottom-1.5 right-1.5 rounded bg-black/75 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-white">
            {duration}
          </span>
        )}
        {video.transcriptSource === "whisper" && (
          <span className="absolute left-1.5 top-1.5 rounded bg-primary/80 px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground">
            {TRANSCRIPT_SOURCE_LABEL.whisper}
          </span>
        )}
      </div>
      <div className="absolute inset-x-0 bottom-0 p-2.5">
        <p className="line-clamp-2 text-sm font-semibold leading-tight text-white drop-shadow">
          {video.title}
        </p>
        {video.channel && (
          <p className="mt-0.5 line-clamp-1 text-xs text-white/70">{video.channel}</p>
        )}
      </div>
    </Link>
  );
}
