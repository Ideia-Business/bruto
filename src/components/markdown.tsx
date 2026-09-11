"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { ChevronRight } from "lucide-react";

/**
 * Esquema de sanitização: o padrão do rehype MAIS `details`/`summary`.
 *
 * POR QUE ISTO EXISTE: `allowHtml` liga o `rehypeRaw`, que renderiza HTML cru.
 * Ele foi ligado para um motivo legítimo — o prompt da Aula pede blocos
 * `<details>` para esconder as respostas do teste de fixação. O problema é a
 * premissa que estava escrita aqui: "conteúdo é sempre local, seguro". **Não é.**
 * O texto vem de um modelo de linguagem alimentado pela transcrição de um vídeo
 * de terceiro — conteúdo que ninguém desta casa escreveu nem revisou. Uma
 * transcrição preparada pode induzir o modelo a devolver `<iframe srcdoc=…>`, e
 * aí há script rodando no mesmo origin das rotas que apagam e editam.
 *
 * `rehypeRaw` interpreta o HTML e `rehypeSanitize` PODA o que não está na lista —
 * nesta ordem, sempre. Invertida, a poda aconteceria antes de o HTML existir.
 */
const ESQUEMA = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "details", "summary"],
  attributes: {
    ...defaultSchema.attributes,
    // `open` é o único atributo que o <details> precisa. Nada de `on*`, nada
    // de `style`, nada de `srcdoc`.
    details: ["open"],
    summary: [],
  },
};

/**
 * Renderiza markdown como PROSA DE LEITURA (serif, 18px/1.7, coluna estreita).
 * É o coração do produto — resumo e aula devem se ler sem fadiga.
 * `allowHtml` habilita os <details> da fixação, já sanitizados.
 */
export function Markdown({
  children,
  allowHtml = false,
}: {
  children: string;
  allowHtml?: boolean;
}) {
  return (
    <div className="prose-custom space-y-4 font-reading text-[1.125rem] leading-[1.7] text-foreground">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={allowHtml ? [rehypeRaw, [rehypeSanitize, ESQUEMA]] : []}
        components={{
          h1: (p) => <h1 className="mt-2 mb-3 font-heading text-3xl font-semibold" {...p} />,
          h2: (p) => (
            <h2
              className="mt-10 mb-3 border-b border-border pb-2 font-heading text-2xl font-semibold"
              {...p}
            />
          ),
          h3: (p) => <h3 className="mt-6 mb-2 font-heading text-xl font-semibold" {...p} />,
          p: (p) => <p {...p} />,
          ul: (p) => <ul className="list-disc space-y-2 pl-6" {...p} />,
          ol: (p) => <ol className="list-decimal space-y-2 pl-6" {...p} />,
          li: (p) => <li {...p} />,
          strong: (p) => <strong className="font-semibold" {...p} />,
          em: (p) => <em className="italic" {...p} />,
          a: (p) => (
            <a
              className="text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary"
              {...p}
            />
          ),
          blockquote: (p) => (
            <blockquote className="border-l-[3px] border-primary/40 pl-4 text-muted-foreground" {...p} />
          ),
          code: (p) => (
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.9em]" {...p} />
          ),
          details: (p) => (
            <details
              className="group/d my-4 rounded-lg border border-border bg-muted/60 px-4 py-3 open:bg-accent/40"
              {...p}
            />
          ),
          summary: (p) => (
            <summary className="flex cursor-pointer list-none items-center gap-2 font-sans text-[0.95rem] font-semibold text-foreground [&::-webkit-details-marker]:hidden">
              <ChevronRight className="size-4 shrink-0 text-primary transition-transform duration-200 group-open/d:rotate-90" />
              {p.children}
            </summary>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
