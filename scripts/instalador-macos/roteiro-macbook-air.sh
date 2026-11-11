#!/bin/bash
# roteiro-macbook-air.sh — ajuda a provar o instalador .dmg do Bruto (demanda
# 6c067200) num MacBook Air. RODA NA MÁQUINA DA PESSOA (o Air), nunca na de
# build. Passo a passo em português: docs/instalador/roteiro-macbook-air.md.
# Compatível com bash 3.2 (macOS).
#
#   listar  — SOMENTE LEITURA: tudo do Bruto que existir na máquina, com
#             caminho absoluto e tamanho. Grava a listagem em
#             ~/Desktop/bruto-listagem-<data>.txt
#   testar  — depois de instalar o .dmg em /Applications: confere a
#             quarentena e a assinatura (codesign), abre o app
#             (open -a /Applications/Bruto.app) e COLETA o material da
#             prova: o corpo BRUTO da resposta de /api/versao (SEM -f: uma
#             resposta de erro do servidor, com status e corpo, também é
#             evidência), o status HTTP, o código de saída do curl (erro de
#             transporte), a versão do Info.plist do app instalado e as
#             últimas 20 linhas do log do servidor. NÃO decide resultado
#             nenhum: não há análise nem veredito — o arquivo é para a
#             orquestradora conferir. Grava o resumo em
#             ~/Desktop/bruto-teste-<data>.txt. Exit 0 se recebeu resposta
#             (qualquer status); ≠ 0 só se não recebeu nenhuma (o motivo,
#             com o código de saída do curl, fica no resumo).
#
# ESTE ROTEIRO É SOMENTE LEITURA (decisão do dono, 11/11/2026, depois de
# três rodadas de revisão com achados de segurança):
# - Ele NUNCA move, apaga, renomeia ou cria nada (a única escrita em disco é
#   o relatório na Mesa) e NUNCA envia sinal a processo nenhum. Limpar a
#   máquina e desfazer o teste são passos MANUAIS, escritos no documento
#   (docs/instalador/roteiro-macbook-air.md, passos 2 e 5): a pessoa digita
#   um comando por linha e confere o resultado de cada um.
# - Os subcomandos limpar e restaurar NÃO existem mais; se forem chamados, o
#   roteiro responde onde está o documento e termina com erro.
# - A única ação além de ler é o `open -a` do `testar` — o mesmo gesto que a
#   pessoa faria com dois cliques no app.
# - Nunca sudo. Nunca toca no Homebrew, no uv global nem no Node do sistema.
# - yt-dlp/ffmpeg/node/uv achados no PATH NÃO são do Bruto: aparecem como
#   informação no `listar` e nunca são tocados. O `listar` também informa o
#   que escuta na porta (PID e comando), sem julgar se é do Bruto.
#
# Variáveis de ambiente que desviam alvos SEM mudar comportamento (para os
# testes automatizados, que não podem usar a porta 3000 nem /Applications):
# BRUTO_ROTEIRO_PORTA (default 3000), BRUTO_ROTEIRO_APP_SISTEMA (default
# /Applications/Bruto.app), BRUTO_ROTEIRO_DATA (default: hoje),
# BRUTO_ROTEIRO_ESPERA (default 90) e BRUTO_DATA_ROOT (default ~/.bruto).

set -euo pipefail

DATA="${BRUTO_ROTEIRO_DATA:-$(date +%Y-%m-%d)}"
PORTA="${BRUTO_ROTEIRO_PORTA:-3000}"
APP_SISTEMA="${BRUTO_ROTEIRO_APP_SISTEMA:-/Applications/Bruto.app}"
APP_USUARIO="$HOME/Applications/Bruto.app"
CLONE="$HOME/Bruto"
DADOS="${BRUTO_DATA_ROOT:-$HOME/.bruto}"
LOG_SERVIDOR="$DADOS/logs/servidor.log"
MESA="$HOME/Desktop"
ARQUIVO_HOST="com.ideiabusiness.bruto.json"
BASE_NAV="$HOME/Library/Application Support"
ESPERA="${BRUTO_ROTEIRO_ESPERA:-90}"

