"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import { criarFilaSerial } from "@/lib/fila-serial";

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

  // Espelha `marcadas` para leitura DEPOIS de um `await` — sem isto,
  // `criarEIncluir` (que faz `await` no POST de criar a tag antes de compor o
  // conjunto final) usava o `marcadas` capturado no início da chamada: se a
  // pessoa clicasse noutra tag ENQUANTO o POST estava em voo, esse clique
  // intermediário era perdido quando `criarEIncluir` sobrescrevia com o
  // conjunto (desatualizado) que tinha em mãos.
  const marcadasRef = useRef(marcadas);
  useEffect(() => {
    marcadasRef.current = marcadas;
  }, [marcadas]);

  // Fila serial de TODA operação de rede deste picker (leituras E escritas) —
  // nunca duas em voo ao mesmo tempo. Cobre dois achados:
  //  1) marcar A e depois B rapidamente disparava PUT{A} e PUT{A,B} em
  //     paralelo; se a rede entregasse o PUT{A} DEPOIS do PUT{A,B} (fora de
  //     ordem), o banco ficava em {A} enquanto a UI (otimista) mostrava {A,B}
  //     (achado do Codex, 5ª rodada).
  //  2) fechar e reabrir o diálogo enquanto um PUT ainda estava na fila
  //     disparava um `carregar()` (GET) direto, sem fila — a resposta podia
  //     chegar ANTES do servidor processar o PUT pendente, e `carregar`
  //     sobrescrevia `marcadas` com dado desatualizado (achado do Codex, 6ª
  //     rodada). Botar `carregar` na MESMA fila garante que ele só roda depois
  //     de qualquer escrita anterior já ter sido despachada e respondida —
  //     um contador de geração sozinho não bastaria aqui, porque o PUT pode
  //     nem ter SIDO ENVIADO ainda quando o GET dispara; só a fila garante a
  //     ORDEM DE DESPACHO, não só a ordem de quem foi chamado por último.
  //
  // A fila em si (`criarFilaSerial`) vive em `src/lib/fila-serial.ts`, fora do
  // componente — é lá que o achado 1 da 7ª rodada (deadlock por
  // auto-referência) está documentado e testado sem precisar de React.
  const filaRef = useRef(criarFilaSerial());

  // O trabalho de verdade de "carregar", SEM passar pela fila — só para quem
  // JÁ ESTÁ rodando dentro de um item da fila (a recuperação de erro do
  // `salvar`, logo abaixo). Nunca chame isto de fora da fila diretamente;
  // para o caso normal (abrir o diálogo) use `carregar()`.
  const carregarAgora = useCallback(async () => {
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

  const carregar = useCallback((): Promise<void> => filaRef.current.enfileirar(carregarAgora), [carregarAgora]);

  const mudarAbertura = useCallback(
    (proximo: boolean) => {
      setAberto(proximo);
      if (proximo) void carregar();
    },
    [carregar],
  );

  const salvar = useCallback(
    (proximo: Set<string>): Promise<void> => {
      setMarcadas(proximo);
      return filaRef.current.enfileirar(async () => {
        try {
          const res = await fetchApp(`/api/videos/${videoId}/tags`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tagIds: [...proximo] }),
          });
          if (!res.ok) throw new Error("falhou");
        } catch {
          toast.error("A mudança não foi salva.");
          // REGRESSÃO (achado 1, Codex + Grok, 7ª rodada): jamais chame
          // `carregar()` (que reenfileira) AQUI DENTRO — esta função já É a
          // tarefa que a fila está esperando terminar; reenfileirar a
          // recuperação nela mesma é o deadlock por auto-referência
          // documentado em `src/lib/fila-serial.ts`. `carregarAgora()` faz o
          // mesmo trabalho SEM reentrar na fila — seguro aqui porque já
          // estamos DENTRO do item da fila que está rodando agora.
          await carregarAgora();
        }
      });
    },
    [videoId, carregarAgora],
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
      // Lê o estado ATUAL (via ref), não o `marcadas` capturado antes do
      // `await` acima — ver o comentário na declaração de `marcadasRef`.
      const proximo = new Set(marcadasRef.current);
      proximo.add(tag.id);
      await salvar(proximo);
      await carregar();
    } catch {
      toast.error("Não deu para criar a tag.");
    }
  }, [nova, salvar, carregar]);

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
