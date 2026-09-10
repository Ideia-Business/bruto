"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus, GraduationCap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SearchCommand } from "./search-command";
import { UrlInputDialog } from "./url-input-dialog";

/** Header claro e sóbrio: wordmark + navegação + busca + "Novo vídeo". */
export function SiteHeader() {
  const pathname = usePathname();
  const navItem = (href: string, label: string) => {
    const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
    return (
      <Link
        href={href}
        className={
          active
            ? "font-medium text-foreground underline decoration-primary decoration-2 underline-offset-[6px]"
            : "text-muted-foreground transition-colors hover:text-foreground"
        }
      >
        {label}
      </Link>
    );
  };

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2">
          <GraduationCap className="size-5 text-primary" />
          <span className="font-heading text-lg font-semibold tracking-tight">Bruto</span>
        </Link>
        <nav className="hidden gap-5 text-[0.95rem] md:flex">
          {navItem("/", "Catálogo")}
          {navItem("/processing", "Processando")}
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
