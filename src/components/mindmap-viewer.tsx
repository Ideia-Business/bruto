"use client";

import { useEffect, useRef } from "react";
import { Transformer } from "markmap-lib";
import { Markmap } from "markmap-view";

const transformer = new Transformer();

/**
 * Renderiza o mapa mental (markdown hierárquico) como SVG interativo do markmap
 * — zoom, pan e collapse. Client-only (D3/SVG); a página importa com ssr:false.
 */
export function MindmapViewer({ markdown }: { markdown: string }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const mmRef = useRef<Markmap | null>(null);

  useEffect(() => {
    if (!svgRef.current) return;
    const { root } = transformer.transform(markdown);
    if (!mmRef.current) {
      mmRef.current = Markmap.create(svgRef.current, { autoFit: true, duration: 300 }, root);
    } else {
      mmRef.current.setData(root);
      void mmRef.current.fit();
    }
  }, [markdown]);

  useEffect(() => {
    return () => {
      mmRef.current?.destroy();
      mmRef.current = null;
    };
  }, []);

  return <svg ref={svgRef} className="h-full w-full" />;
}
