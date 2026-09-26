"use client";

import { useCallback, useState } from "react";
import { Tag as TagIcon, Plus, Check } from "lucide-react";
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
import type { TagRow } from "@/lib/api-types";
import { fetchApp } from "@/lib/fetch-app";

/**
 * Escolhe as tags de assunto deste bruto — mesmo desenho do `FilaoPicker`
 * (manda o conjunto inteiro no PUT, o servidor resolve o delta). A IA sugere
 * no passo 05; aqui a pessoa corrige.
 */
export function TagPicker({ videoId }: { videoId: string }) {
  const [aberto, setAberto] = useState(false);
  const [rows, setRows] = useState<TagRow[]>([]);
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [nova, setNova] = useState("");
  const [carregando, setCarregando] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const [tRes, vRes] = await Promise.all([
        fetchApp("/api/tags"),
        fetchApp(`/api/videos/${videoId}/tags`),
      ]);
      const t = (await tRes.json()) as { tags: TagRow[] };
      const v = (await vRes.json()) as { tagIds: string[] };
      setRows(t.tags);
      setMarcadas(new Set(v.tagIds));
    } catch {
      toast.error("Não deu para carregar suas tags.");
    } finally {
      setCarregando(false);
    }
  }, [videoId]);

  const mudarAbertura = useCallback(
    (proximo: boolean) => {
      setAberto(proximo);
      if (proximo) void carregar();
    },
    [carregar],
  );

  const salvar = useCallback(
    async (proximo: Set<string>) => {
      setMarcadas(proximo);
      try {
        const res = await fetchApp(`/api/videos/${videoId}/tags`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tagIds: [...proximo] }),
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
      const proximo = new Set(marcadas);
      if (proximo.has(id)) proximo.delete(id);
      else proximo.add(id);
      void salvar(proximo);
    },
    [marcadas, salvar],
  );

  const criarEIncluir = useCallback(async () => {
    const name = nova.trim();
    if (!name) return;
    try {
      const res = await fetchApp("/api/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const { error } = (await res.json()) as { error?: string };
        toast.error(error ?? "Não deu para criar a tag.");
        return;
      }
      const { tag } = (await res.json()) as { tag: { id: string } };
      setNova("");
      const proximo = new Set(marcadas);
      proximo.add(tag.id);
      await salvar(proximo);
      await carregar();
    } catch {
      toast.error("Não deu para criar a tag.");
    }
  }, [nova, marcadas, salvar, carregar]);

  return (
    <Dialog open={aberto} onOpenChange={mudarAbertura}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary" className="h-7 gap-1.5 border border-border text-xs">
          <TagIcon className="size-3.5" />
          Tags
          {marcadas.size > 0 && (
            <span className="tabular-nums text-muted-foreground">{marcadas.size}</span>
          )}
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Quais tags de assunto este bruto tem?</DialogTitle>
          <DialogDescription>
            Pode ter várias. A IA sugere ao processar; aqui você corrige.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-64 space-y-1 overflow-y-auto">
          {carregando && rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Carregando…</p>
          ) : rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nenhuma tag ainda. Crie a primeira abaixo.
            </p>
          ) : (
            rows.map(({ tag, count }) => {
              const ativo = marcadas.has(tag.id);
              return (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => alternar(tag.id)}
                  aria-pressed={ativo}
                  className={
                    "flex w-full items-center gap-2 border px-3 py-2 text-left text-sm transition-colors " +
                    (ativo ? "border-primary bg-secondary" : "border-border hover:bg-muted")
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
                  <span className="min-w-0 flex-1 truncate">{tag.name}</span>
                  <span className="shrink-0 tabular-nums text-xs text-muted-foreground">{count}</span>
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
            id={`nova-tag-${videoId}`}
            value={nova}
            maxLength={40}
            onChange={(e) => setNova(e.target.value)}
            placeholder="Criar uma tag nova"
            className="h-9"
          />
          <Button type="submit" size="sm" disabled={!nova.trim()} className="gap-1.5">
            <Plus className="size-4" />
            Criar
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
