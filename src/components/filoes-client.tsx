"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { Layers, Pencil, Plus, Trash2, Check, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { FilaoRow } from "@/lib/api-types";
import { fetchApp } from "@/lib/fetch-app";

/**
 * O painel de filões: cria, renomeia, apaga e leva para dentro de cada um.
 * Estado local otimista com refetch — o servidor é a verdade, mas quem digita
 * não deve esperar o round-trip para ver o que fez.
 */
export function FiloesClient({ initial }: { initial: FilaoRow[] }) {
  const [rows, setRows] = useState<FilaoRow[]>(initial);
  const [novo, setNovo] = useState("");
  const [criando, setCriando] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState("");

  const refetch = useCallback(async () => {
    try {
      const res = await fetchApp("/api/filoes");
      const data = (await res.json()) as { filoes: FilaoRow[] };
      setRows(data.filoes);
    } catch {
      /* silencioso — a próxima ação cobre */
    }
  }, []);

  const criar = useCallback(async () => {
    const name = novo.trim();
    if (!name || criando) return;
    setCriando(true);
    try {
      const res = await fetchApp("/api/filoes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const { error } = (await res.json()) as { error?: string };
        toast.error(error ?? "Não deu para criar o filão.");
        return;
      }
      setNovo("");
      await refetch();
    } catch {
      toast.error("Não deu para criar o filão. Tente de novo.");
    } finally {
      setCriando(false);
    }
  }, [novo, criando, refetch]);

  const renomear = useCallback(
    async (id: string) => {
      const name = rascunho.trim();
      if (!name) return;
      setEditando(null);
      setRows((r) => r.map((x) => (x.filao.id === id ? { ...x, filao: { ...x.filao, name } } : x)));
      try {
        await fetchApp(`/api/filoes/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
      } catch {
        toast.error("O nome não foi salvo.");
        await refetch();
      }
    },
    [rascunho, refetch],
  );

  const apagar = useCallback(
    async (id: string, name: string, count: number) => {
      const aviso =
        count > 0
          ? `Apagar o filão "${name}"? Os ${count} brutos continuam na sua biblioteca — só deixam de estar agrupados aqui.`
          : `Apagar o filão "${name}"?`;
      if (!confirm(aviso)) return;
      setRows((r) => r.filter((x) => x.filao.id !== id));
      try {
        await fetchApp(`/api/filoes/${id}`, { method: "DELETE" });
      } catch {
        toast.error("O filão não foi apagado.");
        await refetch();
      }
    },
    [refetch],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Filões</h1>
          <p className="text-sm text-muted-foreground">
            Junte os brutos por assunto. Um bruto pode estar em vários filões.
          </p>
        </div>
      </div>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void criar();
        }}
      >
        <Input
          id="novo-filao"
          value={novo}
          onChange={(e) => setNovo(e.target.value)}
          placeholder="Nome do filão — ex.: Supabase do zero"
          maxLength={80}
          className="max-w-sm"
        />
        <Button type="submit" disabled={!novo.trim() || criando} className="gap-1.5">
          <Plus className="size-4" />
          Criar filão
        </Button>
      </form>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-16 text-center">
          <Layers className="size-7 text-muted-foreground" />
          <div>
            <h2 className="text-lg font-semibold">Nenhum filão ainda</h2>
            <p className="max-w-sm text-sm text-muted-foreground">
              Um filão é o veio que você volta a cavar: junte aqui tudo que destrinchou
              sobre o mesmo assunto.
            </p>
          </div>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map(({ filao, count }) => (
            <li
              key={filao.id}
              className="group flex items-center gap-2 border border-border bg-card p-4"
            >
              {editando === filao.id ? (
                <>
                  <Input
                    id={`filao-${filao.id}`}
                    autoFocus
                    value={rascunho}
                    maxLength={80}
                    onChange={(e) => setRascunho(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void renomear(filao.id);
                      if (e.key === "Escape") setEditando(null);
                    }}
                    className="h-8"
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-8 shrink-0"
                    aria-label="Salvar nome"
                    onClick={() => void renomear(filao.id)}
                  >
                    <Check className="size-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-8 shrink-0"
                    aria-label="Cancelar"
                    onClick={() => setEditando(null)}
                  >
                    <X className="size-4" />
                  </Button>
                </>
              ) : (
                <>
                  <Link href={`/filao/${filao.slug}`} className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{filao.name}</span>
                    <span className="text-sm tabular-nums text-muted-foreground">
                      {count === 0 ? "vazio" : count === 1 ? "1 bruto" : `${count} brutos`}
                    </span>
                  </Link>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-8 shrink-0 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                    aria-label={`Renomear ${filao.name}`}
                    onClick={() => {
                      setEditando(filao.id);
                      setRascunho(filao.name);
                    }}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-8 shrink-0 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                    aria-label={`Apagar ${filao.name}`}
                    onClick={() => void apagar(filao.id, filao.name, count)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
