#!/bin/bash
# roteiro-macbook-air.sh — prepara (e testa) um MacBook Air para a prova do
# instalador .dmg do Bruto (demanda 6c067200). RODA NA MÁQUINA DA PESSOA
# (o Air), nunca na de build. Passo a passo em português:
# docs/instalador/roteiro-macbook-air.md. Compatível com bash 3.2 (macOS).
#
#   listar  — SOMENTE LEITURA: tudo do Bruto que existir na máquina, com
#             caminho absoluto e tamanho. Grava a listagem em
#             ~/Desktop/bruto-listagem-<data>.txt
#   limpar  — remove EXATAMENTE os itens do Bruto que estão na listagem;
#             só remove o que é regenerável sem perda (os dois Bruto.app e
#             os manifestos do host, que o instalador/registrador recria).
#             O clone (~/Bruto — pode ter .env e mudanças locais) e ~/.bruto
#             NUNCA são apagados: são MOVIDOS para <nome>-antes-do-teste-<data>
#             (reversível; rollback impresso no fim).
#   testar  — depois de instalar o .dmg em /Applications: quarentena,
#             assinatura, abre o app e espera /api/versao (até 90 s).
#             Grava o resumo em ~/Desktop/bruto-teste-<data>.txt
#
# Regras que este script cumpre (e não contorna):
# - Nunca sudo. Nunca toca no Homebrew, no uv global nem no Node do sistema.
# - yt-dlp/ffmpeg/node/uv achados no PATH NÃO são do Bruto: só aparecem como
#   informação no `listar` e nunca são removidos.
# - O servidor da porta só é encerrado se o comando dele for do Bruto
#   (next-server / server.js / serve.sh), e com confirmação.
# - Item de listagem que não é do Bruto (ex.: alguém editou o arquivo e pôs
#   ~/Documents) reprova a rodada inteira: NADA é removido.
#
# Duas variáveis de ambiente desviam alvos SEM mudar comportamento (para os
# testes automatizados, que não podem usar a porta 3000 nem /Applications):
# BRUTO_ROTEIRO_PORTA (default 3000) e BRUTO_ROTEIRO_APP_SISTEMA (default
# /Applications/Bruto.app).

set -euo pipefail

DATA="$(date +%Y-%m-%d)"
PORTA="${BRUTO_ROTEIRO_PORTA:-3000}"
APP_SISTEMA="${BRUTO_ROTEIRO_APP_SISTEMA:-/Applications/Bruto.app}"
CLONE="$HOME/Bruto"
CLONE_MOVIDO="$HOME/Bruto-antes-do-teste-$DATA"
APP_USUARIO="$HOME/Applications/Bruto.app"
DADOS="${BRUTO_DATA_ROOT:-$HOME/.bruto}"
DADOS_MOVIDO="$HOME/.bruto-antes-do-teste-$DATA"
MESA="$HOME/Desktop"
ARQUIVO_HOST="com.ideiabusiness.bruto.json"
BASE_NAV="$HOME/Library/Application Support"

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
      ($ARQUIVO_HOST) de Chrome/Chromium/Edge/Brave, o que escuta na porta
      $PORTA (PID e comando) e se há yt-dlp/ffmpeg/node/uv no PATH (só
      informativo — NÃO são do Bruto e NÃO serão removidos).
      Grava a lista em $MESA/bruto-listagem-$DATA.txt.

  limpar --listagem <arquivo>
      Remove EXATAMENTE os itens do arquivo de listagem que sejam do Bruto
      — mas só o que é regenerável sem perda: os dois Bruto.app e os
      manifestos do host (o instalador/registrador os recria). O clone
      ($CLONE — pode ter .env e mudanças locais) e $DADOS NUNCA são
      apagados: são MOVIDOS para $CLONE_MOVIDO e $DADOS_MOVIDO (o comando
      de rollback de cada item movido é impresso no fim). Se um backup
      datado de hoje já existe, a rodada é recusada antes de mexer em
      qualquer coisa. O servidor da porta $PORTA só é encerrado se o
      comando dele for do Bruto, com confirmação. Pede a confirmação
      digitada LIMPAR antes de qualquer remoção. Nunca usa sudo.

  testar
      Depois de instalar o .dmg em $APP_SISTEMA: confere o atributo de
      quarentena e informa o que a pessoa vai ver, verifica a assinatura
      (codesign), abre o app e espera /api/versao por até 90 s (versão e
      origem). Diz o próximo passo e onde está o log
      ($DADOS/logs/servidor.log). Grava o resumo em
      $MESA/bruto-teste-$DATA.txt.

