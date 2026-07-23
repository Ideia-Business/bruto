"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SearchCommand } from "./search-command";
import { UrlInputDialog } from "./url-input-dialog";

/** Header fixo: logo + busca ⌘K + botão "Novo vídeo". */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-bold tracking-tight">
          <span className="text-xl text-primary">▶</span>
          <span className="hidden sm:inline">Resume Video</span>
        </Link>
        <nav className="hidden gap-4 text-sm text-muted-foreground md:flex">
          <Link href="/" className="transition-colors hover:text-foreground">
            Catálogo
          </Link>
          <Link href="/processing" className="transition-colors hover:text-foreground">
            Processando
          </Link>
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <SearchCommand />
          <UrlInputDialog
            trigger={
              <Button size="sm" className="gap-1.5">
                <Plus className="size-4" />
                <span className="hidden sm:inline">Novo vídeo</span>
              </Button>
            }
          />
        </div>
      </div>
    </header>
  );
}
