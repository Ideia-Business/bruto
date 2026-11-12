"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FolderOpen, FolderCheck, FolderX, RotateCw, Download, CheckCircle2, PowerOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { fetchApp } from "@/lib/fetch-app";
import { sincronizarExportacoesPendentes } from "@/lib/exportar-artefatos";
import { secoesDasConfiguracoes, type EstadoWhisper } from "@/lib/secoes-configuracoes";
import {
  autoExportarAtivado,
  definirAutoExportar,
  esquecerPastaEscolhida,
  escolherPasta,
  obterPastaSalva,
  pedirPermissao,
  permissaoAtual,
  suportaPastaLocal,
} from "@/lib/pasta-exportacao";

type EstadoPasta =
  | { tipo: "carregando" }
  | { tipo: "sem-pasta" }
  | { tipo: "ok"; nome: string }
  | { tipo: "permissao-pendente"; nome: string };

/**
 * Tela de configurações do app — seções INDEPENDENTES (a decisão de quais
 * aparecem é a função pura `secoesDasConfiguracoes`): pasta de exportação +
 * exportar automaticamente, a transcrição local (Whisper) no app instalado e
 * o Encerrar o Bruto (sempre). Um navegador sem a API de pasta
 * (Safari/Firefox) troca só a exportação pelo aviso — o Whisper continua
 * visível, porque a instalação dele roda no servidor. A extensão do Chrome
 * tem sua própria `options.html`.
 */
