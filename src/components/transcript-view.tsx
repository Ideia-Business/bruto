"use client";

import { useMemo, useState } from "react";
import { Copy, Check, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Visualização da transcrição com toggle de timestamps, busca interna e copiar.
 */
export function TranscriptView({
  plain,
  timestamped,
  translated,
}: {
  plain: string | null;
  timestamped: string | null;
  translated: string | null;
}) {
  const [mode, setMode] = useState<"plain" | "ts" | "pt">(plain ? "plain" : "ts");
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState(false);

  const text = mode === "ts" ? timestamped : mode === "pt" ? translated : plain;

  const filtered = useMemo(() => {
    if (!text) return "";
    if (!query.trim()) return text;
    return text
      .split("\n")
      .filter((l) => l.toLowerCase().includes(query.toLowerCase()))
      .join("\n");
  }, [text, query]);

  async function copy() {
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border border-border p-0.5">
          {plain && (
            <ModeBtn active={mode === "plain"} onClick={() => setMode("plain")}>
              Texto
            </ModeBtn>
          )}
          {timestamped && (
            <ModeBtn active={mode === "ts"} onClick={() => setMode("ts")}>
              <Clock className="mr-1 inline size-3" />
              Com tempos
            </ModeBtn>
          )}
          {translated && (
            <ModeBtn active={mode === "pt"} onClick={() => setMode("pt")}>
              🇧🇷 PT-BR
            </ModeBtn>
          )}
        </div>
        <Input
          placeholder="Buscar na transcrição…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-8 max-w-xs"
        />
        <Button variant="outline" size="sm" onClick={copy} className="ml-auto gap-1.5">
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Copiado" : "Copiar"}
        </Button>
      </div>
      <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-md border border-border bg-card/40 p-4 text-sm leading-relaxed text-foreground/90">
        {filtered || "Nenhuma linha corresponde à busca."}
      </pre>
    </div>
  );
}

function ModeBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}
