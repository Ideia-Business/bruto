#!/bin/bash
# Bruto — instalador (macOS e Linux).
#
# Uso:
#   curl -fsSL https://raw.githubusercontent.com/Ideia-Business/bruto/main/install/instalar.sh | bash
#   bash install/instalar.sh              # de dentro de um clone
#
# Especificação completa: install/CONTRATO.md (este script cumpre ela; quem
# mudar um dos dois, muda o outro). Compatível com bash 3.2 (o do macOS) —
# nada de `declare -A`, `${var,,}`, `mapfile`.

set -euo pipefail
# $HOME/.local/bin PRIMEIRO: é onde `uv tool install` grava os shims
# (yt-dlp, whisper). Se o sistema também tiver uma versão de pacote da
# distro em /usr/bin, a nossa tem que ganhar — nunca a antiga.
# ~/.local/bin primeiro: os shims do `uv tool` (yt-dlp, whisper) vencem as
# cópias antigas do Homebrew ou da distro. O Node não entra nessa disputa: é
# escolhido pela versão em launcher/_node.sh.
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

# Rede de segurança: qualquer falha não tratada explicitamente também avisa
# como retomar, em vez de morrer em silêncio. Comandos usados como condição
# de `if`/`&&`/`||` não disparam este trap — só o inesperado.
trap 'echo >&2; echo "✗ Instalação interrompida por um erro inesperado (linha $LINENO)." >&2; echo "  Rode este instalador de novo — ele é idempotente e retoma de onde parou." >&2' ERR

REPO_URL="https://github.com/Ideia-Business/bruto.git"

# ---------------------------------------------------------------------------
# Saída padronizada
# ---------------------------------------------------------------------------
etapa() { printf -- '→ %s\n' "$1"; }
ok() { printf '  ✓\n'; }
falha() {
  # falha "<motivo>" "<o que fazer>"
  printf '  ✗ %s — %s\n' "$1" "$2" >&2
  exit 1
}

mostrar_ajuda() {
  cat <<'AJUDA'
Uso: instalar.sh [opções]

Instala o Bruto: dependências de sistema, banco, build, e cria o atalho do
app. Rodar de novo é atualizar — idempotente, pula o que já existe.

Opções:
  --sem-whisper     não instala o transcritor local (Whisper)
  --sem-atalho      não cria o atalho do app (Bruto.app / bruto.desktop)
  --sim             não pergunta nada (assume sim para tudo, inclusive Whisper)
  --dir <pasta>     pasta onde instalar (padrão: o clone atual, $BRUTO_DIR, ou ~/Bruto)
  -h, --help        mostra esta ajuda

Uma linha (não precisa clonar antes):
  curl -fsSL https://raw.githubusercontent.com/Ideia-Business/bruto/main/install/instalar.sh | bash

De dentro de um clone:
  bash install/instalar.sh
AJUDA
}

# ---------------------------------------------------------------------------
# Flags
# ---------------------------------------------------------------------------
SEM_WHISPER=0
SEM_ATALHO=0
SIM=0
DIR_INSTALACAO=""

while [ $# -gt 0 ]; do
  case "$1" in
    --sem-whisper) SEM_WHISPER=1; shift ;;
    --sem-atalho) SEM_ATALHO=1; shift ;;
    --sim) SIM=1; shift ;;
    --dir)
      [ $# -ge 2 ] || { echo "✗ --dir exige um caminho" >&2; exit 1; }
      DIR_INSTALACAO="$2"; shift 2 ;;
    -h|--help) mostrar_ajuda; exit 0 ;;
    *) echo "✗ Opção desconhecida: $1" >&2; echo >&2; mostrar_ajuda >&2; exit 1 ;;
  esac
done

# ---------------------------------------------------------------------------
# Pergunta sim/não — respeita --sim, e funciona sem stdin interativo
# (curl | bash): lê de /dev/tty se existir, senão assume o padrão (sim).
# ---------------------------------------------------------------------------
perguntar_sim_nao() {
  if [ "$SIM" -eq 1 ]; then
    return 0
  fi
  local resposta=""
  if [ -r /dev/tty ]; then
    printf '%s [S/n] ' "$1" > /dev/tty
    read -r resposta < /dev/tty || resposta=""
  fi
  case "$resposta" in
    [nN]*) return 1 ;;
    *) return 0 ;;
  esac
}

