#!/bin/bash
# Bruto — construtor do pacote macOS: Bruto.app autocontido + .dmg (demanda
# 5f4e7484). Especificação: contrato do instalador (contrato-instalador.md),
# seção "Build". Compatível com bash 3.2 (o do macOS).
#
# O que faz, na ordem: baixa os binários PINADOS (scripts/instalador-macos/
# binarios.json, cache em ~/.cache/bruto-instalador, hash conferido antes de
# tudo — INVARIANTE P4), roda npm ci + next build com o NODE PINADO (é para o
# ABI dele que o better-sqlite3 é compilado), monta o .app, assina ad-hoc cada
# Mach-O e o bundle, prova que NADA liga em /opt/homebrew ou /usr/local
# (INVARIANTE P1) e gera o .dmg com o hash ao lado.
#
# Sem sudo. Não toca no ~/.bruto real (só dist/ e o cache). No fim, devolve o
# node_modules ao Node da máquina, se o pinado for outro (a lane de
# desenvolvimento continua intacta — INVARIANTE P2).

set -euo pipefail

PASTA="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"          # scripts/instalador-macos
RAIZ="$(cd "$PASTA/../.." && pwd)"                              # repo
CACHE="${BRUTO_INSTALADOR_CACHE:-$HOME/.cache/bruto-instalador}"
DIST="$RAIZ/dist"
WORK="$DIST/build"
BINARIOS="$PASTA/binarios.json"

# Nomes dos arquivos no cache — precisam bater com o campo "arquivo" do
# binarios.json (a consistência é conferida no loop de download).
NODE_TGZ="node-v26.13.0-darwin-arm64.tar.gz"
UV_TGZ="uv-aarch64-apple-darwin.tar.gz"
FFMPEG_ZIP="ffmpeg.zip"
FFPROBE_ZIP="ffprobe.zip"

etapa() { printf -- '→ %s\n' "$1"; }
ok() { printf '  ✓\n'; }
linha() { printf '  · %s\n' "$1"; }
falha() {
  # falha "<motivo>" "<o que fazer>"
  printf '  ✗ %s — %s\n' "$1" "$2" >&2
  exit 1
}

sha256_de() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    openssl dgst -sha256 -r "$1" | awk '{print $1}'
  fi
}

# baixar_pinado <url> <sha256> <arquivo-no-cache>
# INVARIANTE P4: baixa para .tmp, confere o hash e SÓ então publica. Hash
# errado → o arquivo baixado é apagado e nada é montado. Cache válido → nem
# baixa de novo.
baixar_pinado() {
  local url="$1" soma="$2" destino="$3" medido
  if [ -f "$destino" ]; then
    medido="$(sha256_de "$destino")"
    if [ "$medido" = "$soma" ]; then
      linha "em cache: $(basename "$destino")"
      return 0
    fi
    linha "cache inválido (hash não confere), baixando de novo: $(basename "$destino")"
    rm -f "$destino"
  fi
  mkdir -p "$(dirname "$destino")"
  if ! curl -fL --retry 3 -o "${destino}.tmp" "$url"; then
    rm -f "${destino}.tmp"
    return 1
  fi
  medido="$(sha256_de "${destino}.tmp")"
  if [ "$medido" != "$soma" ]; then
    rm -f "${destino}.tmp"
    printf '  ✗ SHA-256 de %s não confere (mediu %s, esperado %s) — download descartado\n' \
      "$(basename "$destino")" "$medido" "$soma" >&2
    return 1
  fi
  mv "${destino}.tmp" "$destino"
}

# "nome|url|sha256|arquivo" por linha, na ordem do JSON.
listar_binarios() {
  python3 - "$BINARIOS" <<'PY'
import json, sys
dados = json.load(open(sys.argv[1]))
for nome, info in dados.items():
    print(f"{nome}|{info['url']}|{info['sha256']}|{info['arquivo']}")
PY
}

