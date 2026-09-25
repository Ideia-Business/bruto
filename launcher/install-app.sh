#!/bin/bash
# Cria (ou recria) o app "Bruto.app" no ~/Applications, com ícone próprio.
# Depois é só dar duplo-clique — ele sobe o servidor e abre em janela de app.
#
# Uso:  bash launcher/install-app.sh
# Requisitos (já presentes no macOS): sips, iconutil, osacompile. O ícone é
# gerado a partir de launcher/icon.svg usando o Chromium do Playwright do projeto.

set -eu
# Raiz do projeto = diretório pai deste script (funciona em qualquer clone).
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$HOME/Applications/Bruto.app"
WORK="$(mktemp -d)"
GEN_TMP="$APP_DIR/_gen_tmp.$$.mjs"
trap 'rm -rf "$WORK"; rm -f "$GEN_TMP"' EXIT

cd "$APP_DIR"
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:/usr/bin:/bin:$PATH"

echo "→ Gerando ícone…"
cat > "$WORK/_gen.mjs" <<NODE
import { chromium } from 'playwright';
import fs from 'node:fs';
const svg = fs.readFileSync('$APP_DIR/launcher/icon.svg','utf8');
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1024, height: 1024 } });
await p.setContent('<!doctype html><html><body style="margin:0">'+svg+'</body></html>', { waitUntil:'load' });
await p.locator('svg').screenshot({ path: '$WORK/icon-1024.png', omitBackground: true });
await b.close();
NODE
cp "$WORK/_gen.mjs" "$GEN_TMP"
# Ícone é enfeite: sem Chromium do Playwright, o app nasce com o ícone
# padrão do AppleScript em vez de não nascer (achado do Grok, 25/09).
TEM_ICONE=1
if ! node "$GEN_TMP"; then
  TEM_ICONE=0
  echo "⚠️  Não consegui gerar o ícone (Chromium do Playwright ausente?). O app sai com o ícone padrão." >&2
  echo "   Para ter o ícone depois: npx playwright install chromium && bash launcher/install-app.sh" >&2
fi

if [ "$TEM_ICONE" = 1 ]; then
echo "→ Montando ícones (PWA + macOS)…"
SRC="$WORK/icon-1024.png"
sips -z 192 192 "$SRC" --out "$APP_DIR/public/icon-192.png" >/dev/null
sips -z 512 512 "$SRC" --out "$APP_DIR/public/icon-512.png" >/dev/null
sips -z 180 180 "$SRC" --out "$APP_DIR/public/apple-touch-icon.png" >/dev/null

ICONSET="$WORK/RV.iconset"; mkdir -p "$ICONSET"
sips -z 16 16   "$SRC" --out "$ICONSET/icon_16x16.png" >/dev/null
sips -z 32 32   "$SRC" --out "$ICONSET/icon_16x16@2x.png" >/dev/null
sips -z 32 32   "$SRC" --out "$ICONSET/icon_32x32.png" >/dev/null
sips -z 64 64   "$SRC" --out "$ICONSET/icon_32x32@2x.png" >/dev/null
sips -z 128 128 "$SRC" --out "$ICONSET/icon_128x128.png" >/dev/null
sips -z 256 256 "$SRC" --out "$ICONSET/icon_128x128@2x.png" >/dev/null
sips -z 256 256 "$SRC" --out "$ICONSET/icon_256x256.png" >/dev/null
sips -z 512 512 "$SRC" --out "$ICONSET/icon_256x256@2x.png" >/dev/null
sips -z 512 512 "$SRC" --out "$ICONSET/icon_512x512.png" >/dev/null
cp "$SRC" "$ICONSET/icon_512x512@2x.png"
iconutil -c icns "$ICONSET" -o "$WORK/ResumeVideo.icns"
fi

echo "→ Criando o app…"
cat > "$WORK/launcher.applescript" <<OSA
do shell script "/bin/bash '$APP_DIR/launcher/serve.sh' >/tmp/bruto-launch.log 2>&1"
OSA
rm -rf "$DEST"
mkdir -p "$HOME/Applications"
osacompile -o "$DEST" "$WORK/launcher.applescript"
if [ "$TEM_ICONE" = 1 ]; then cp "$WORK/ResumeVideo.icns" "$DEST/Contents/Resources/applet.icns"; fi
touch "$DEST"

echo "✅ Pronto: \"$DEST\""
echo "   Abra o Launchpad (ou ~/Applications) e clique em \"Bruto\"."
