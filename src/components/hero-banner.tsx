"use client";

import Link from "next/link";
import { FileText, Network } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Thumb } from "./thumb";
import { formatDuration } from "@/lib/format";
import type { VideoCard } from "@/lib/api-types";

/** Banner de destaque: vídeo mais recente concluído, backdrop + CTAs. */
export function HeroBanner({ video }: { video: VideoCard }) {
  return (
    <section className="relative overflow-hidden rounded-xl">
      <div className="absolute inset-0">
        <Thumb videoId={video.id} alt={video.title} className="h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-r from-background via-background/85 to-background/30" />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-transparent" />
      </div>
      <div className="relative flex min-h-[300px] max-w-2xl flex-col justify-end gap-4 p-6 sm:min-h-[360px] sm:p-10">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">
            Último resumo
          </p>
          <h1 className="text-3xl font-black leading-tight tracking-tight sm:text-4xl">
            {video.title}
          </h1>
          <p className="text-sm text-muted-foreground">
            {video.channel}
            {video.durationSec ? ` · ${formatDuration(video.durationSec)}` : ""}
          </p>
        </div>
        <div className="flex gap-3">
          <Button asChild>
            <Link href={`/video/${video.id}`} className="gap-1.5">
              <FileText className="size-4" />
              Ver resumo
            </Link>
          </Button>
          <Button asChild variant="secondary">
            <Link href={`/video/${video.id}?tab=mindmap`} className="gap-1.5">
              <Network className="size-4" />
              Mapa mental
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
