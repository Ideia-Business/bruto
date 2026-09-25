"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BookOpen, Bot, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Markdown } from "./markdown";
import { CopyButton } from "./copy-button";
import { fetchApp } from "@/lib/fetch-app";

/**
 * Chips de propósito prontos — cada um pré-preenche o campo de texto, editável
 * depois. Selecionar um chip NÃO dispara a geração sozinho: quem tem pressa
 * clica chip → clica Gerar (2 cliques); quem quer precisão, edita o texto que
 * o chip deixou.
 */
const CHIPS_PROPOSITO = [
  { label: "Aprofundar depois", texto: "Quero estudar isso com calma depois — me ajude a aprofundar os pontos principais." },
  { label: "Escrever algo com isso", texto: "Vou usar isso como base para escrever algo — um post, artigo ou roteiro." },
  { label: "Me questionar sobre o conteúdo", texto: "Quero que você me faça perguntas sobre o conteúdo, pra eu testar meu entendimento." },
  { label: "Comparar com outro material", texto: "Vou comparar isso com outro material que tenho — me ajude a achar semelhanças e diferenças quando eu trouxer o outro texto." },
] as const;

type Modo = "humano" | "ia";

export function TranscriptAiTools({
  videoId,
  transcriptOrganizedMd,
  transcriptLlmMd,
}: {
  videoId: string;
  transcriptOrganizedMd: string | null;
  transcriptLlmMd: string | null;
}) {
  const router = useRouter();
  const [modo, setModo] = useState<Modo>("humano");
  const [busy, setBusy] = useState(false);
  const [mostrarFormulario, setMostrarFormulario] = useState(false);
  const [proposito, setProposito] = useState("");

  async function gerarHumano() {
    setBusy(true);
    try {
      const res = await fetchApp(`/api/videos/${videoId}/transcript-organized`, { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(d.error ?? "Não foi possível organizar a transcrição.");
        return;
      }
      toast.success("Transcrição organizada!");
      router.refresh();
    } catch {
      toast.error("Erro de rede ao organizar a transcrição.");
    } finally {
      setBusy(false);
    }
  }

  async function gerarParaIa() {
    setBusy(true);
    try {
      const res = await fetchApp(`/api/videos/${videoId}/transcript-llm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposito }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(d.error ?? "Não foi possível gerar o contexto para IA.");
        return;
      }
      toast.success("Contexto pronto!");
      setMostrarFormulario(false);
      router.refresh();
    } catch {
      toast.error("Erro de rede ao gerar o contexto.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 border-t border-border pt-4">
      <div className="flex items-center gap-1 rounded-md border border-border p-0.5 w-fit">
        <Button
          size="sm"
          variant={modo === "humano" ? "default" : "ghost"}
          onClick={() => setModo("humano")}
          className="h-7 gap-1.5 px-2.5"
        >
          <BookOpen className="size-3.5" /> Organizada pra você
        </Button>
        <Button
          size="sm"
          variant={modo === "ia" ? "default" : "ghost"}
          onClick={() => setModo("ia")}
          className="h-7 gap-1.5 px-2.5"
        >
          <Bot className="size-3.5" /> Pra colar em outra IA
        </Button>
      </div>

      {modo === "humano" ? (
        transcriptOrganizedMd ? (
          <div className="space-y-3">
            <div className="mx-auto flex max-w-[42rem] items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                Transcrição completa, reorganizada por assunto — nada foi cortado.
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={busy} onClick={gerarHumano} className="gap-1.5">
                  <RefreshCw className="size-3.5" /> Refazer
                </Button>
                <CopyButton text={transcriptOrganizedMd} label="Copiar" />
              </div>
            </div>
            <article className="mx-auto max-w-[42rem]">
              <Markdown>{transcriptOrganizedMd}</Markdown>
            </article>
          </div>
        ) : (
          <EstadoVazio
            icon={<BookOpen className="size-10 text-primary" />}
            titulo="Transcrição organizada por assunto"
            descricao="A fala inteira do vídeo, sem cortar nada — só reorganizada em seções temáticas, pra ler sem pular de assunto em assunto."
            busy={busy}
            busyLabel="Organizando…"
            botaoLabel="Organizar transcrição"
            onClick={gerarHumano}
          />
        )
      ) : transcriptLlmMd && !mostrarFormulario ? (
        <div className="space-y-3">
          <div className="mx-auto flex max-w-[42rem] items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              Pronto pra colar em outra sessão de IA — já vem com um preâmbulo explicando o que é.
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => setMostrarFormulario(true)}
                className="gap-1.5"
              >
                <RefreshCw className="size-3.5" /> Trocar propósito e refazer
              </Button>
              <CopyButton text={transcriptLlmMd} label="Copiar para colar na IA" />
            </div>
          </div>
          <article className="mx-auto max-w-[42rem]">
            <Markdown>{transcriptLlmMd}</Markdown>
          </article>
        </div>
      ) : (
        <div className="mx-auto max-w-[42rem] space-y-4 rounded-xl border border-dashed border-border p-6">
          <div className="space-y-1">
            <h3 className="text-base font-semibold">O que você vai fazer com isso?</h3>
            <p className="text-sm text-muted-foreground">
              Isso ajuda a organizar o texto do jeito certo pra sua IA entender. Nenhuma resposta é
              obrigatória — dá pra gerar sem preencher nada.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {CHIPS_PROPOSITO.map((c) => (
              <button
                key={c.label}
                type="button"
                onClick={() => setProposito(c.texto)}
                className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
              >
                {c.label}
              </button>
            ))}
          </div>
          <Textarea
            value={proposito}
            onChange={(e) => setProposito(e.target.value)}
            placeholder="ou descreva com suas palavras…"
            rows={3}
            maxLength={500}
          />
          <div className="flex gap-2">
            <Button disabled={busy} onClick={gerarParaIa} className="gap-1.5">
              {busy ? (
                <>
                  <RefreshCw className="size-4 animate-spin" /> Gerando…
                </>
              ) : (
                <>
                  <Bot className="size-4" /> Gerar
                </>
              )}
            </Button>
            {transcriptLlmMd && (
              <Button variant="ghost" disabled={busy} onClick={() => setMostrarFormulario(false)}>
                Cancelar
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function EstadoVazio({
  icon,
  titulo,
  descricao,
  busy,
  busyLabel,
  botaoLabel,
  onClick,
}: {
  icon: React.ReactNode;
  titulo: string;
  descricao: string;
  busy: boolean;
  busyLabel: string;
  botaoLabel: string;
  onClick: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-border py-16 text-center">
      {icon}
      <div className="max-w-md space-y-1">
        <h3 className="text-lg font-semibold">{titulo}</h3>
        <p className="text-sm text-muted-foreground">{descricao}</p>
      </div>
      <Button disabled={busy} onClick={onClick} className="gap-1.5">
        {busy ? (
          <>
            <RefreshCw className="size-4 animate-spin" /> {busyLabel}
          </>
        ) : (
          botaoLabel
        )}
      </Button>
      {busy && <p className="text-xs text-muted-foreground">Isso leva cerca de um minuto.</p>}
    </div>
  );
}