export function ConfiguracoesClient() {
  const [suportado, setSuportado] = useState(true);
  const [estado, setEstado] = useState<EstadoPasta>({ tipo: "carregando" });
  const [autoExportar, setAutoExportarState] = useState(false);
  const [processando, setProcessando] = useState(false);
  const [whisper, setWhisper] = useState<EstadoWhisper | null>(null);
  const [instalandoWhisper, setInstalandoWhisper] = useState(false);

  useEffect(() => {
    let cancelado = false;
    async function carregar() {
      setSuportado(suportaPastaLocal());
      setAutoExportarState(autoExportarAtivado());
      // A seção do Whisper só existe no app instalado (.app) — pergunta a
      // origem e, só se for pacote, o estado da instalação.
      try {
        const resVersao = await fetch("/api/versao");
        if (resVersao.ok) {
          const versao = (await resVersao.json()) as { origem?: string };
          if (versao.origem === "pacote") {
            const resWhisper = await fetch("/api/ferramentas/whisper");
            if (resWhisper.ok) {
              const estadoWhisper = (await resWhisper.json()) as {
                suportado: boolean;
                instalado: boolean;
              };
              if (!cancelado) setWhisper(estadoWhisper);
            }
          }
        }
      } catch {
        // Sem a rota, a seção simplesmente não aparece.
      }
      const handle = await obterPastaSalva();
      if (cancelado) return;
      if (!handle) {
        setEstado({ tipo: "sem-pasta" });
        return;
      }
      const permissao = await permissaoAtual(handle);
      if (cancelado) return;
      setEstado(
        permissao === "granted"
          ? { tipo: "ok", nome: handle.name }
          : { tipo: "permissao-pendente", nome: handle.name },
      );
    }
    void carregar();
    return () => {
      cancelado = true;
    };
  }, []);

  async function escolher() {
    setProcessando(true);
    try {
      const handle = await escolherPasta();
      if (!handle) return; // cancelado no seletor do sistema
      setEstado({ tipo: "ok", nome: handle.name });
      toast.success(`Pasta "${handle.name}" escolhida.`);
      // Se já existem vídeos concluídos sem marca de exportado (a pessoa
      // ligou a pasta depois de já ter usado o app), tenta pegar a fila
      // pendente agora — sem esperar a próxima navegação ou o timer.
      void sincronizarExportacoesPendentes();
    } catch {
      toast.error("Não foi possível acessar essa pasta.");
    } finally {
      setProcessando(false);
    }
  }

  async function reconceder() {
    setProcessando(true);
    try {
      const handle = await obterPastaSalva();
      if (!handle) {
        setEstado({ tipo: "sem-pasta" });
        return;
      }
      const permissao = await pedirPermissao(handle);
      if (permissao === "granted") {
        setEstado({ tipo: "ok", nome: handle.name });
        toast.success("Permissão concedida de novo.");
        void sincronizarExportacoesPendentes();
      } else {
        toast.error("Permissão negada — a exportação automática continua pausada.");
      }
    } finally {
      setProcessando(false);
    }
  }

  async function esquecer() {
    await esquecerPastaEscolhida();
    setEstado({ tipo: "sem-pasta" });
    // Sem pasta, o interruptor ligado só faria os próximos vídeos "não exportarem"
    // em silêncio (a função já trata "nunca configurado" como condição prévia, sem
    // aviso). Aqui a pasta EXISTIA e foi removida — desligar evita essa confusão.
    alternarAutoExportar(false);
  }

  function alternarAutoExportar(ativo: boolean) {
    setAutoExportarState(ativo);
    definirAutoExportar(ativo);
    // Ligou agora: se já houver vídeo done parado (de antes de existir a
    // pasta), tenta exportar na hora — não espera a pessoa navegar.
    if (ativo) void sincronizarExportacoesPendentes();
  }

  async function instalarWhisper() {
    setInstalandoWhisper(true);
    try {
      const res = await fetchApp("/api/ferramentas/whisper", { method: "POST" });
      if (!res.ok) {
        const corpo = (await res.json().catch(() => null)) as { error?: string } | null;
        toast.error(corpo?.error ?? "Não foi possível instalar a transcrição local.");
        return;
      }
      setWhisper({ suportado: true, instalado: true });
      toast.success("Transcrição local instalada. Vídeos sem legenda já podem ser processados.");
    } catch {
      toast.error("Não foi possível instalar a transcrição local. Verifique a internet.");
    } finally {
      setInstalandoWhisper(false);
    }
  }

  // Quais seções aparecem — decisão pura e testada: a falta da API de pasta
  // restringe SÓ a exportação; o Whisper é independente (instala no servidor).
  const secoes = secoesDasConfiguracoes({ suportaPasta: suportado, whisper });

  return (
    <div className="space-y-6">
      {secoes.exportacao === "aviso-navegador" ? (
        <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
          A exportação para uma pasta do computador só funciona no Chrome (ou outro navegador
          baseado em Chromium) — Safari e Firefox não oferecem essa permissão. Sem problema:
          seus vídeos continuam salvos normalmente na biblioteca do Bruto.
        </div>
      ) : (
        <>
          <section className="space-y-4 rounded-lg border border-border bg-card p-4">
            <div>
              <h2 className="font-semibold">Pasta de exportação</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Escolha uma pasta no seu computador para receber uma cópia dos arquivos gerados
                (resumo, transcrição, mapa mental…) sempre que um vídeo terminar de processar. É
                sempre uma cópia — o original continua guardado na biblioteca do Bruto.
              </p>
            </div>

            {estado.tipo === "carregando" && (
              <p className="text-sm text-muted-foreground">Verificando…</p>
            )}

            {estado.tipo === "sem-pasta" && (
              <Button onClick={escolher} disabled={processando} className="gap-1.5">
                <FolderOpen className="size-4" />
                Escolher pasta
              </Button>
            )}

            {estado.tipo === "ok" && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-muted/40 px-3 py-2">
                <p className="flex items-center gap-2 text-sm">
                  <FolderCheck className="size-4 text-emerald-500" />
                  <span className="font-medium">{estado.nome}</span>
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={escolher} disabled={processando}>
                    Trocar
                  </Button>
                  <Button variant="ghost" size="sm" onClick={esquecer} disabled={processando}>
                    Remover
                  </Button>
                </div>
              </div>
            )}

            {estado.tipo === "permissao-pendente" && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                <p className="flex items-center gap-2 text-sm">
                  <FolderX className="size-4 text-amber-500" />
                  <span>
                    <span className="font-medium">{estado.nome}</span> — a permissão expirou ou o
                    navegador reiniciou.
                  </span>
                </p>
                <div className="flex gap-2">
                  <Button size="sm" onClick={reconceder} disabled={processando} className="gap-1.5">
                    <RotateCw className="size-3.5" />
                    Reconceder acesso
                  </Button>
                  <Button variant="ghost" size="sm" onClick={esquecer} disabled={processando}>
                    Remover
                  </Button>
                </div>
              </div>
            )}
          </section>

          <section className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card p-4">
            <div>
              <h2 className="font-semibold">Exportar automaticamente</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Quando ligado, copia os artefatos de cada vídeo concluído para a pasta acima assim
                que o processamento termina, sem precisar pedir de novo.
              </p>
            </div>
            <Switch
              checked={autoExportar}
              onCheckedChange={alternarAutoExportar}
              disabled={estado.tipo !== "ok"}
              aria-label="Exportar automaticamente"
            />
          </section>
        </>
      )}

      {secoes.whisper && whisper && (
        <section className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card p-4">
          <div>
            <h2 className="font-semibold">Transcrição local (Whisper)</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              É o que permite destrinchar vídeo sem legenda (Instagram, TikTok). A instalação
              baixa cerca de 2 GB de modelo e dependências, uma única vez, e roda toda no seu
              computador.
            </p>
          </div>
          {whisper.instalado ? (
            <p className="flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground">
              <CheckCircle2 className="size-4 text-emerald-500" />
              Instalado
            </p>
          ) : (
            <Button
              onClick={instalarWhisper}
              disabled={instalandoWhisper}
              variant="outline"
              className="shrink-0 gap-1.5"
            >
              <Download className="size-4" />
              {instalandoWhisper ? "Instalando… (pode levar alguns minutos)" : "Instalar (~2 GB)"}
            </Button>
          )}
        </section>
      )}

      {secoes.encerrar && <SecaoEncerrar />}
    </div>
  );
}

