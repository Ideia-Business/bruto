#!/bin/bash
# Bruto — launcher local (macOS e Linux).
# Garante o servidor de produção rodando em http://localhost:3000 e abre o app
# em uma janela dedicada do navegador (cara de aplicativo, sem barra de
# navegação). Chamado pelo atalho (Bruto.app / bruto.desktop); também roda
# direto no terminal.

set -u
# Atalhos (macOS e .desktop) não herdam o PATH do shell interativo — e é onde
# vivem brew, os shims do `uv tool` (yt-dlp, whisper) e o Node do Homebrew no
# macOS. $HOME/.local/bin vem PRIMEIRO: se o sistema também tem uma versão
# antiga de algo (ex.: yt-dlp de pacote da distro), a instalada pelo `uv tool`
# tem que ganhar, nunca a de /usr/bin.
# ~/.local/bin primeiro: os shims do `uv tool` (yt-dlp, whisper) vencem as
# cópias antigas do Homebrew ou da distro. O Node não entra nessa disputa: é
# escolhido pela versão em launcher/_node.sh.
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

# Raiz do projeto = diretório pai deste script. Funciona em qualquer clone,
# de qualquer usuário, sem edição.
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=_node.sh
. "$APP_DIR/launcher/_node.sh"
if ! bruto_escolher_node; then
  MSG="O Bruto não abriu: falta o Node.js 20 ou mais novo. Rode o instalador de novo."
  echo "$MSG"
  if command -v notify-send >/dev/null 2>&1; then notify-send "Bruto" "$MSG" 2>/dev/null || true
  elif command -v osascript >/dev/null 2>&1; then osascript -e "display notification \"$MSG\" with title \"Bruto\"" 2>/dev/null || true; fi
  exit 1
fi
PORT="${BRUTO_PORT:-3000}"
URL="http://localhost:${PORT}"
LOG="${TMPDIR:-/tmp}/bruto-server.log"
COMMIT_ARQUIVO=".next/.bruto-build-commit"

cd "$APP_DIR" || { echo "Projeto não encontrado em $APP_DIR"; exit 1; }

is_up() { curl -s -o /dev/null --max-time 2 "$URL"; }

commit_atual() { git rev-parse HEAD 2>/dev/null || echo ""; }

precisa_build() {
  # Sem build ainda.
  [ -d ".next" ] || return 0
  [ -f ".next/BUILD_ID" ] || return 0
  # Build de outro commit (ou sem marcador — build feito fora do instalador).
  if [ ! -f "$COMMIT_ARQUIVO" ]; then
    return 0
  fi
  local build_commit head_commit
  build_commit="$(cat "$COMMIT_ARQUIVO" 2>/dev/null || echo "")"
  head_commit="$(commit_atual)"
  [ -n "$head_commit" ] && [ "$build_commit" != "$head_commit" ]
}

if ! is_up; then
  if precisa_build; then
    echo "$(date) — build (código mudou desde o último build)…" >>"$LOG"
    if npm run build >>"$LOG" 2>&1; then
      commit_atual > "$COMMIT_ARQUIVO" 2>/dev/null || true
    else
      echo "$(date) — build falhou" >>"$LOG"
      echo "Build falhou — veja $LOG"
      # Aberto por atalho não há terminal: sem este aviso, o clique não faz
      # nada e ninguém sabe por quê (achado do Grok, 25/09).
      MSG="O Bruto não abriu: o build falhou. Detalhes em $LOG"
      if command -v notify-send >/dev/null 2>&1; then
        notify-send "Bruto" "$MSG" 2>/dev/null || true
      elif command -v osascript >/dev/null 2>&1; then
        osascript -e "display notification \"$MSG\" with title \"Bruto\"" 2>/dev/null || true
      fi
      exit 1
    fi
  fi
  echo "$(date) — iniciando servidor…" >>"$LOG"
  # Inicia o servidor destacado do launcher (sobrevive ao fechar o app).
  nohup npm run start -- -p "$PORT" >>"$LOG" 2>&1 &
  # Aguarda ficar pronto (até ~40s no primeiro boot).
  for _ in $(seq 1 80); do
    is_up && break
    sleep 0.5
  done
fi

# Abre em janela de app (Chrome/Chromium/Edge). Fallback: navegador padrão.
SO="$(uname -s)"
if [ "$SO" = "Darwin" ]; then
  if [ -d "/Applications/Google Chrome.app" ]; then
    open -na "Google Chrome" --args --app="$URL" --new-window
  else
    open "$URL"
  fi
else
  NAVEGADOR=""
  for cand in google-chrome chromium chromium-browser microsoft-edge; do
    if command -v "$cand" >/dev/null 2>&1; then
      NAVEGADOR="$cand"
      break
    fi
  done
  if [ -n "$NAVEGADOR" ]; then
    nohup "$NAVEGADOR" --app="$URL" --new-window >/dev/null 2>&1 &
  elif command -v xdg-open >/dev/null 2>&1; then
    nohup xdg-open "$URL" >/dev/null 2>&1 &
  else
    echo "Nenhum navegador encontrado — abra manualmente: $URL"
  fi
fi