# ---------------------------------------------------------------------------
# Sistema operacional e arquitetura
# ---------------------------------------------------------------------------
SO="$(uname -s)"
ARCH="$(uname -m)"

case "$SO" in
  Darwin|Linux) ;;
  *)
    echo "✗ Sistema não suportado: $SO — este instalador cobre macOS e Linux." >&2
    echo "  Windows: install/instalar.ps1 (PowerShell)." >&2
    exit 1
    ;;
esac

GERENCIADOR=""
detectar_gerenciador_linux() {
  if command -v apt-get >/dev/null 2>&1; then GERENCIADOR="apt"
  elif command -v dnf >/dev/null 2>&1; then GERENCIADOR="dnf"
  elif command -v pacman >/dev/null 2>&1; then GERENCIADOR="pacman"
  elif command -v zypper >/dev/null 2>&1; then GERENCIADOR="zypper"
  else GERENCIADOR=""
  fi
}

# instalar_pacote_linux <pacote> [pacote...] — imprime o comando com sudo
# ANTES de rodar (nada de sudo escondido) e usa o gerenciador já detectado.
instalar_pacote_linux() {
  local pacotes="$*"
  local cmd=""
  case "$GERENCIADOR" in
    apt) cmd="sudo apt-get update && sudo apt-get install -y $pacotes" ;;
    dnf) cmd="sudo dnf install -y $pacotes" ;;
    pacman) cmd="sudo pacman -Sy --noconfirm $pacotes" ;;
    zypper) cmd="sudo zypper install -y $pacotes" ;;
    *) return 1 ;;
  esac
  echo "    \$ $cmd"
  bash -c "$cmd"
}

if [ "$SO" = "Linux" ]; then
  detectar_gerenciador_linux
  if [ -z "$GERENCIADOR" ]; then
    falha "nenhum gerenciador de pacotes suportado (apt/dnf/pacman/zypper)" "instale git, ffmpeg e Node.js 20+ manualmente e rode este instalador de novo"
  fi
fi

# ---------------------------------------------------------------------------
# macOS: Homebrew é pré-requisito de tudo o mais. Não o instalamos sozinhos.
# ---------------------------------------------------------------------------
if [ "$SO" = "Darwin" ]; then
  etapa "Homebrew"
  if command -v brew >/dev/null 2>&1; then
    ok
  else
    falha "Homebrew não encontrado" "instale em https://brew.sh e rode este instalador de novo"
  fi
fi

# ---------------------------------------------------------------------------
# git — precisa vir antes de resolver/clonar a pasta de instalação.
# ---------------------------------------------------------------------------
etapa "git"
if command -v git >/dev/null 2>&1; then
  ok
else
  if [ "$SO" = "Darwin" ]; then
    if brew install git; then ok; else falha "brew install git falhou" "rode 'xcode-select --install' ou 'brew install git' manualmente e tente de novo"; fi
  else
    if instalar_pacote_linux git; then ok; else falha "instalação do git falhou" "instale git com o gerenciador de pacotes da sua distro e rode de novo"; fi
  fi
fi

# ---------------------------------------------------------------------------
# Onde instala
# ---------------------------------------------------------------------------
detectar_clone_atual() {
  local src="${BASH_SOURCE[0]:-}"
  [ -n "$src" ] || return 1
  [ -f "$src" ] || return 1
  local dir
  dir="$(cd "$(dirname "$src")/.." 2>/dev/null && pwd)" || return 1
  # .git é diretório num clone normal e ARQUIVO (gitdir pointer) numa
  # worktree — -e cobre os dois; -d sozinho erraria em worktree.
  if [ -f "$dir/package.json" ] && [ -e "$dir/.git" ] && grep -q '"name": *"bruto"' "$dir/package.json" 2>/dev/null; then
    printf '%s' "$dir"
    return 0
  fi
  return 1
}

CLONE_ATUAL="$(detectar_clone_atual)" || CLONE_ATUAL=""

if [ -n "$DIR_INSTALACAO" ]; then
  BRUTO_ALVO="$DIR_INSTALACAO"
  MODO="alvo"
elif [ -n "$CLONE_ATUAL" ]; then
  BRUTO_ALVO="$CLONE_ATUAL"
  MODO="clone-atual"
