#!/bin/bash
# Bruto — launcher local.
# Garante o servidor de produção rodando em http://localhost:3000 e abre o app
# em uma janela dedicada do Chrome (cara de aplicativo, sem barra de navegação).
# Chamado pelo app "Bruto.app"; também pode ser rodado direto no terminal.

set -u
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

# Raiz do projeto = diretório pai deste script. Funciona em qualquer clone,
# de qualquer usuário, sem edição.
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${BRUTO_PORT:-3000}"
URL="http://localhost:${PORT}"
LOG="${TMPDIR:-/tmp}/bruto-server.log"

cd "$APP_DIR" || { echo "Projeto não encontrado em $APP_DIR"; exit 1; }

is_up() { curl -s -o /dev/null --max-time 2 "$URL"; }

if ! is_up; then
  # Primeira vez (ou após mudanças): garante o build de produção.
  if [ ! -d ".next" ] || [ ! -f ".next/BUILD_ID" ]; then
    echo "$(date) — build inicial…" >>"$LOG"
    npm run build >>"$LOG" 2>&1
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

# Abre em janela de app (Chrome). Fallback: navegador padrão.
if [ -d "/Applications/Google Chrome.app" ]; then
  open -na "Google Chrome" --args --app="$URL" --new-window
else
  open "$URL"
fi