# Ícone: rasteriza launcher/icon.svg (qlmanage nativo; se o QuickLook não
# estiver disponível no contexto, usa o Chromium do Playwright do projeto — a
# mesma técnica do launcher/install-app.sh) e monta o .icns com sips+iconutil.
gerar_icns() { # $1 = destino (…/Resources/icon.icns), $2 = WORK
  local destino="$1" work="$2" iconset png gen
  iconset="$work/Bruto.iconset"
  png="$work/icon-1024.png"
  rm -rf "$iconset"
  mkdir -p "$iconset"

  if qlmanage -t -s 1024 -o "$work" "$RAIZ/launcher/icon.svg" >/dev/null 2>&1 && [ -f "$work/icon.svg.png" ]; then
    mv "$work/icon.svg.png" "$png"
  else
    linha "qlmanage indisponível aqui — rasterizando com o Chromium do Playwright do projeto"
    gen="$work/_icone.mjs"
    cat >"$gen" <<'NODE'
import { chromium } from "playwright";
import fs from "node:fs";
const [svgPath, outPath] = process.argv.slice(2);
const svg = fs.readFileSync(svgPath, "utf8");
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1024, height: 1024 } });
await p.setContent("<!doctype html><html><body style=\"margin:0\">" + svg + "</body></html>", { waitUntil: "load" });
await p.locator("svg").screenshot({ path: outPath, omitBackground: true });
await b.close();
NODE
    ( cd "$RAIZ" && node "$gen" "$RAIZ/launcher/icon.svg" "$png" ) || return 1
  fi
  [ -f "$png" ] || return 1
  sips -z 16 16   "$png" --out "$iconset/icon_16x16.png" >/dev/null || return 1
  sips -z 32 32   "$png" --out "$iconset/icon_16x16@2x.png" >/dev/null || return 1
  sips -z 32 32   "$png" --out "$iconset/icon_32x32.png" >/dev/null || return 1
  sips -z 64 64   "$png" --out "$iconset/icon_32x32@2x.png" >/dev/null || return 1
  sips -z 128 128 "$png" --out "$iconset/icon_128x128.png" >/dev/null || return 1
  sips -z 256 256 "$png" --out "$iconset/icon_128x128@2x.png" >/dev/null || return 1
  sips -z 256 256 "$png" --out "$iconset/icon_256x256.png" >/dev/null || return 1
  sips -z 512 512 "$png" --out "$iconset/icon_256x256@2x.png" >/dev/null || return 1
  sips -z 512 512 "$png" --out "$iconset/icon_512x512.png" >/dev/null || return 1
  cp "$png" "$iconset/icon_512x512@2x.png"
  iconutil -c icns "$iconset" -o "$destino"
}

