"use client";

import { useState } from "react";

/**
 * Thumbnail com fallback: tenta a rota local (offline-first) e, se falhar,
 * cai para a thumbnail do YouTube. Renderiza um placeholder enquanto/erro.
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
  const [src, setSrc] = useState(`/api/media/${videoId}/thumb`);
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div
        className={`flex items-center justify-center bg-muted text-muted-foreground ${className ?? ""}`}
      >
        <span className="text-2xl">▶</span>
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading="lazy"
      className={className}
      onError={() => {
        if (src.includes("/api/media/")) {
          setSrc(`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`);
        } else {
          setFailed(true);
        }
      }}
    />
  );
}
