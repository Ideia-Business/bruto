"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { fetchApp } from "@/lib/fetch-app";
import { podeCancelar, precisaConfirmarCancelamento, resumirUrl } from "@/lib/job-status-ui";

/**
 * Botão "Cancelar" de um job ativo — um componente só para os três lugares
 * onde um card ativo aparece (lista /processing, cards da home, detalhe do
 * vídeo), sem cópia tripla.
 *
 * - Na fila: cancela direto. Rodando: confirma EM LINHA no próprio card,
 *   sem modal — "O que já foi gerado fica salvo."
 * - A chave é o job.id (nunca o videoId): dois cards do MESMO vídeo são
 *   dois jobs, e cancelar um não toca o estado do outro.
 * - Requisção em voo = botão desabilitado ("Cancelando…"), sem clique duplo.
 * - 409 (o job terminou no meio do caminho): refetch + toast neutro; erro
 *   de rede: toast de erro e o botão volta ao normal.
 */
export function CancelarJobBotao({
  job,
  onCanceled,
}: {
  job: { id: string; status: string; url: string };
  onCanceled: () => void;
}) {
  const [confirmando, setConfirmando] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const botaoCancelarRef = useRef<HTMLButtonElement>(null);
  const botaoVoltarRef = useRef<HTMLButtonElement>(null);
  const estavaConfirmando = useRef(false);

  // Teclado: o foco entra pelo "Voltar" quando a confirmação abre e devolve
  // ao "Cancelar" quando ela fecha — quem usa TAB nunca cai no vazio.
  useEffect(() => {
    if (confirmando) {
      estavaConfirmando.current = true;
      botaoVoltarRef.current?.focus();
    } else if (estavaConfirmando.current) {
      estavaConfirmando.current = false;
      botaoCancelarRef.current?.focus();
    }
  }, [confirmando]);

  async function cancelar() {
    setCancelando(true);
    try {
      const res = await fetchApp(`/api/jobs/${job.id}/cancel`, { method: "POST" });
      if (res.ok) {
        setConfirmando(false);
        onCanceled();
        return;
      }
      if (res.status === 409) {
        // Terminal é terminal: o job terminou entre o clique e a resposta.
        // O refetch mostra o estado real em vez de deixar a tela mentir.
        setConfirmando(false);
        onCanceled();
        toast.info("Esse processamento já terminou.");
        return;
      }
      const dados = (await res.json().catch(() => ({}))) as { error?: string };
      toast.error(dados.error ?? "Não foi possível cancelar.");
    } catch {
      toast.error("Erro de rede ao cancelar.");
    } finally {
      setCancelando(false);
    }
  }

  function aoClicarCancelar() {
    if (precisaConfirmarCancelamento(job.status)) {
      setConfirmando(true);
      return;
    }
    void cancelar();
  }

  // Job terminou (refetch trouxe status terminal): nada a cancelar aqui.
  if (!podeCancelar(job.status)) return null;

  const urlResumida = resumirUrl(job.url);

  if (confirmando) {
    return (
      <div
        role="group"
        aria-label={`Confirmar cancelamento de ${urlResumida}`}
        className="flex flex-wrap items-center gap-2"
        onKeyDown={(e) => {
          if (cancelando) return;
          if (e.key === "Escape") {
            e.stopPropagation();
            setConfirmando(false);
          } else if (e.key === "Enter") {
            // Enter confirma de qualquer botão focado dentro do grupo — o
            // preventDefault engole o click nativo (ex.: no "Voltar") e
            // chama o cancelamento uma vez só.
            e.preventDefault();
            void cancelar();
          }
        }}
      >
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">
          Cancelar este processamento? O que já foi gerado fica salvo.
        </p>
        <Button
          size="sm"
          variant="destructive"
          disabled={cancelando}
          onClick={() => void cancelar()}
        >
          {cancelando ? "Cancelando…" : "Sim, cancelar"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          ref={botaoVoltarRef}
          disabled={cancelando}
          onClick={() => setConfirmando(false)}
        >
          Voltar
        </Button>
      </div>
    );
  }

  return (
    <Button
      size="sm"
      variant="outline"
      className="h-7 border-border px-2.5 text-xs text-muted-foreground hover:text-destructive"
      disabled={cancelando}
      onClick={aoClicarCancelar}
      aria-label={`Cancelar processamento de ${urlResumida}`}
      ref={botaoCancelarRef}
    >
      {cancelando ? "Cancelando…" : "Cancelar"}
    </Button>
  );
}