/**
 * "Encerrar o Bruto" — desliga o servidor do próprio app e libera a porta (o
 * ⌘Q fecha só a janela; ADR 0005). Confirmação embutida (nada de confirm()),
 * aviso próprio quando há vídeos processando (409 → "Encerrar mesmo assim") e
 * estado final "pode fechar esta janela" depois do 202.
 */
type FaseEncerrar = "disponivel" | "confirmando" | "avisar-ativos" | "enviando" | "encerrado" | "erro";

function SecaoEncerrar() {
  const [fase, setFase] = useState<FaseEncerrar>("disponivel");
  const [ativos, setAtivos] = useState(0);
  const [erro, setErro] = useState("");

  async function encerrar(corpo: Record<string, unknown>): Promise<void> {
    setFase("enviando");
    try {
      const res = await fetchApp("/api/encerrar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
      });
      if (res.status === 202) {
        setFase("encerrado");
        return;
      }
      const dados = (await res.json().catch(() => null)) as
        | { code?: string; ativos?: number; error?: string }
        | null;
      if (res.status === 409 && dados?.code === "processamento-em-andamento") {
        setAtivos(dados.ativos ?? 0);
        setFase("avisar-ativos");
        return;
      }
      setErro(dados?.error ?? "Não foi possível encerrar o Bruto agora.");
      setFase("erro");
    } catch {
      setErro("Não foi possível falar com o servidor do Bruto.");
      setFase("erro");
    }
  }

  if (fase === "encerrado") {
    return (
      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="font-semibold">Encerrar o Bruto</h2>
        <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
          <CheckCircle2 className="size-4 text-emerald-500" />
          O Bruto foi encerrado. Pode fechar esta janela.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-4">
      <div>
        <h2 className="font-semibold">Encerrar o Bruto</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Desliga o Bruto neste Mac; para abrir de novo, use o Bruto em Aplicativos. (Fechar a
          janela com ⌘Q não desliga — o servidor continua rodando.)
        </p>
      </div>

      {fase === "disponivel" && (
        <Button variant="outline" onClick={() => setFase("confirmando")} className="gap-1.5">
          <PowerOff className="size-4" />
          Encerrar o Bruto
        </Button>
      )}

      {fase === "confirmando" && (
        <div className="space-y-3 rounded-md border border-border bg-muted/40 px-3 py-3">
          <p className="text-sm">
            O servidor do Bruto vai parar neste Mac. Vídeos que estiverem processando retomam
            quando você abrir o Bruto de novo.
          </p>
          <div className="flex gap-2">
            <Button variant="destructive" size="sm" onClick={() => void encerrar({})}>
              Encerrar agora
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setFase("disponivel")}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {fase === "avisar-ativos" && (
        <div className="space-y-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-3">
          <p className="text-sm">
            {ativos === 1
              ? "Há 1 vídeo sendo processado agora."
              : `Há ${ativos} vídeos sendo processados agora.`}{" "}
            Se encerrar, ele{ativos === 1 ? "" : "s"} para{ativos === 1 ? "" : "m"} e retoma
            {ativos === 1 ? "" : "m"} do ponto onde estava{ativos === 1 ? "" : "vam"} quando você
            abrir o Bruto de novo.
          </p>
          <div className="flex gap-2">
            <Button
              variant="destructive"
              size="sm"
              onClick={() => void encerrar({ confirmar: true })}
            >
              Encerrar mesmo assim
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setFase("disponivel")}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {fase === "enviando" && <p className="text-sm text-muted-foreground">Encerrando…</p>}

      {fase === "erro" && (
        <div className="space-y-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-3">
          <p className="text-sm">{erro}</p>
          <Button variant="ghost" size="sm" onClick={() => setFase("disponivel")}>
            Voltar
          </Button>
        </div>
      )}
    </section>
  );
}
