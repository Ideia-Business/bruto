"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatDuration } from "@/lib/format";
import type { BrutoCard } from "@/lib/api-types";

/** Busca ⌘K no catálogo (título/canal). */
export function SearchCommand() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<BrutoCard[]>([]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      // Limpa o resultado anterior quando a busca esvazia. Agendado num microtask
      // para não ser um setState SÍNCRONO dentro do efeito, que dispara renders
      // em cascata (react-hooks/set-state-in-effect).
      queueMicrotask(() => setResults([]));
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/videos?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        setResults(data.results ?? []);
      } catch {
        setResults([]);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [query]);

  const go = useCallback(
    (id: string) => {
      setOpen(false);
      setQuery("");
      router.push(`/video/${id}`);
    },
    [router],
  );

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-md border border-border bg-card/60 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-white/20 hover:text-foreground"
      >
        <span>Buscar…</span>
        <kbd className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium">⌘K</kbd>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="overflow-hidden p-0" showCloseButton={false}>
          <DialogHeader className="sr-only">
            <DialogTitle>Buscar vídeos</DialogTitle>
          </DialogHeader>
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Buscar por título ou canal…"
              value={query}
              onValueChange={setQuery}
            />
            <CommandList>
              <CommandEmpty>
                {query.trim() ? "Nenhum vídeo encontrado." : "Digite para buscar."}
              </CommandEmpty>
              {results.length > 0 && (
                <CommandGroup heading="Vídeos">
                  {results.map((v) => (
                    <CommandItem key={v.id} value={v.id} onSelect={() => go(v.id)}>
                      <div className="flex w-full items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate">{v.title}</p>
                          {v.channel && (
                            <p className="truncate text-xs text-muted-foreground">{v.channel}</p>
                          )}
                        </div>
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                          {formatDuration(v.durationSec)}
                        </span>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}