elif [ -n "${BRUTO_DIR:-}" ]; then
  BRUTO_ALVO="$BRUTO_DIR"
  MODO="alvo"
else
  BRUTO_ALVO="$HOME/Bruto"
  MODO="alvo"
fi

# Normaliza para absoluto AQUI, antes do `cd "$BRUTO_ALVO"` mais abaixo — depois
# do cd, um valor relativo (ex.: --dir Bruto) passaria a apontar para
# $BRUTO_ALVO/Bruto (relativo ao NOVO cwd) em todo uso posterior da variável
# (atalho, resumo final). $PWD ainda é o diretório de onde o instalador foi
# chamado neste ponto.
case "$BRUTO_ALVO" in
  /*) : ;;
  *) BRUTO_ALVO="$PWD/$BRUTO_ALVO" ;;
esac

if [ "$MODO" = "clone-atual" ]; then
  etapa "Usando o clone atual em $BRUTO_ALVO"
  ok
else
  if [ -e "$BRUTO_ALVO/.git" ]; then
    etapa "Atualizando clone existente em $BRUTO_ALVO"
    if (cd "$BRUTO_ALVO" && git pull --ff-only); then
      ok
    else
      falha "git pull --ff-only falhou em $BRUTO_ALVO (histórico local divergente?)" "resolva manualmente (git status / git log) em $BRUTO_ALVO e rode este instalador de novo"
    fi
  elif [ -e "$BRUTO_ALVO" ]; then
    falha "$BRUTO_ALVO já existe e não é um clone do Bruto" "escolha outra pasta com --dir <pasta>, ou apague/renomeie $BRUTO_ALVO manualmente e rode de novo (nunca apagamos sozinhos)"
  else
    etapa "Clonando o Bruto em $BRUTO_ALVO"
    if git clone "$REPO_URL" "$BRUTO_ALVO"; then
      ok
    else
      falha "git clone falhou" "confira sua conexão com a internet e rode este instalador de novo"
    fi
  fi
fi

cd "$BRUTO_ALVO"

# ---------------------------------------------------------------------------
# Node.js ≥ 20
# macOS: usa o Node que já existe se for ≥ 20; senão `brew install node`
# (fórmula normal, linkada — o atalho acha sem mexer no PATH). Nunca troca
# um Node válido que a pessoa já tem.
# Linux: usa o que já está no sistema se for ≥ 20; senão tenta o gerenciador
# de pacotes; se mesmo assim continuar < 20, orienta e para (nunca força
# upgrade por fora do gerenciador).
# ---------------------------------------------------------------------------
# Node oficial na pasta do usuário, sem sudo. POR QUE: o apt do Ubuntu 24.04
# oferece o Node 18 (medido em 25/09/2026) e outras distros variam; o binário
# oficial é igual em todas. Confere o SHA-256 contra o SHASUMS256.txt do
# nodejs.org antes de extrair.
instalar_node_usuario() {
  local arq base dir_node alvo nome soma_esperada soma
  case "$(uname -m)" in
    x86_64|amd64) arq="x64" ;;
    aarch64|arm64) arq="arm64" ;;
    *) echo "  arquitetura $(uname -m) sem binário oficial do Node" >&2; return 1 ;;
  esac
  base="https://nodejs.org/dist/latest-v22.x"
  dir_node="$HOME/.local/share/bruto/node"
  alvo="$(mktemp -d)"
  echo "  (baixando o Node 22 oficial para $dir_node — sem sudo)"
  if ! curl -fsSL "$base/SHASUMS256.txt" -o "$alvo/SHASUMS256.txt"; then rm -rf "$alvo"; return 1; fi
  nome="$(grep -o "node-v22[.0-9]*-linux-${arq}\.tar\.gz" "$alvo/SHASUMS256.txt" | head -1)"
  [ -n "$nome" ] || { rm -rf "$alvo"; return 1; }
  soma_esperada="$(grep " ${nome}\$" "$alvo/SHASUMS256.txt" | awk '{print $1}')"
  if ! curl -fsSL "$base/$nome" -o "$alvo/$nome"; then rm -rf "$alvo"; return 1; fi
  soma="$(sha256sum "$alvo/$nome" | awk '{print $1}')"
  if [ -z "$soma_esperada" ] || [ "$soma" != "$soma_esperada" ]; then
    echo "  SHA-256 do Node não confere — download descartado" >&2
    rm -rf "$alvo"; return 1
  fi
  rm -rf "$dir_node" && mkdir -p "$dir_node" "$HOME/.local/bin"
  tar -xzf "$alvo/$nome" -C "$dir_node" --strip-components=1 || { rm -rf "$alvo"; return 1; }
  rm -rf "$alvo"
  for b in node npm npx; do ln -sf "$dir_node/bin/$b" "$HOME/.local/bin/$b"; done
  export PATH="$HOME/.local/bin:$PATH"
  hash -r 2>/dev/null || true
}

versao_node_ok() {
  # Escolha pela versão (launcher/_node.sh): um Node velho em ~/.local/bin ou
  # em qualquer pasta à frente no PATH não engana mais a checagem, e depois de
  # um `brew install node` a escolha é refeita do zero.
  # shellcheck source=../launcher/_node.sh
  . "$BRUTO_ALVO/launcher/_node.sh"
  bruto_escolher_node
}

if [ "$SO" = "Darwin" ]; then
  etapa "Node.js ≥ 20"
  if versao_node_ok; then
    ok
  elif brew install node && versao_node_ok; then
    ok
  else
    falha "Node.js ≥ 20 não encontrado" "rode 'brew install node' (ou 'brew upgrade node') e rode este instalador de novo"
  fi
else
  etapa "Node.js ≥ 20"
  if versao_node_ok; then
    ok
  elif instalar_node_usuario && versao_node_ok; then
    ok
  else
    falha "não consegui instalar o Node.js ≥ 20" "instale o Node 22 (https://nodejs.org/pt/download) e rode este instalador de novo"
  fi
fi

# ---------------------------------------------------------------------------
# uv — instala o resto (yt-dlp, whisper). ~/.local/bin é onde `uv tool`
# grava os shims, em qualquer plataforma; garantimos no PATH da sessão e,
# quando possível, no shell permanente (uv tool update-shell).
# ---------------------------------------------------------------------------
etapa "uv"
if command -v uv >/dev/null 2>&1; then
  ok
else
  if [ "$SO" = "Darwin" ]; then
    if brew install uv; then ok; else falha "brew install uv falhou" "rode 'brew install uv' manualmente e tente de novo"; fi
  else
    if curl -LsSf https://astral.sh/uv/install.sh | sh; then
      ok
    else
      falha "instalador oficial do uv falhou" "rode 'curl -LsSf https://astral.sh/uv/install.sh | sh' manualmente (precisa de curl) e tente de novo"
    fi
  fi
fi
export PATH="$HOME/.local/bin:$PATH"
if command -v uv >/dev/null 2>&1; then
  if ! uv tool update-shell >/dev/null 2>&1; then
    echo "    ⚠️  não consegui garantir ~/.local/bin no seu shell permanente — rode 'uv tool update-shell' você mesmo, ou adicione ~/.local/bin ao PATH manualmente"
  fi
fi

# ---------------------------------------------------------------------------
# yt-dlp — via uv (o pacote das distros costuma ter meses de atraso, e isso
# quebra Instagram/YouTube).
# ---------------------------------------------------------------------------
etapa "yt-dlp"
if uv tool install yt-dlp; then ok; else falha "uv tool install yt-dlp falhou" "rode 'uv tool install yt-dlp' manualmente e tente de novo"; fi

# ---------------------------------------------------------------------------
# ffmpeg
# ---------------------------------------------------------------------------
etapa "ffmpeg"
if command -v ffmpeg >/dev/null 2>&1; then
  ok
else
  if [ "$SO" = "Darwin" ]; then
    if brew install ffmpeg; then ok; else falha "brew install ffmpeg falhou" "rode 'brew install ffmpeg' manualmente e tente de novo"; fi
  else
    if instalar_pacote_linux ffmpeg; then ok; else falha "instalação do ffmpeg falhou" "instale ffmpeg com o gerenciador de pacotes da sua distro e rode de novo"; fi
  fi
fi

# ---------------------------------------------------------------------------
# Linux: compilador para dependência nativa (better-sqlite3). POR QUE: quando
# não há binário pronto para a arquitetura/Node (medido em 25/09/2026 num
# Ubuntu 24.04 arm64 limpo), o npm compila — e sem make/g++/python3 o `npm ci`
# morre. É o mesmo conjunto que qualquer projeto Node com addon nativo pede.
# ---------------------------------------------------------------------------
if [ "$SO" = "Linux" ]; then
  etapa "ferramentas de compilação (make, g++, python3)"
  if command -v make >/dev/null 2>&1 && command -v g++ >/dev/null 2>&1 && command -v python3 >/dev/null 2>&1; then
    ok
  else
    case "$GERENCIADOR" in
      apt) PACOTES_BUILD="build-essential python3" ;;
      dnf) PACOTES_BUILD="make gcc-c++ python3" ;;
      pacman) PACOTES_BUILD="base-devel python" ;;
      zypper) PACOTES_BUILD="make gcc-c++ python3" ;;
      *) PACOTES_BUILD="" ;;
    esac
    if [ -n "$PACOTES_BUILD" ] && instalar_pacote_linux $PACOTES_BUILD; then ok; else falha "instalação das ferramentas de compilação falhou" "instale make, g++ e python3 com o gerenciador da sua distro e rode de novo"; fi
  fi
fi

# ---------------------------------------------------------------------------
# Whisper (opcional, padrão sim — Instagram e TikTok dependem dele para
# vídeo sem legenda). Apple Silicon: mlx-whisper (leve, sem aviso de
# tamanho). Intel/Linux: openai-whisper, que baixa ~2 GB de PyTorch — avisa
# e pergunta antes (--sim assume sim).
# ---------------------------------------------------------------------------
if [ "$SEM_WHISPER" -eq 1 ]; then
  echo "→ Pulando Whisper (--sem-whisper)"
elif [ "$SO" = "Darwin" ] && [ "$ARCH" = "arm64" ]; then
  etapa "Whisper (mlx-whisper, Apple Silicon)"
  if uv tool install mlx-whisper; then ok; else falha "uv tool install mlx-whisper falhou" "rode 'uv tool install mlx-whisper' manualmente, ou use --sem-whisper"; fi
else
  if perguntar_sim_nao "→ Instalar o transcritor Whisper (openai-whisper, baixa ~2 GB de PyTorch)?"; then
    etapa "Whisper (openai-whisper, ~2 GB)"
    if uv tool install openai-whisper; then ok; else falha "uv tool install openai-whisper falhou" "rode 'uv tool install openai-whisper' manualmente, ou use --sem-whisper"; fi
  else
    echo "  → pulando Whisper — vídeo do Instagram/TikTok sem legenda vai falhar (dá para instalar depois)"
  fi
fi

# ---------------------------------------------------------------------------
# npm ci (ou npm install sem lockfile)
# ---------------------------------------------------------------------------
etapa "Dependências do Node"
if [ -f package-lock.json ]; then
  if npm ci; then ok; else falha "npm ci falhou" "veja o erro acima; apagar node_modules e rodar este instalador de novo pode ajudar"; fi
else
  if npm install; then ok; else falha "npm install falhou" "veja o erro acima e rode este instalador de novo"; fi
fi

# ---------------------------------------------------------------------------
# Playwright Chromium — usado só para exportar PDF e a imagem do mapa mental
# (src/pipeline/lib/browser.ts); o resto do Bruto funciona sem ele. Por isso
# uma falha aqui é AVISO, nunca aborta a instalação inteira.
#
# --with-deps só em apt: o instalador de dependências do Playwright
# (install-deps) só sabe lidar com a família Debian/Ubuntu — em
# Fedora/Arch/openSUSE ele tenta rodar apt-get e falha. Nesses, instalamos só
# o Chromium e avisamos que pode faltar biblioteca de sistema.
# ---------------------------------------------------------------------------
etapa "Playwright (Chromium — exporta PDF/imagem do mapa mental)"
if [ "$SO" = "Linux" ] && [ "$GERENCIADOR" = "apt" ]; then
  echo "    também instala dependências de sistema do Chromium via apt — pode pedir sua senha (sudo)"
  PLAYWRIGHT_ARGS=(playwright install --with-deps chromium)
else
  PLAYWRIGHT_ARGS=(playwright install chromium)
fi
if npx "${PLAYWRIGHT_ARGS[@]}"; then
  ok
else
  echo "  ⚠️  npx ${PLAYWRIGHT_ARGS[*]} falhou — só afeta exportar PDF e imagem do mapa mental; o resto do Bruto funciona sem isso"
  echo "      rode manualmente depois: npx ${PLAYWRIGHT_ARGS[*]}"
  if [ "$SO" = "Linux" ] && [ "$GERENCIADOR" != "apt" ]; then
    echo "      fora do Debian/Ubuntu pode faltar biblioteca de sistema do Chromium — veja https://playwright.dev/docs/browsers#install-system-dependencies"
  fi
fi

# ---------------------------------------------------------------------------
# Banco de dados
# ---------------------------------------------------------------------------
etapa "Banco de dados (migrate + seed)"
if npm run db:migrate && npm run db:seed; then
  ok
else
  falha "db:migrate/db:seed falhou" "veja o erro acima, corrija e rode este instalador de novo"
fi

# ---------------------------------------------------------------------------
# Build — grava o commit do build para o atalho saber quando reconstruir.
# ---------------------------------------------------------------------------
etapa "Build de produção"
if npm run build; then
  git rev-parse HEAD > .next/.bruto-build-commit 2>/dev/null || echo "desconhecido" > .next/.bruto-build-commit
  ok
else
  falha "npm run build falhou" "veja o erro acima, corrija e rode este instalador de novo"
fi

# ---------------------------------------------------------------------------
# doctor — informativo, nunca reprova a instalação.
# ---------------------------------------------------------------------------
etapa "Conferindo dependências (npm run doctor)"
if npm run doctor; then
  ok
else
  echo "  ⚠️  o doctor encontrou pendências (relatório acima) — informativo, não interrompe a instalação"
fi

# ---------------------------------------------------------------------------
# Atalho
# ---------------------------------------------------------------------------
if [ "$SEM_ATALHO" -eq 1 ]; then
  echo "→ Pulando criação de atalho (--sem-atalho)"
else
  if [ "$SO" = "Darwin" ]; then
    etapa "Atalho (Bruto.app)"
    if bash "$BRUTO_ALVO/launcher/install-app.sh"; then ok; else falha "criação do Bruto.app falhou" "rode 'bash launcher/install-app.sh' manualmente para ver o erro completo"; fi
  else
    etapa "Atalho (bruto.desktop)"
    if bash "$BRUTO_ALVO/launcher/atalho-linux.sh"; then ok; else falha "criação do atalho .desktop falhou" "rode 'bash launcher/atalho-linux.sh' manualmente para ver o erro completo"; fi
  fi
fi

# ---------------------------------------------------------------------------
# Modelo de IA — nunca cria, lê nem escreve .env.
# ---------------------------------------------------------------------------
echo
echo "→ Modelo de IA"
TEM_PROVEDOR_CLI=0
if command -v claude >/dev/null 2>&1; then
  echo "  ✓ claude encontrado — se estiver logado, o Bruto usa o seu plano Claude"
  TEM_PROVEDOR_CLI=1
fi
if command -v codex >/dev/null 2>&1; then
  echo "  ✓ codex encontrado — se estiver logado, o Bruto usa o seu plano ChatGPT"
  TEM_PROVEDOR_CLI=1
fi
if [ "$TEM_PROVEDOR_CLI" -eq 0 ]; then
  echo "  nenhum CLI de IA (claude/codex) encontrado no PATH. Duas saídas:"
  echo "    1) instale e logue um deles — claude (https://claude.com/claude-code) ou codex (https://developers.openai.com/codex) — sai da assinatura que você já paga"
  echo "    2) use uma chave de API de um dos provedores suportados: crie um .env na raiz do projeto (o instalador nunca faz isso por você)"
fi

# ---------------------------------------------------------------------------
# Resumo final
# ---------------------------------------------------------------------------
echo
echo "✅ Bruto instalado em: $BRUTO_ALVO"
if [ "$SO" = "Darwin" ]; then
  echo "   Abrir: Launchpad → Bruto (ou ~/Applications/Bruto.app)"
else
  echo "   Abrir: menu de aplicativos → Bruto (ou o atalho na Área de Trabalho)"
fi
echo "   Sem atalho: bash \"$BRUTO_ALVO/launcher/serve.sh\""
echo "   Atualizar: rode este mesmo comando de novo"
