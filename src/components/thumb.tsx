"use client";

import { useState } from "react";
import { Play } from "lucide-react";

/**
 * Thumbnail offline-first: busca a imagem local (a rota /api/media resolve o
 * fallback do YouTube quando aplicável). Em erro, mostra um placeholder sóbrio.
 */
export function Thumb({
  videoId,
  alt,
  className,
}: {
  videoId: string;
  alt: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div
        className={`flex items-center justify-center bg-muted text-muted-foreground ${className ?? ""}`}
      >
        <Play className="size-6" />
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/api/media/${videoId}/thumb`}
      alt={alt}
      loading="lazy"
      className={className}
      onError={() => setFailed(true)}
    />
  );
}
