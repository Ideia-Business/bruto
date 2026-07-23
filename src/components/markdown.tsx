"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Renderiza markdown com estilos tipográficos consistentes (resumo). */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="prose-custom max-w-none space-y-3 text-sm leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: (p) => <h1 className="mt-6 text-2xl font-bold" {...p} />,
          h2: (p) => (
            <h2 className="mt-6 border-b border-border/60 pb-1 text-lg font-bold" {...p} />
          ),
          h3: (p) => <h3 className="mt-4 text-base font-semibold" {...p} />,
          p: (p) => <p className="text-foreground/90" {...p} />,
          ul: (p) => <ul className="list-disc space-y-1.5 pl-5" {...p} />,
          ol: (p) => <ol className="list-decimal space-y-1.5 pl-5" {...p} />,
          li: (p) => <li className="text-foreground/90" {...p} />,
          strong: (p) => <strong className="font-semibold text-foreground" {...p} />,
          a: (p) => <a className="text-primary underline" {...p} />,
          code: (p) => (
            <code className="rounded bg-muted px-1 py-0.5 text-xs" {...p} />
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