# Os quatro navegadores cujo NativeMessagingHosts o instalador do Bruto usa.
diretorios_navegador() {
  printf '%s\n' \
    "$BASE_NAV/Google/Chrome" \
    "$BASE_NAV/Chromium" \
    "$BASE_NAV/Microsoft Edge" \
    "$BASE_NAV/BraveSoftware/Brave-Browser"
}

ajuda() {
  cat <<EOF
Uso: bash roteiro-macbook-air.sh <subcomando>

  listar
      Somente leitura. Imprime, com caminho absoluto e tamanho, tudo do
      Bruto que existir nesta máquina: o clone ($CLONE), os dois Bruto.app
      ($APP_USUARIO e $APP_SISTEMA), os dados ($DADOS — sem listar o
      conteúdo, só as subpastas de 1º nível), os manifestos do host nativo
      ($ARQUIVO_HOST) de Chrome/Chromium/Edge/Brave e o que escuta na porta
      $PORTA (PID e comando — SEM julgar se é do Bruto). Mostra também se
      há yt-dlp/ffmpeg/node/uv no PATH (só informativo — NÃO são do Bruto e
      NÃO serão tocados).
      Grava a lista em $MESA/bruto-listagem-$DATA.txt.

  testar
      Depois de instalar o .dmg em $APP_SISTEMA: confere o atributo de
      quarentena e informa o que a pessoa vai ver, verifica a assinatura
      (codesign), abre o app (open -a $APP_SISTEMA — a única ação além de
      ler) e COLETA o material da prova: o corpo BRUTO da resposta de
      http://127.0.0.1:$PORTA/api/versao (sem análise nenhuma e SEM -f:
      resposta de erro do servidor também é evidência), o status HTTP, o
      código de saída do curl (erro de transporte), a versão do Info.plist
      do app instalado (PlistBuddy) e as últimas 20 linhas do log
      do servidor ($LOG_SERVIDOR). Este roteiro NÃO decide resultado: não há
      veredito — o resumo é para a orquestradora conferir. Sai com 0 se
      recebeu resposta (qualquer status); sai com ≠ 0 só se não recebeu
      nenhuma resposta (o motivo, com o código de saída do curl, fica no
      resumo).
      Grava o resumo em $MESA/bruto-teste-$DATA.txt.

Os subcomandos limpar e restaurar NÃO existem mais: o roteiro virou somente
leitura (decisão de 11/11/2026). Limpar a máquina e desfazer o teste são
passos MANUAIS, um comando por linha, escritos no documento
docs/instalador/roteiro-macbook-air.md (passos 2 e 5).

Este roteiro nunca usa sudo, nunca toca no Homebrew/uv/Node, nunca move nem
apaga nada e nunca envia sinal a processo nenhum.

Variáveis de ambiente (testes): BRUTO_ROTEIRO_PORTA (default 3000),
BRUTO_ROTEIRO_APP_SISTEMA (default /Applications/Bruto.app),
BRUTO_ROTEIRO_DATA (default: hoje), BRUTO_ROTEIRO_ESPERA (default 90) e
BRUTO_DATA_ROOT (default ~/.bruto).
EOF
}

# --- sondas (só leitura) --------------------------------------------------------

# PIDs de TUDO que escuta na porta (lsof não existe ou não acha nada →
# saída vazia; nunca falha a rodada).
pids_na_porta() {
  lsof -nP -iTCP:"$PORTA" -sTCP:LISTEN -F p 2>/dev/null | sed -n 's/^p//p' || true
}

comando_do_pid() {
  ps -p "$1" -o command= 2>/dev/null || true
}

# --- listar (somente leitura) ---------------------------------------------------