Variáveis de ambiente (testes): BRUTO_ROTEIRO_PORTA (default 3000),
BRUTO_ROTEIRO_APP_SISTEMA (default /Applications/Bruto.app),
BRUTO_DATA_ROOT (default ~/.bruto).
EOF
}

# --- sondas -------------------------------------------------------------------
# PID do processo que ESCUTA na porta. lsof não existe ou não acha nada →
# saída vazia (nunca falha a rodada).
pid_na_porta() {
  lsof -nP -iTCP:"$PORTA" -sTCP:LISTEN -F p 2>/dev/null | sed -n 's/^p//p' | head -n 1 || true
}

comando_do_pid() {
  ps -p "$1" -o command= 2>/dev/null || true
}

# Só next-server / server.js / serve.sh contam como servidor do Bruto.
comando_e_do_bruto() {
  case "$1" in
    *next-server* | *server.js* | *serve.sh*) return 0 ;;
    *) return 1 ;;
  esac
}

json_campo() {
  printf '%s' "$1" | sed -n 's/.*"'"$2"'"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1
}

# --- listar (somente leitura) -------------------------------------------------
listar() {
  mkdir -p "$MESA"
  local saida="$MESA/bruto-listagem-$DATA.txt"
  : >"$saida"

  # Cada linha de item sai como: etiqueta<TAB>caminho<TAB>tamanho.
  # É esse formato que o `limpar --listagem` lê (linhas com # são ignoradas).
  item() {
    printf '%s\t%s\t%s\n' "$1" "$2" "$3" | tee -a "$saida"
  }
  nota() {
    printf '%s\n' "$*" | tee -a "$saida"
  }

  nota "# Listagem do Bruto — $DATA — gerada por roteiro-macbook-air.sh listar"
  nota "# Linhas com etiqueta são lidas pelo 'limpar --listagem'; o resto é só leitura."
  nota ""

  nota "== Clone (instalação antiga por curl | bash) =="
  if [ -d "$CLONE" ]; then
    item "clone" "$CLONE" "$(du -sh "$CLONE" 2>/dev/null | awk '{print $1}') — pode ter .env e mudanças locais; o 'limpar' MOVE esta pasta, nunca apaga"
  else
    nota "não existe: $CLONE"
  fi
  nota ""

  nota "== Apps =="
  if [ -d "$APP_USUARIO" ]; then
    item "app-usuario" "$APP_USUARIO" "$(du -sh "$APP_USUARIO" 2>/dev/null | awk '{print $1}')"
  else
    nota "não existe: $APP_USUARIO (atalho da instalação por terminal)"
  fi
  if [ -d "$APP_SISTEMA" ]; then
    item "app-sistema" "$APP_SISTEMA" "$(du -sh "$APP_SISTEMA" 2>/dev/null | awk '{print $1}')"
  else
    nota "não existe: $APP_SISTEMA (app do .dmg)"
  fi
  nota ""

  nota "== Dados do Bruto (biblioteca e ferramentas) =="
  if [ -d "$DADOS" ]; then
    item "dados" "$DADOS" "$(du -sh "$DADOS" 2>/dev/null | awk '{print $1}') — conteúdo NÃO listado; o 'limpar' move esta pasta inteira, nunca apaga"
    find "$DADOS" -maxdepth 1 -mindepth 1 -type d 2>/dev/null | LC_ALL=C sort | while IFS= read -r sub; do
      nota "#   · $sub ($(du -sh "$sub" 2>/dev/null | awk '{print $1}'))"
    done
  else
    nota "não existe: $DADOS"
  fi
  nota ""

  nota "== Manifestos do host nativo ($ARQUIVO_HOST) =="
  local achou=0 pai alvo
  while IFS= read -r pai; do
    [ -n "$pai" ] || continue
    alvo="$pai/NativeMessagingHosts/$ARQUIVO_HOST"
    if [ -f "$alvo" ]; then
      item "manifesto" "$alvo" "$(du -sh "$alvo" 2>/dev/null | awk '{print $1}')"
      achou=1
    fi
  done <<EOF
$(diretorios_navegador)
EOF
  [ "$achou" -eq 1 ] || nota "nenhum manifesto encontrado (Chrome, Chromium, Edge, Brave)"
  nota ""

  nota "== Porta $PORTA =="
  local pid cmd
  pid="$(pid_na_porta)"
  if [ -n "$pid" ]; then
    cmd="$(comando_do_pid "$pid")"
    nota "# pid $pid: $cmd"
    if comando_e_do_bruto "$cmd"; then
      nota "#   · parece servidor DO BRUTO — o 'limpar' pode encerrá-lo (com confirmação)."
    else
      nota "#   · NÃO parece ser do Bruto — o 'limpar' NÃO encerra este processo."
    fi
  else
    nota "nada escutando na porta $PORTA"
  fi
  nota ""

  nota "== No PATH (só informativo: NÃO são do Bruto e NÃO serão removidos) =="
  local ferramenta onde
  for ferramenta in yt-dlp ffmpeg node uv; do
    onde="$(command -v "$ferramenta" 2>/dev/null || true)"
    if [ -n "$onde" ]; then
      nota "# $ferramenta em $onde"
    else
      nota "# $ferramenta: não encontrado no PATH"
    fi
  done
  nota ""

  nota "Listagem gravada em: $saida"
  return 0
}

