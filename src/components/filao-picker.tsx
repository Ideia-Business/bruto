"use client";

import { useCallback, useState } from "react";
import { Layers, Plus, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { FilaoRow } from "@/lib/api-types";
import { fetchApp } from "@/lib/fetch-app";

/**
 * Escolhe em quais filões este bruto está. Manda o conjunto inteiro no PUT —
 * o servidor resolve o que entrou e o que saiu, então clicar rápido em vários
 * não gera estado inconsistente.
 */
export function FilaoPicker({ videoId }: { videoId: string }) {
  const [aberto, setAberto] = useState(false);
  const [rows, setRows] = useState<FilaoRow[]>([]);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [novo, setNovo] = useState("");
  const [carregando, setCarregando] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const [fRes, vRes] = await Promise.all([
        fetchApp("/api/filoes"),
        fetchApp(`/api/videos/${videoId}/filoes`),
      ]);
      const f = (await fRes.json()) as { filoes: FilaoRow[] };
      const v = (await vRes.json()) as { filaoIds: string[] };
      setRows(f.filoes);
      setMarcados(new Set(v.filaoIds));
    } catch {
      toast.error("Não deu para carregar seus filões.");
    } finally {
      setCarregando(false);
    }
  }, [videoId]);

  // Carregar é resposta ao evento de abrir, não sincronização de estado — por
  // isso acontece no onOpenChange, não num efeito.
  const mudarAbertura = useCallback(
    (proximo: boolean) => {
      setAberto(proximo);
      if (proximo) void carregar();
    },
    [carregar],
  );

  const salvar = useCallback(
    async (proximo: Set<string>) => {
      setMarcados(proximo);
      try {
        const res = await fetchApp(`/api/videos/${videoId}/filoes`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filaoIds: [...proximo] }),
        });
        if (!res.ok) throw new Error("falhou");
      } catch {
        toast.error("A mudança não foi salva.");
        await carregar();
      }
    },
    [videoId, carregar],
  );

  const alternar = useCallback(
    (id: string) => {
      const proximo = new Set(marcados);
      if (proximo.has(id)) proximo.delete(id);
      else proximo.add(id);
      void salvar(proximo);
    },
    [marcados, salvar],
  );

  const criarEIncluir = useCallback(async () => {
    const name = novo.trim();
    if (!name) return;
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
      const { filao } = (await res.json()) as { filao: { id: string } };
      setNovo("");
      const proximo = new Set(marcados);
      proximo.add(filao.id);
      await salvar(proximo);
      await carregar();
    } catch {
      toast.error("Não deu para criar o filão.");
    }
  }, [novo, marcados, salvar, carregar]);

  return (
    <Dialog open={aberto} onOpenChange={mudarAbertura}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          variant="secondary"
          className="h-7 gap-1.5 border border-border text-xs"
        >
          <Layers className="size-3.5" />
          Filões
          {marcados.size > 0 && (
            <span className="tabular-nums text-muted-foreground">{marcados.size}</span>
          )}
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Em quais filões este bruto entra?</DialogTitle>
          <DialogDescription>
            Pode estar em vários. Sai do filão sem sumir da sua biblioteca.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-64 space-y-1 overflow-y-auto">
          {carregando && rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Carregando…</p>
          ) : rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Você ainda não tem filões. Crie o primeiro abaixo.
            </p>
          ) : (
            rows.map(({ filao, count }) => {
              const ativo = marcados.has(filao.id);
              return (
                <button
                  key={filao.id}
                  type="button"
                  onClick={() => alternar(filao.id)}
                  aria-pressed={ativo}
                  className={
                    "flex w-full items-center gap-2 border px-3 py-2 text-left text-sm transition-colors " +
                    (ativo
                      ? "border-primary bg-secondary"
                      : "border-border hover:bg-muted")
                  }
                >
                  <span
                    aria-hidden="true"
                    className={
                      "flex size-4 shrink-0 items-center justify-center border " +
                      (ativo ? "border-primary bg-primary text-primary-foreground" : "border-border")
                    }
                  >
                    {ativo && <Check className="size-3" />}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{filao.name}</span>
                  <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
                    {count}
                  </span>
                </button>
              );
            })
          )}
        </div>

        <form
          className="flex gap-2 border-t border-border pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            void criarEIncluir();
          }}
        >
          <Input
            id={`novo-filao-${videoId}`}
            value={novo}
            maxLength={80}
            onChange={(e) => setNovo(e.target.value)}
            placeholder="Criar um filão novo"
            className="h-9"
          />
          <Button type="submit" size="sm" disabled={!novo.trim()} className="gap-1.5">
            <Plus className="size-4" />
            Criar
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
