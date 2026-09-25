#!/bin/bash
# Cria o atalho do Bruto no Linux: entrada no menu de aplicativos
# (~/.local/share/applications/bruto.desktop) e, se existir uma Área de
# Trabalho, uma cópia lá também — marcada como confiável quando o ambiente
# suportar (gio).
#
# Uso: bash launcher/atalho-linux.sh
# Idempotente: rodar de novo recria o .desktop com o caminho atual do clone.

set -eu
export PATH="/usr/local/bin:/usr/bin:/bin:$HOME/.local/bin:$PATH"

# Raiz do projeto = diretório pai deste script (funciona em qualquer clone).
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ICONE="$APP_DIR/public/icon-512.png"

if [ ! -f "$ICONE" ]; then
  echo "→ Ícone ausente em public/icon-512.png — gerando a partir de launcher/icon.svg…"
  WORK="$(mktemp -d)"
  trap 'rm -rf "$WORK"' EXIT
  cat > "$WORK/_gen.mjs" <<NODE
import { chromium } from 'playwright';
import fs from 'node:fs';
const svg = fs.readFileSync('$APP_DIR/launcher/icon.svg', 'utf8');
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 512, height: 512 } });
await p.setContent('<!doctype html><html><body style="margin:0">' + svg + '</body></html>', { waitUntil: 'load' });
await p.locator('svg').screenshot({ path: '$WORK/icon-512.png', omitBackground: true });
await b.close();
NODE
  (cd "$APP_DIR" && node "$WORK/_gen.mjs")
  mkdir -p "$APP_DIR/public"
  cp "$WORK/icon-512.png" "$ICONE"
fi

DEST_DIR="$HOME/.local/share/applications"
DEST="$DEST_DIR/bruto.desktop"
mkdir -p "$DEST_DIR"

echo "→ Criando $DEST"
cat > "$DEST" <<DESKTOP
[Desktop Entry]
Type=Application
Version=1.0
Name=Bruto
Comment=Cole o link de um vídeo e receba resumo, transcrição, mapa mental e aula
Exec=bash "$APP_DIR/launcher/serve.sh"
Icon=$ICONE
Terminal=false
Categories=Education;AudioVideo;
DESKTOP
chmod +x "$DEST"

if command -v gio >/dev/null 2>&1; then
  gio set "$DEST" metadata::trusted true >/dev/null 2>&1 || true
fi

# Cópia na Área de Trabalho, se existir.
DESKTOP_DIR=""
if command -v xdg-user-dir >/dev/null 2>&1; then
  DESKTOP_DIR="$(xdg-user-dir DESKTOP 2>/dev/null || true)"
fi
if [ -n "$DESKTOP_DIR" ] && [ -d "$DESKTOP_DIR" ]; then
  echo "→ Copiando atalho para $DESKTOP_DIR"
  cp "$DEST" "$DESKTOP_DIR/bruto.desktop"
  chmod +x "$DESKTOP_DIR/bruto.desktop"
  if command -v gio >/dev/null 2>&1; then
    gio set "$DESKTOP_DIR/bruto.desktop" metadata::trusted true >/dev/null 2>&1 || true
  fi
fi

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$DEST_DIR" >/dev/null 2>&1 || true
fi

echo "✅ Pronto: \"$DEST\""
echo "   Procure \"Bruto\" no menu de aplicativos."