# --- limpar (reversível; nunca apaga a biblioteca) ----------------------------
# Caminho é do Bruto só se for EXATAMENTE um dos alvos conhecidos (os
# manifestos: os quatro navegadores, nome fixo). Qualquer outra coisa numa
# linha com etiqueta reprova a rodada INTEIRA — nada é removido.
caminho_e_do_bruto() {
  local tag="$1" caminho="$2" pai
  case "$tag" in
    clone) [ "$caminho" = "$CLONE" ] ;;
    app-usuario) [ "$caminho" = "$APP_USUARIO" ] ;;
    app-sistema) [ "$caminho" = "$APP_SISTEMA" ] ;;
    dados) [ "$caminho" = "$DADOS" ] ;;
    manifesto)
      while IFS= read -r pai; do
        [ "$caminho" = "$pai/NativeMessagingHosts/$ARQUIVO_HOST" ] && return 0
      done <<EOF
$(diretorios_navegador)
EOF
      return 1
      ;;
    *) return 1 ;;
  esac
}

limpar() {
  local listagem=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --listagem)
        [ $# -ge 2 ] || { printf '✗ --listagem exige um arquivo\n' >&2; exit 1; }
        listagem="$2"
        shift 2
        ;;
      *)
        printf '✗ Opção desconhecida: %s (use --listagem <arquivo>)\n' "$1" >&2
        exit 1
        ;;
    esac
  done
  [ -n "$listagem" ] || { ajuda; exit 1; }
  [ -f "$listagem" ] || { printf '✗ Arquivo de listagem não encontrado: %s\n' "$listagem" >&2; exit 1; }
  if [ -d "$CLONE_MOVIDO" ]; then
    printf '✗ Já existe %s — não vou sobrescrever um backup anterior.\n' "$CLONE_MOVIDO" >&2
    printf '  Trate-o antes (rollback: mv %s %s) e rode de novo.\n' "$CLONE_MOVIDO" "$CLONE" >&2
    exit 1
  fi
  if [ -d "$DADOS_MOVIDO" ]; then
    printf '✗ Já existe %s — não vou sobrescrever um backup anterior.\n' "$DADOS_MOVIDO" >&2
    printf '  Trate-o antes (rollback: mv %s %s) e rode de novo.\n' "$DADOS_MOVIDO" "$DADOS" >&2
    exit 1
  fi

  # 1) valida TUDO antes de mexer em qualquer coisa.
  local recusas="" acoes="" tag caminho
  while IFS=$'\t' read -r tag caminho _ || [ -n "${tag:-}" ]; do
    [ -n "${tag:-}" ] || continue
    case "$tag" in
      clone | app-usuario | app-sistema | dados | manifesto) ;;
      *) continue ;; # comentário ou linha sem etiqueta: o limpar não lê
    esac
    if ! caminho_e_do_bruto "$tag" "$caminho"; then
      recusas="${recusas}  ✗ $tag $caminho\n"
    else
      acoes="${acoes}${tag}"$'\t'"${caminho}"$'\n'
    fi
  done <"$listagem"

  if [ -n "$recusas" ]; then
    printf '✗ Item(ns) na listagem que NÃO são do Bruto — NADA foi removido:\n' >&2
    printf '%b' "$recusas" >&2
    printf '  O arquivo pode ter sido editado à mão. Gere a listagem de novo com o subcomando listar.\n' >&2
    exit 1
  fi

  # 2) mostra o plano e pede a confirmação digitada.
  printf 'Plano (a partir de %s):\n' "$listagem"
  if [ -z "$acoes" ]; then
    printf '  · nada do Bruto para remover (a listagem não tem nenhum item).\n'
  else
    while IFS=$'\t' read -r tag caminho; do
      [ -n "${tag:-}" ] || continue
      case "$tag" in
        clone) printf '  · MOVER    %s → %s (pode ter .env e mudanças locais — NÃO é apagado)\n' "$caminho" "$CLONE_MOVIDO" ;;
        dados) printf '  · MOVER    %s → %s (a biblioteca NÃO é apagada)\n' "$caminho" "$DADOS_MOVIDO" ;;
        *) printf '  · REMOVER  %s (regenerável: o instalador/registrador recria)\n' "$caminho" ;;
      esac
    done <<EOF