listar() {
  # O único diretório que pode criar é a Mesa, para gravar o relatório nela.
  mkdir -p "$MESA"
  local saida="$MESA/bruto-listagem-$DATA.txt"
  : >"$saida"

  nota() {
    printf '%s\n' "$*" | tee -a "$saida"
  }

  nota "# Listagem do Bruto — $DATA — gerada por roteiro-macbook-air.sh listar"
  nota "# Somente leitura: este roteiro não move, não apaga e não encerra nada."
  nota ""

  nota "== Clone (instalação antiga por curl | bash) =="
  if [ -d "$CLONE" ]; then
    nota "clone: $CLONE — $(du -sh "$CLONE" 2>/dev/null | awk '{print $1}') — pode ter .env e mudanças locais"
  else
    nota "clone: não existe — $CLONE"
  fi
  nota ""

  nota "== Apps =="
  if [ -d "$APP_USUARIO" ]; then
    nota "app do usuário: $APP_USUARIO — $(du -sh "$APP_USUARIO" 2>/dev/null | awk '{print $1}')"
  else
    nota "app do usuário: não existe — $APP_USUARIO (atalho da instalação por terminal)"
  fi
  if [ -d "$APP_SISTEMA" ]; then
    nota "app do sistema: $APP_SISTEMA — $(du -sh "$APP_SISTEMA" 2>/dev/null | awk '{print $1}')"
  else
    nota "app do sistema: não existe — $APP_SISTEMA (app do .dmg)"
  fi
  nota ""

  nota "== Dados do Bruto (biblioteca e ferramentas) =="
  if [ -d "$DADOS" ]; then
    nota "dados: $DADOS — $(du -sh "$DADOS" 2>/dev/null | awk '{print $1}') — subpastas de 1º nível:"
    find "$DADOS" -maxdepth 1 -mindepth 1 -type d 2>/dev/null | LC_ALL=C sort | while IFS= read -r sub; do
      nota "  · $sub ($(du -sh "$sub" 2>/dev/null | awk '{print $1}'))"
    done
  else
    nota "dados: não existe — $DADOS"
  fi
  nota ""

  nota "== Manifestos do host nativo ($ARQUIVO_HOST) =="
  local achou=0 pai alvo
  while IFS= read -r pai; do
    [ -n "$pai" ] || continue
    alvo="$pai/NativeMessagingHosts/$ARQUIVO_HOST"
    if [ -f "$alvo" ]; then
      nota "manifesto: $alvo — $(du -sh "$alvo" 2>/dev/null | awk '{print $1}')"
      achou=1
    fi
  done <<EOF
$(diretorios_navegador)
EOF
  [ "$achou" -eq 1 ] || nota "manifestos: nenhum encontrado (Chrome, Chromium, Edge, Brave)"
  nota ""

  # Só informação: o roteiro não julga se quem escuta é do Bruto e não toca
  # em processo nenhum.
  nota "== Porta $PORTA =="
  local pid="" viu=0
  for pid in $(pids_na_porta); do
    viu=1
    nota "pid $pid: $(comando_do_pid "$pid")"
  done
  if [ "$viu" -eq 1 ]; then
    nota "(só informação: este roteiro não julga se é do Bruto e não encerra nada)"
  else
    nota "nada escutando na porta $PORTA"
  fi
  nota "aviso: o servidor do Bruto continua rodando depois de ⌘Q (⌘Q fecha só a"
  nota "janela); para movê-lo, a saída de lsof -nP -iTCP:$PORTA -sTCP:LISTEN"
  nota "tem de estar vazia — passo \"Confirme que o Bruto parou\" do documento"
  nota "docs/instalador/roteiro-macbook-air.md (passos 2 e 5)."
  nota ""

  nota "== No PATH (só informativo — NÃO são do Bruto e NÃO serão tocados) =="
  local ferramenta onde
  for ferramenta in yt-dlp ffmpeg node uv; do
    onde="$(command -v "$ferramenta" 2>/dev/null || true)"
    if [ -n "$onde" ]; then
      nota "$ferramenta: $onde"
    else
      nota "$ferramenta: não encontrado no PATH"
    fi
  done
  nota ""

  nota "Listagem gravada em: $saida"
  return 0
}

# --- testar (coleta o material da prova; roda DEPOIS de instalar o .dmg) --------

