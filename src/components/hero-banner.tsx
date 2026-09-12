"use client";

import Link from "next/link";
import { FileText, Network } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Thumb } from "./thumb";
import { formatDuration } from "@/lib/format";
import type { BrutoCard } from "@/lib/api-types";

/**
 * Destaque calmo "Continue de onde parou": card claro com thumbnail nítida ao
 * lado (nunca atrás do texto), sem gradiente nem altura de tela cheia.
 */
export function HeroBanner({ video }: { video: BrutoCard }) {
  return (
    <section className="flex flex-col gap-5 rounded-xl border border-border bg-card p-5 shadow-xs sm:flex-row sm:items-center sm:p-6">
      <Link
        href={`/video/${video.id}`}
        className="relative block aspect-video w-full shrink-0 overflow-hidden rounded-lg border border-border sm:w-72"
      >
        <Thumb videoId={video.id} alt={video.title} className="h-full w-full object-cover" />
      </Link>
      <div className="min-w-0 space-y-3">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Continue de onde parou
        </p>
        <h1 className="font-heading text-2xl font-semibold leading-tight text-foreground">
          {video.title}
        </h1>
        <p className="text-sm text-muted-foreground">
          {video.channel}
          {video.durationSec ? ` · ${formatDuration(video.durationSec)}` : ""}
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button asChild size="sm">
            <Link href={`/video/${video.id}`} className="gap-1.5">
              <FileText className="size-4" />
              Ver resumo
            </Link>
          </Button>
          <Button asChild size="sm" variant="secondary">
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