$acoes
EOF
  fi
  printf 'Digite LIMPAR para confirmar: ' >&2
  local resposta=""
  read -r resposta || { printf '\n✗ Sem confirmação — nada foi removido.\n' >&2; exit 1; }
  [ "$resposta" = "LIMPAR" ] || { printf '✗ Confirmação errada ("%s") — nada foi removido. É preciso digitar LIMPAR.\n' "$resposta" >&2; exit 1; }

  # 3) servidor da porta: só se o comando for do Bruto, e com confirmação.
  local pid cmd
  pid="$(pid_na_porta)"
  if [ -n "$pid" ]; then
    cmd="$(comando_do_pid "$pid")"
    if comando_e_do_bruto "$cmd"; then
      printf 'A porta %s tem um servidor do Bruto (pid %s):\n  %s\n' "$PORTA" "$pid" "$cmd" >&2
      printf 'Encerrar agora para liberar a porta? [s/N] ' >&2
      local resp_serv=""
      read -r resp_serv || true
      case "$resp_serv" in
        s | S)
          if kill "$pid" 2>/dev/null; then
            printf '  · TERM enviado ao pid %s\n' "$pid"
          else
            printf '  ✗ não consegui encerrar o pid %s (Operation not permitted? relate — nada é contornado)\n' "$pid" >&2
          fi
          ;;
        *)
          printf '  · mantido no ar (pode continuar servindo da pasta antiga até ser fechado).\n' >&2
          ;;
      esac
    else
      printf 'porta %s: pid %s NÃO é do Bruto (%s) — não encerrado.\n' "$PORTA" "$pid" "$cmd" >&2
    fi
  fi

  # 4) executa: MOVE o que pode guardar dado da pessoa (clone e dados),
  #    remove só o que é regenerável (apps e manifestos).
  local rollbacks=""
  while IFS=$'\t' read -r tag caminho; do
    [ -n "${tag:-}" ] || continue
    case "$tag" in
      clone)
        if [ -e "$caminho" ]; then
          mv "$caminho" "$CLONE_MOVIDO"
          printf '  ✓ movido: %s → %s\n' "$caminho" "$CLONE_MOVIDO"
          rollbacks="${rollbacks}  mv ${CLONE_MOVIDO} ${CLONE}\n"
        else
          printf '  · já não existia: %s\n' "$caminho"
        fi
        ;;
      app-usuario | app-sistema)
        if [ -e "$caminho" ]; then
          rm -rf "$caminho"
          printf '  ✓ removido: %s\n' "$caminho"
        else
          printf '  · já não existia: %s\n' "$caminho"
        fi
        ;;
      manifesto)
        if [ -f "$caminho" ]; then
          rm -f "$caminho"
          printf '  ✓ removido: %s\n' "$caminho"
        else
          printf '  · já não existia: %s\n' "$caminho"
        fi
        ;;
      dados)
        if [ -d "$caminho" ]; then
          mv "$caminho" "$DADOS_MOVIDO"
          printf '  ✓ movido: %s → %s\n' "$caminho" "$DADOS_MOVIDO"
          rollbacks="${rollbacks}  mv ${DADOS_MOVIDO} ${DADOS}\n"
        else
          printf '  · já não existia: %s\n' "$caminho"
        fi
        ;;
    esac
  done <<EOF