bruto_construir() {
  local ferramenta versao lista nome url soma arquivo
  local node_dir uv_dir appb recursos dmg dmgroot prova_db
  local orig_node orig_versao pidado_versao

  [ "$(uname -s)" = "Darwin" ] || falha "sistema não suportado: $(uname -s)" "o pacote é construído em macOS (Apple Silicon)"
  [ "$(uname -m)" = "arm64" ] || falha "arquitetura não suportada: $(uname -m)" "a v1 do pacote é para Apple Silicon (arm64)"
  for ferramenta in curl python3 hdiutil codesign otool file sips iconutil plutil unzip; do
    command -v "$ferramenta" >/dev/null 2>&1 || falha "$ferramenta não encontrado" "instale as Command Line Tools do Xcode (xcode-select --install) e rode de novo"
  done
  [ -f "$BINARIOS" ] || falha "binarios.json não encontrado" "confira scripts/instalador-macos/binarios.json"

  etapa "Versão"
  versao="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$RAIZ/package.json" | head -n 1)"
  [ -n "$versao" ] || falha "versão não encontrada no package.json" "confira o campo \"version\""
  linha "Bruto $versao → dist/Bruto-$versao-arm64.dmg"
  ok

  etapa "Binários pinados (cache em $CACHE)"
  mkdir -p "$CACHE"
  lista="$(listar_binarios)" || falha "não consegui ler o binarios.json" "confira o JSON e o python3"
  [ -n "$lista" ] || falha "binarios.json vazio" "pinie os binários (node, uv, ffmpeg, ffprobe) com URL e SHA-256"
  printf '%s\n' "$lista" | {
    achei_node=0
    while IFS='|' read -r nome url soma arquivo; do
      [ -n "$nome" ] || continue
      linha "$nome ← $(basename "$url")"
      baixar_pinado "$url" "$soma" "$CACHE/$arquivo" \
        || falha "download de $nome falhou (ou hash não confere)" "confira rede/URL/SHA-256 em scripts/instalador-macos/binarios.json e rode de novo"
      [ "$arquivo" = "$NODE_TGZ" ] && achei_node=1
    done
    [ "$achei_node" -eq 1 ] || falha "o binarios.json não pinou o Node ($NODE_TGZ)" "todo o build é feito com o Node pinado; confira o campo \"arquivo\""
  }
  ok

  etapa "Preparando os binários"
  rm -rf "$WORK"
  mkdir -p "$WORK"
  node_dir="$WORK/${NODE_TGZ%.tar.gz}"
  uv_dir="$WORK/${UV_TGZ%.tar.gz}"
  tar -xzf "$CACHE/$NODE_TGZ" -C "$WORK"
  tar -xzf "$CACHE/$UV_TGZ" -C "$WORK"
  unzip -q "$CACHE/$FFMPEG_ZIP" -d "$WORK"
  unzip -q "$CACHE/$FFPROBE_ZIP" -d "$WORK"
  chmod +x "$node_dir/bin/node" "$uv_dir/uv" "$WORK/ffmpeg" "$WORK/ffprobe"
  [ -x "$node_dir/bin/node" ] || falha "node do pacote não extraiu" "apague o cache ($CACHE/$NODE_TGZ) e rode de novo"
  [ -x "$uv_dir/uv" ] || falha "uv do pacote não extraiu" "apague o cache ($CACHE/$UV_TGZ) e rode de novo"
  [ -x "$WORK/ffmpeg" ] && [ -x "$WORK/ffprobe" ] || falha "ffmpeg/ffprobe não extraíram" "apague o cache ($CACHE/$FFMPEG_ZIP e $FFPROBE_ZIP) e rode de novo"
  linha "Node $("$node_dir/bin/node" -v) · $("$WORK/ffmpeg" -version 2>/dev/null | head -n 1 | cut -c1-60)…"
  ok

  # Node pinado na frente do PATH: npm ci e next build rodam com ELE (o
  # better-sqlite3 é compilado para o ABI dele — é esse binário que viaja no
  # pacote). O Node da máquina é lembrado para restaurar a lane no fim.
  orig_node="$(command -v node || true)"
  orig_versao=""
  [ -n "$orig_node" ] && orig_versao="$("$orig_node" -v 2>/dev/null || true)"
  export PATH="$node_dir/bin:$PATH"
  # node-gyp (o better-sqlite3 compila da fonte — a versão não publica
  # prebuilds): o cache de headers vem para o cache do instalador, não para
  # ~/Library/Caches do usuário. Build reproduzível e sem escrever fora de
  # dist/ + ~/.cache/bruto-instalador.
  export npm_config_devdir="$CACHE/node-gyp"

  etapa "Dependências (npm ci com o Node pinado)"
  ( cd "$RAIZ" && npm ci --no-audit --no-fund ) || falha "npm ci falhou" "veja o erro acima; apagar node_modules e rodar de novo pode ajudar"
  ok

  # O addon do better-sqlite3 chega como PREBUILD N-API dentro do próprio
  # pacote (prebuilds/darwin-arm64.node — vale para qualquer ABI de Node
  # moderno). A prova real é carregar com o Node PINADO; a compilação só
  # aconteceria se não houvesse prebuild.
  ( cd "$RAIZ" && "$node_dir/bin/node" -e 'const D=require("better-sqlite3"); new D(":memory:").close()' ) \
    || falha "o better-sqlite3 não carrega com o Node pinado" "veja o erro acima (prebuild ausente? rode o build de novo)"

  etapa "Build standalone (next build com BRUTO_BUILD_STANDALONE=1)"
  ( cd "$RAIZ" && BRUTO_BUILD_STANDALONE=1 npm run build ) || falha "next build falhou" "veja o erro acima"
  [ -f "$RAIZ/.next/standalone/server.js" ] || falha ".next/standalone/server.js não existe" "o build não gerou saída standalone; confira next.config.ts e a variável BRUTO_BUILD_STANDALONE"
  ok

  etapa "Montando o Bruto.app"
  appb="$DIST/Bruto.app"
  recursos="$appb/Contents/Resources"
  rm -rf "$appb"
  mkdir -p "$appb/Contents/MacOS" "$recursos/bin" "$recursos/LICENSES"

  cp "$PASTA/Bruto" "$appb/Contents/MacOS/Bruto"
  chmod 755 "$appb/Contents/MacOS/Bruto"
  sed -e "s/@VERSAO@/$versao/g" "$PASTA/Info.plist" >"$appb/Contents/Info.plist"
  cp "$node_dir/bin/node" "$recursos/node"
  chmod 755 "$recursos/node"
  cp "$WORK/ffmpeg" "$recursos/bin/ffmpeg"
  cp "$WORK/ffprobe" "$recursos/bin/ffprobe"
  cp "$uv_dir/uv" "$recursos/bin/uv"
  chmod 755 "$recursos/bin/ffmpeg" "$recursos/bin/ffprobe" "$recursos/bin/uv"

  # app = saída standalone + static + public + drizzle (contrato, "Layout").
  cp -R "$RAIZ/.next/standalone" "$recursos/app"
  rm -rf "$recursos/app/.next/static"
  cp -R "$RAIZ/.next/static" "$recursos/app/.next/static"
  cp -R "$RAIZ/public" "$recursos/app/public"
  cp -R "$RAIZ/drizzle" "$recursos/app/drizzle"

  # A CLI do playwright (BRUTO_PLAYWRIGHT_CLI) tem de FUNCIONAR no pacote —
  # é por ela que o app instala o Chromium no primeiro export. O tracing pega
  # os .js mas escapa de dados carregados dinamicamente (browsers.json): se o
  # teste falhar, entra a cópia inteira (playwright + playwright-core).
  if ! "$recursos/node" "$recursos/app/node_modules/playwright/cli.js" --version >/dev/null 2>&1; then
    linha "copiando playwright e playwright-core inteiros (a CLI quebrou com o tracing)"
    rm -rf "$recursos/app/node_modules/playwright" "$recursos/app/node_modules/playwright-core"
    cp -R "$RAIZ/node_modules/playwright" "$recursos/app/node_modules/playwright"
    cp -R "$RAIZ/node_modules/playwright-core" "$recursos/app/node_modules/playwright-core"
  fi
  "$recursos/node" "$recursos/app/node_modules/playwright/cli.js" --version >/dev/null 2>&1 \
    || falha "a CLI do playwright não roda com o node do pacote" "confira node_modules/playwright e playwright-core no repo e rode o build de novo"
  # Prebuilds do better-sqlite3: o binding.gyp é "type none" quando há prebuild
  # — o require resolve prebuilds/<plataforma>-<arch>.node em tempo de execução,
  # caminho dinâmico que o tracing pode não incluir. Sem isto, o pacote quebraria
  # na máquina limpa (INVARIANTE P1).
  if [ -d "$RAIZ/node_modules/better-sqlite3/prebuilds" ] \
    && [ ! -f "$recursos/app/node_modules/better-sqlite3/prebuilds/darwin-arm64.node" ]; then
    linha "copiando os prebuilds do better-sqlite3 (o tracing não os incluiu)"
    mkdir -p "$recursos/app/node_modules/better-sqlite3"
    cp -R "$RAIZ/node_modules/better-sqlite3/prebuilds" "$recursos/app/node_modules/better-sqlite3/prebuilds"
  fi

  # Host da extensão: o wrapper do pacote define BRUTO_LANCADOR; a cópia em
  # launcher/ existe porque o registrar-host.sh (reaproveitado sem edição)
  # registra <pasta-dele>/../launcher/host-nativo.sh.
  cp "$RAIZ/launcher/host-nativo.mjs" "$recursos/host-nativo.mjs"
  cp "$PASTA/host-nativo.sh" "$recursos/host-nativo.sh"
  chmod 755 "$recursos/host-nativo.sh"
  mkdir -p "$recursos/launcher"
  cp "$PASTA/host-nativo.sh" "$recursos/launcher/host-nativo.sh"
  chmod 755 "$recursos/launcher/host-nativo.sh"
  cp "$RAIZ/launcher/registrar-host.sh" "$recursos/registrar-host.sh"
  chmod 755 "$recursos/registrar-host.sh"

  # Licenças (contrato: LICENSES/ com node, ffmpeg+fonte, uv, yt-dlp).
  cp "$node_dir/LICENSE" "$recursos/LICENSES/node.txt"
  printf 'FFmpeg 9.0.2 + ffprobe (build estático para macOS arm64)\nFonte: https://ffmpeg.martin-riedl.de/ (release 9.0.2, https://ffmpeg.martin-riedl.de/download/macos/arm64/1789931890_9.0.2/)\nLicença: o FFmpeg é LGPL-2.1+; este build habilita x264/x265/LAME (GPL), o que torna o binário efetivamente GPL. Código-fonte: https://ffmpeg.org/download.html e script de build em https://git.martin-riedl.de/ffmpeg/build-script\n' >"$recursos/LICENSES/ffmpeg.txt"
  printf 'uv 0.13.7 (Rust) — astral.sh\nFonte: https://github.com/astral-sh/uv/releases/tag/0.13.7\nLicença: MIT OR Apache-2.0 (https://github.com/astral-sh/uv/blob/main/LICENSE-MIT e …/LICENSE-APACHE)\n' >"$recursos/LICENSES/uv.txt"
  printf 'yt-dlp (instalado pelo uv no primeiro uso do app, não acompanha o pacote)\nFonte: https://github.com/yt-dlp/yt-dlp\nLicença: Unlicense (https://github.com/yt-dlp/yt-dlp/blob/master/LICENSE)\n' >"$recursos/LICENSES/yt-dlp.txt"
  ok

  etapa "Ícone (icon.icns a partir de launcher/icon.svg)"
  if gerar_icns "$recursos/icon.icns" "$WORK"; then
    linha "icon.icns gerado com qlmanage/sips + iconutil (nada de binário de ícone no repo)"
  else
    linha "ícone não gerado — o app sai com o ícone padrão (enfeite; rode de novo com o Chromium do Playwright instalado)"
  fi

  etapa "Assinatura ad-hoc (cada Mach-O + bundle)"
  local assinar
  if [ -n "${BRUTO_DEVELOPER_ID:-}" ]; then
    assinar=(codesign --force --options runtime --timestamp --sign "$BRUTO_DEVELOPER_ID")
  else
    assinar=(codesign --force --sign -)
  fi
  while IFS= read -r arq; do
    file "$arq" | grep -q "Mach-O" || continue
    "${assinar[@]}" "$arq" >/dev/null 2>&1 || falha "codesign falhou em $arq" "veja o erro rodando: codesign --force --sign - $arq"
  done < <(find "$appb" -type f -print)
  "${assinar[@]}" "$appb" >/dev/null 2>&1 || falha "codesign falhou no bundle" "rode manualmente: codesign --force --sign - \"$appb\""
  ok

  etapa "Prova P1 — nada do pacote depende da máquina que o construiu"
  # 1) nenhum Mach-O liga em /opt/homebrew ou /usr/local
  while IFS= read -r arq; do
    file "$arq" | grep -q "Mach-O" || continue
    if otool -L "$arq" 2>/dev/null | grep -E -q '/opt/homebrew|/usr/local'; then
      otool -L "$arq" >&2 || true
      falha "$arq liga em /opt/homebrew ou /usr/local" "dependência da máquina de build vazou; confira serverExternalPackages e o tracing no next.config.ts"
    fi
  done < <(find "$appb" -type f -print)
  # 2) o lançador não cita /opt/homebrew
  if grep -q '/opt/homebrew' "$appb/Contents/MacOS/Bruto"; then
    falha "o lançador cita /opt/homebrew" "remova a referência — o pacote é autocontido"
  fi
  # 3) o better-sqlite3 do pacote carrega com o node do pacote (banco em pasta temporária)
  prova_db="$WORK/prova-better-sqlite3.db"
  rm -f "$prova_db"
  "$recursos/node" -e 'const D=require(process.argv[1]);const db=new D(process.argv[2]);db.exec("create table prova(x)");db.prepare("insert into prova values (?)").run(42);db.close();console.log("better-sqlite3 ok")' \
    "$recursos/app/node_modules/better-sqlite3" "$prova_db" \
    || falha "o better-sqlite3 do pacote não carregou com o node do pacote" "o addon foi compilado para outro ABI; apague node_modules e rode este build de novo"
  rm -f "$prova_db"
  ok

  etapa "Gerando o .dmg (com atalho para /Applications)"
  dmg="$DIST/Bruto-$versao-arm64.dmg"
  rm -f "$dmg" "$dmg.sha256"
  dmgroot="$WORK/dmg"
  rm -rf "$dmgroot"
  mkdir -p "$dmgroot"
  cp -R "$appb" "$dmgroot/Bruto.app"
  ln -s /Applications "$dmgroot/Applications"
  # hdiutil precisa criar/montar imagem de disco: em ambiente SANDBOXADO
  # (agente de build) isso é negado com EPERM. Nada de contorno: o script usa
  # o caminho canônico e, se falhar por isso, avisa e NÃO pula a restauração
  # da lane abaixo — o exit non-zero vem no fim.
  if hdiutil create -volname Bruto -srcfolder "$dmgroot" -ov -format UDZO "$dmg" >/dev/null 2>&1; then
    sha256_de "$dmg" >"$dmg.sha256"
    ok
  else
    linha "hdiutil create falhou (neste ambiente de sandbox a criação de imagem de disco é negada — EPERM)"
    linha "o Bruto.app pronto, assinado e provado está em $appb; o .dmg sai rodando este script em máquina sem sandbox"
    DMG_FALHOU=1
  fi

  if [ -f "$dmg" ] && [ -n "${BRUTO_DEVELOPER_ID:-}" ] && [ -n "${BRUTO_NOTARY_PROFILE:-}" ]; then
    etapa "Developer ID + notarização"
    codesign --force --options runtime --timestamp --sign "$BRUTO_DEVELOPER_ID" "$dmg" \
      || falha "codesign do .dmg falhou" "confira o certificado $BRUTO_DEVELOPER_ID"
    xcrun notarytool submit "$dmg" --keychain-profile "$BRUTO_NOTARY_PROFILE" --wait \
      || falha "notarização falhou" "veja o erro do notarytool acima"
    xcrun stapler staple "$dmg" || falha "staple falhou" "rode xcrun stapler staple \"$dmg\" manualmente"
    ok
  else
    linha "Developer ID + notarização: puladas (defina BRUTO_DEVELOPER_ID e BRUTO_NOTARY_PROFILE para ligar) — assinatura ad-hoc aplicada"
  fi

  # A lane de desenvolvimento continua no Node da máquina (INVARIANTE P2): se
  # o pinado for outro, o node_modules volta ao ABI de quem rodou o build.
  pidado_versao="$("$node_dir/bin/node" -v)"
  if [ -n "$orig_node" ] && [ "$orig_versao" != "$pidado_versao" ]; then
    etapa "Restaurando o node_modules do ambiente (Node $orig_versao)"
    ( cd "$RAIZ" && PATH="$(dirname "$orig_node"):$PATH" npm ci --no-audit --no-fund ) \
      || falha "npm ci de restauração falhou" "rode \"npm ci\" manualmente com o seu Node antes de usar o repo"
    ok
  fi

  etapa "Resumo"
  linha "Bruto.app: $(du -sh "$appb" | awk '{print $1}')"
  if [ -f "$dmg" ]; then
    linha "dmg: $(du -sh "$dmg" | awk '{print $1}') ($dmg)"
    linha "sha256: $(cat "$dmg.sha256")"
  fi
  ok
  if [ "${DMG_FALHOU:-0}" -eq 1 ]; then
    printf '  ✗ o .dmg não foi gerado neste ambiente (hdiutil bloqueado pelo sandbox) — rode o script numa máquina sem sandbox; o .app está pronto em %s\n' "$appb" >&2
    exit 1
  fi
  printf '✅ dist/Bruto-%s-arm64.dmg (+ .sha256)\n' "$versao"
}

# Fonteável (os testes chamam baixar_pinado); só constrói quando executado.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  bruto_construir "$@"
fi
