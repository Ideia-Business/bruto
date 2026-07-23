"use client";

import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import { VideoCard } from "./video-card";
import type { VideoCard as VideoCardData } from "@/lib/api-types";

/** Uma "row" da Netflix: título da categoria + carrossel horizontal de cards. */
export function CategoryRow({ title, videos }: { title: string; videos: VideoCardData[] }) {
  if (videos.length === 0) return null;
  return (
    <section className="group/row space-y-3">
      <div className="flex items-baseline gap-3 px-1">
        <h2 className="font-heading text-xl font-semibold tracking-tight text-foreground">
          {title}
        </h2>
        <span className="text-sm tabular-nums text-muted-foreground">{videos.length}</span>
      </div>
      <Carousel opts={{ align: "start", dragFree: true, containScroll: "trimSnaps" }}>
        <CarouselContent className="-ml-3">
          {videos.map((v) => (
            <CarouselItem
              key={v.id}
              className="basis-1/2 pl-3 sm:basis-1/3 md:basis-1/4 lg:basis-1/5"
            >
              <VideoCard video={v} />
            </CarouselItem>
          ))}
        </CarouselContent>
        <CarouselPrevious className="left-1 border-border bg-background/90 opacity-0 shadow-sm transition-opacity group-hover/row:opacity-100 disabled:opacity-0" />
        <CarouselNext className="right-1 border-border bg-background/90 opacity-0 shadow-sm transition-opacity group-hover/row:opacity-100 disabled:opacity-0" />
      </Carousel>
    </section>
  );
}