$acoes
EOF

  printf '\nPronto. O que NÃO foi tocado: Homebrew, uv global, Node e tudo o mais\n'
  printf 'que estiver no PATH (yt-dlp, ffmpeg…) — não são do Bruto.\n'
  if [ -n "$rollbacks" ]; then
    printf 'Rollback (com o Bruto fechado), um comando por item movido:\n%b' "$rollbacks"
  fi
  return 0
}

# --- testar (roda DEPOIS de instalar o .dmg) ----------------------------------
testar() {
  mkdir -p "$MESA"
  local resumo="$MESA/bruto-teste-$DATA.txt"
  : >"$resumo"
  rel() { printf '%s\n' "$*" | tee -a "$resumo"; }

  rel "# Teste do Bruto (.dmg) — $DATA — gerado por roteiro-macbook-air.sh testar"

  [ -d "$APP_SISTEMA" ] || {
    rel "✗ o app não está em $APP_SISTEMA — instale o .dmg primeiro:"
    rel "  abrir o .dmg, arrastar o Bruto para a pasta Applications e fechar o .dmg."
    printf 'Teste abortado. Resumo em: %s\n' "$resumo"
    exit 1
  }
  rel ""
  rel "== App =="
  rel "app: $APP_SISTEMA ($(du -sh "$APP_SISTEMA" 2>/dev/null | awk '{print $1}'))"

  rel ""
  rel "== Quarentena (o aviso da Apple na primeira abertura) =="
  local quarentena=""
  if command -v xattr >/dev/null 2>&1; then
    if quarentena="$(xattr -p com.apple.quarantine "$APP_SISTEMA" 2>/dev/null)"; then
      rel "atributo com.apple.quarantine: PRESENTE ($quarentena) — é o esperado para quem recebeu/baixou o arquivo."
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
      rel "codesign --verify --deep --strict: ✓ assinatura íntegra"
    else
      rel "codesign --verify --deep --strict: ✗ FALHOU — rode manualmente e veja o erro:"
      rel "  codesign --verify --deep --strict --verbose=2 $APP_SISTEMA"
    fi
  else
    rel "codesign indisponível — assinatura não conferida."
  fi

  rel ""
  rel "== Abrir o app e esperar o servidor (até 90 s) =="
  open -a "$APP_SISTEMA"
  rel "open -a $APP_SISTEMA — disparado; esperando http://127.0.0.1:$PORTA/api/versao…"
  local json="" versao="" origem="" i=0
  while [ "$i" -lt 90 ]; do
    json="$(curl -fsS --max-time 3 "http://127.0.0.1:$PORTA/api/versao" 2>/dev/null || true)"
    [ -n "$json" ] && break
    sleep 1
    i=$((i + 1))
  done
  if [ -n "$json" ]; then
    versao="$(json_campo "$json" versao)"
    origem="$(json_campo "$json" origem)"
    rel "✓ servidor no ar em http://127.0.0.1:$PORTA — versão: ${versao:-?} · origem: ${origem:-?} · resposta: $json"
  else
    rel "✗ o servidor NÃO respondeu em 90 s."
    rel "  log do servidor: $DADOS/logs/servidor.log (copie as últimas linhas para o resumo)."
  fi

  rel ""
  rel "== Próximo passo =="
  rel "1. na janela que abriu, cole um vídeo curto do YouTube (uns 20 s) e processe."
  rel "2. espere os metadados, a legenda, o resumo, o mapa e a categoria."
  rel "3. exporte o resumo (o primeiro export baixa o navegador que gera os arquivos)."
  rel "log do servidor, se algo estranho acontecer: $DADOS/logs/servidor.log"

  printf '\nResumo gravado em: %s — mande este arquivo de volta.\n' "$resumo"
  if [ -z "$json" ]; then
    exit 1
  fi
  return 0
}

# --- guarda-livros ------------------------------------------------------------
case "${1:-}" in
  listar) shift; [ $# -eq 0 ] || { printf '✗ listar não aceita opções\n' >&2; exit 1; }; listar ;;
  limpar) shift; limpar "$@" ;;
  testar) shift; [ $# -eq 0 ] || { printf '✗ testar não aceita opções\n' >&2; exit 1; }; testar ;;
  --ajuda | -h | ajuda) ajuda ;;
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
