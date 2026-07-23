"use client";

import { useMemo, useState } from "react";
import { Clock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { CopyButton } from "./copy-button";

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

  const text = mode === "ts" ? timestamped : mode === "pt" ? translated : plain;

  const filtered = useMemo(() => {
    if (!text) return "";
    if (!query.trim()) return text;
    return text
      .split("\n")
      .filter((l) => l.toLowerCase().includes(query.toLowerCase()))
      .join("\n");
  }, [text, query]);

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
        <CopyButton text={text ?? ""} className="ml-auto" />
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
