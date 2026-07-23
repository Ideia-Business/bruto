"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";

/**
 * Renderiza markdown com estilos tipográficos consistentes.
 * `allowHtml` habilita HTML embutido (usado na aula "Estudar" para os
 * <details> das perguntas de fixação). O conteúdo é sempre gerado localmente
 * pelo Claude — não há entrada de terceiros, então é seguro.
 */
export function Markdown({
  children,
  allowHtml = false,
}: {
  children: string;
  allowHtml?: boolean;
}) {
  return (
    <div className="prose-custom max-w-none space-y-3 text-sm leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={allowHtml ? [rehypeRaw] : []}
        components={{
          h1: (p) => <h1 className="mt-2 mb-2 text-2xl font-black" {...p} />,
          h2: (p) => (
            <h2 className="mt-6 border-b border-border/60 pb-1 text-lg font-bold" {...p} />
          ),
          h3: (p) => <h3 className="mt-4 text-base font-semibold text-foreground" {...p} />,
          p: (p) => <p className="text-foreground/90" {...p} />,
          ul: (p) => <ul className="list-disc space-y-1.5 pl-5" {...p} />,
          ol: (p) => <ol className="list-decimal space-y-1.5 pl-5" {...p} />,
          li: (p) => <li className="text-foreground/90" {...p} />,
          strong: (p) => <strong className="font-semibold text-foreground" {...p} />,
          em: (p) => <em className="italic" {...p} />,
          a: (p) => <a className="text-primary underline" {...p} />,
          blockquote: (p) => (
            <blockquote className="border-l-2 border-primary/50 pl-3 text-foreground/80 italic" {...p} />
          ),
          code: (p) => <code className="rounded bg-muted px-1 py-0.5 text-xs" {...p} />,
          details: (p) => (
            <details
              className="my-2 rounded-md border border-border bg-card/50 px-3 py-2 [&[open]]:bg-card"
              {...p}
            />
          ),
          summary: (p) => (
            <summary className="cursor-pointer select-none text-sm font-medium text-primary marker:text-primary" {...p} />
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
