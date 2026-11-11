"use client";

import { useEffect, useState } from "react";

interface Atualizacao {
  nova: string | null;
  url: string | null;
}

/**
 * Aviso discreto de versão nova (só modo pacote — em clone a rota devolve
 * silêncio e nada renderiza). Sem rede, sem release ou rota falhando: o
 * componente fica vazio, nunca erro na tela (decisão do dono, contrato do
 * instalador: "sem atualização silenciosa", só aviso com link).
 */
export function AvisoVersao() {
  const [atualizacao, setAtualizacao] = useState<Atualizacao | null>(null);

  useEffect(() => {
    let cancelado = false;
    fetch("/api/versao/atualizacao")
      .then((res) => (res.ok ? res.json() : null))
      .then((dados: Atualizacao | null) => {
        if (!cancelado && dados?.nova && dados.url) setAtualizacao(dados);
      })
      .catch(() => {
        // silêncio — o aviso é conveniência, nunca motivo de erro na tela
      });
    return () => {
      cancelado = true;
    };
  }, []);

  if (!atualizacao?.nova || !atualizacao.url) return null;

  return (
    <a
      href={atualizacao.url}
      target="_blank"
      rel="noreferrer"
      className="hidden rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground sm:inline"
    >
      Nova versão {atualizacao.nova} disponível
    </a>
  );
}