testar() {
  # O único diretório que pode criar é a Mesa, para gravar o relatório nela.
  mkdir -p "$MESA"
  local resumo="$MESA/bruto-teste-$DATA.txt"
  : >"$resumo"
  rel() { printf '%s\n' "$*" | tee -a "$resumo"; }

  rel "# Teste do Bruto (.dmg) — $DATA — gerado por roteiro-macbook-air.sh testar"
  rel "# Somente leitura, com UMA ação: abrir o app (open -a). Este roteiro NÃO"
  rel "# decide resultado — quem confere este arquivo é a orquestradora."

  if [ ! -d "$APP_SISTEMA" ]; then
    rel "✗ não consegui coletar: o app não está em $APP_SISTEMA — instale o .dmg primeiro"
    rel "  (abrir o .dmg, arrastar o Bruto para a pasta Applications e fechar o .dmg)."
    printf 'Nada coletado. Resumo em: %s — mande este arquivo mesmo assim.\n' "$resumo"
    exit 1
  fi

  rel ""
  rel "== App =="
  rel "app: $APP_SISTEMA ($(du -sh "$APP_SISTEMA" 2>/dev/null | awk '{print $1}'))"

  rel ""
  rel "== Quarentena (o aviso da Apple na primeira abertura) =="
  local quarentena=""
  if command -v xattr >/dev/null 2>&1; then
    if quarentena="$(xattr -p com.apple.quarantine "$APP_SISTEMA" 2>/dev/null)"; then
      rel "atributo com.apple.quarantine: PRESENTE ($quarentena) — recebido/baixado como um arquivo qualquer."
      rel "  o que a pessoa vai ver na primeira abertura: o macOS bloqueia o app e avisa"
      rel "  que não pode ser verificado; libera em Ajustes do Sistema → Privacidade e"
      rel "  Segurança → seção Segurança → botão \"Abrir Mesmo Assim\" → confirmar \"Abrir\"."
      rel "  (em macOS recentes o clique-direito → Abrir não basta)"
    else
      rel "atributo com.apple.quarantine: AUSENTE — o app abre sem o aviso da Apple"
      rel "  (o caminho do Gatekeeper não é exercitado desta vez)."
    fi
  else
    rel "xattr indisponível — quarentena não conferida."
  fi

  rel ""
  rel "== Assinatura (ad-hoc, sem Apple na v1) =="
  if command -v codesign >/dev/null 2>&1; then
    if codesign --verify --deep --strict "$APP_SISTEMA" >/dev/null 2>&1; then
      rel "codesign --verify --deep --strict: saída 0"
    else
      rel "codesign --verify --deep --strict: saída ≠ 0 — rode à mão para ver o erro:"
      rel "  codesign --verify --deep --strict --verbose=2 $APP_SISTEMA"
    fi
  else
    rel "codesign indisponível — assinatura não conferida."
  fi

  rel ""
  rel "== Abrir o app e esperar o servidor (até $ESPERA s) =="
  if open -a "$APP_SISTEMA" 2>/dev/null; then
    rel "open -a $APP_SISTEMA — disparado (a única coisa que este roteiro faz além de ler)"
  else
    rel "open -a $APP_SISTEMA — FALHOU (não consegui abrir o app por este caminho)"
  fi
  rel "consultando http://127.0.0.1:$PORTA/api/versao…"

  # Sem -f de propósito (achado da 7ª rodada): com -f, uma resposta HTTP 500
  # com corpo explicando o erro virava falha do curl, o corpo era descartado
  # e o relatório registrava "nenhuma resposta", perdendo a evidência. Cada
  # tentativa coleta três coisas: o corpo, o status HTTP (-w '%{http_code}',
  # sempre a última linha da saída) e o código de saída do curl (erro de
  # transporte). O laço só insiste enquanto NINGUÉM atendeu (status 000):
  # qualquer resposta — 200, 500, o que for — é material da prova.
  local bruto="" corpo="" status="000" rc_curl=0 recebi=0 i=0
  while [ "$i" -lt "$ESPERA" ]; do
    bruto=""
    rc_curl=0
    bruto="$(curl -sS --max-time 3 -w '\n%{http_code}' "http://127.0.0.1:$PORTA/api/versao" 2>/dev/null)" || rc_curl=$?
    status="$(printf '%s\n' "$bruto" | tail -n 1)"
    if [ -n "$status" ] && [ "$status" != "000" ]; then
      recebi=1
      break
    fi
    sleep 1
    i=$((i + 1))
  done
  corpo="$(printf '%s\n' "$bruto" | sed -e '$d')"

  rel ""
  rel "== Resposta de /api/versao (corpo bruto, status HTTP e código do curl; sem análise) =="
  if [ "$recebi" -eq 1 ]; then
    rel "status HTTP: $status"
    rel "código de saída do curl: $rc_curl (0 = resposta recebida; outro valor = erro de transporte)"
    if [ -n "$corpo" ]; then
      rel "corpo bruto (exatamente o que veio, sem análise nenhuma):"
      rel "$corpo"
    else
      rel "corpo bruto: (vazio — o servidor respondeu sem corpo)"
    fi
  else
    rel "nenhuma resposta de http://127.0.0.1:$PORTA/api/versao em $ESPERA s"
    rel "status HTTP: $status (000 = nenhuma resposta chegou)"
    rel "código de saída do curl na última tentativa: $rc_curl (erro de transporte:"
    rel "  7 = conexão recusada, 28 = tempo esgotado, 6 = não resolve o nome…)"
  fi

  rel ""
  rel "== Versão do app instalado (Info.plist) =="
  local versao_plist=""
  versao_plist="$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$APP_SISTEMA/Contents/Info.plist" 2>/dev/null | tr -d '\r\n' || true)"
  if [ -n "$versao_plist" ]; then
    rel "CFBundleShortVersionString: $versao_plist"
  else
    rel "não consegui ler — rode à mão:"
    rel "  /usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' $APP_SISTEMA/Contents/Info.plist"
  fi

  rel ""
  rel "== Fim do log do servidor (últimas 20 linhas de $LOG_SERVIDOR) =="
  if [ -f "$LOG_SERVIDOR" ]; then
    tail -n 20 "$LOG_SERVIDOR" 2>/dev/null | tee -a "$resumo" || true
  else
    rel "log não encontrado: $LOG_SERVIDOR"
  fi

  rel ""
  rel "== O que fazer com este arquivo =="
  rel "Mande este arquivo para a orquestradora conferir — quem decide o resultado"
  rel "é ela, não este roteiro."

  if [ "$recebi" -ne 1 ]; then
    rel ""
    rel "✗ não consegui coletar: nenhuma resposta de http://127.0.0.1:$PORTA/api/versao em $ESPERA s"
    rel "  (o fim do log acima pode explicar o motivo)."
    printf '\nNão coletado (motivo no resumo). Resumo em: %s — mande este arquivo mesmo assim.\n' "$resumo"
    exit 1
  fi

  printf '\nColetado. Resumo em: %s — mande este arquivo para a orquestradora conferir.\n' "$resumo"
  return 0
}

# --- guarda-livros ---------------------------------------------------------------
case "${1:-}" in
  listar)
    shift
    [ $# -eq 0 ] || { printf '✗ listar não aceita opções\n' >&2; exit 1; }
    listar
    ;;
  testar)
    shift
    [ $# -eq 0 ] || { printf '✗ testar não aceita opções\n' >&2; exit 1; }
    testar
    ;;
  limpar | restaurar)
    printf '✗ O subcomando "%s" não existe mais — este roteiro é somente leitura.\n' "$1" >&2
    printf '  Ele nunca move, apaga, renomeia, cria (fora do relatório na Mesa) nem\n' >&2
    printf '  encerra nada. Limpar e desfazer o teste são passos manuais, escritos em\n' >&2
    printf '  docs/instalador/roteiro-macbook-air.md (passos 2 e 5).\n' >&2
    exit 1
    ;;
  --ajuda | -h | ajuda)
    ajuda
    ;;
  "")
    printf '✗ Falta o subcomando.\n\n' >&2
    ajuda
    exit 1
    ;;
  *)
    printf '✗ Subcomando desconhecido: %s\n\n' "$1" >&2
    ajuda
    exit 1
    ;;
esac
