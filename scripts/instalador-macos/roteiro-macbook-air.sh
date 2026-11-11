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
#             (reversível com o subcomando `restaurar`).
#   testar  — depois de instalar o .dmg em /Applications: quarentena,
#             assinatura, abre o app e espera /api/versao (até 90 s). SÓ
#             aprova com JSON válido, app=bruto, origem=pacote e versão
#             igual à do Info.plist do app instalado; qualquer outra coisa
#             é REPROVADO (exit ≠ 0, motivo no resumo). Grava o resumo em
#             ~/Desktop/bruto-teste-<data>.txt
#   restaurar — desfaz o `limpar` DEPOIS do teste, no estado em que a
#             máquina está: o app pode ter recriado ~/.bruto e ~/Bruto, e um
#             `mv` solto poria o backup DENTRO da pasta nova. O restaurar
#             preserva o que o teste recriou em <nome>-do-teste-<data> (nada
#             é apagado) e devolve o backup -antes-do-teste-<data> ao lugar.
#
# Regras que este script cumpre (e não contorna):
# - Nunca sudo. Nunca toca no Homebrew, no uv global nem no Node do sistema.
# - yt-dlp/ffmpeg/node/uv achados no PATH NÃO são do Bruto: só aparecem como
#   informação no `listar` e nunca são removidos.
# - O servidor da porta SÓ é encerrado se a identidade for PROVADA: o
#   executável (comando completo) ou o cwd (lsof -p <pid> -a -d cwd) dentro
#   de um caminho do Bruto (/Applications/Bruto.app, ~/Applications/Bruto.app
#   ou ~/Bruto) E, respondendo /api/versao, app=bruto. O nome no comando
#   (server.js, next-server, serve.sh) NÃO prova nada — qualquer dúvida
#   significa NÃO é do Bruto, e nada é encerrado.
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
CLONE_DO_TESTE="$HOME/Bruto-do-teste-$DATA"
APP_USUARIO="$HOME/Applications/Bruto.app"
DADOS="${BRUTO_DATA_ROOT:-$HOME/.bruto}"
DADOS_MOVIDO="$HOME/.bruto-antes-do-teste-$DATA"
DADOS_DO_TESTE="$HOME/.bruto-do-teste-$DATA"
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
      apagados: são MOVIDOS para $CLONE_MOVIDO e $DADOS_MOVIDO (para
      desfazer, use o subcomando restaurar). Se um backup datado de hoje
      já existe, a rodada é recusada antes de mexer em qualquer coisa. O
      servidor da porta $PORTA só é encerrado se a identidade for PROVADA
      (executável/cwd num caminho do Bruto e, respondendo /api/versao,
      app=bruto), com confirmação. Pede a confirmação digitada LIMPAR
      antes de qualquer remoção. Nunca usa sudo.

  testar
      Depois de instalar o .dmg em $APP_SISTEMA: confere o atributo de
      quarentena e informa o que a pessoa vai ver, verifica a assinatura
      (codesign), abre o app e espera /api/versao por até 90 s. SÓ aprova
      se a resposta for JSON válido (parser real: plutil) com app=bruto,
      origem=pacote e versão igual à do Info.plist do app instalado —
      qualquer outra coisa REPROVA o teste (exit ≠ 0, motivo no resumo).
      Diz o próximo passo e onde está o log ($DADOS/logs/servidor.log).
      Grava o resumo em $MESA/bruto-teste-$DATA.txt.

  restaurar
      Desfaz o `limpar` DEPOIS do teste, no estado em que a máquina está:
      o app do teste pode ter recriado $DADOS e $CLONE — e um mv solto
      poria o backup DENTRO da pasta nova. O restaurar fecha o servidor
      do Bruto da porta $PORTA (só o PROVADO, com confirmação; recusar
      fechar ABORTA sem mover nada), MOVE o que o teste recriou para
      $DADOS_DO_TESTE e $CLONE_DO_TESTE (nada é apagado) e devolve os
      backups -antes-do-teste-$DATA ao lugar. Recusa a rodada inteira se
      algum destino -do-teste- de hoje já existir (antes de mexer em
      qualquer coisa).

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

# cwd REAL do processo, medido pelo lsof (lsof não existe ou não acha nada →
# saída vazia, que conta como "sem essa prova" — nunca reprova sozinha).
cwd_do_pid() {
  lsof -p "$1" -a -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1 || true
}

# Caminho físico (symlinks do diretório resolvidos). No macOS o lsof devolve
# o caminho RESOLVIDO (/private/var/… enquanto o $HOME pode aparecer como
# /var/…) — sem comparar as duas formas, a prova do cwd falharia em falso.
# Diretório inexistente → devolve o caminho como veio (a forma crua ainda é
# comparada em prefixo_do_bruto).
caminho_fisico() {
  local dir nome
  dir="$(dirname -- "$1")"
  nome="$(basename -- "$1")"
  if (cd -- "$dir" 2>/dev/null); then
    (cd -- "$dir" && printf '%s/%s\n' "$(pwd -P)" "$nome")
  else
    printf '%s\n' "$1"
  fi
}

APP_SISTEMA_FIS="$(caminho_fisico "$APP_SISTEMA")"
APP_USUARIO_FIS="$(caminho_fisico "$APP_USUARIO")"
CLONE_FIS="$(caminho_fisico "$CLONE")"

# Caminho está DENTRO de um dos alvos do Bruto (o app do sistema, o app do
# usuário ou o clone)? Exato ou com qualquer profundidade abaixo — na forma
# crua OU na física (a prova do cwd vem resolvida pelo lsof).
prefixo_do_bruto() {
  case "$1" in
    "$APP_SISTEMA" | "$APP_SISTEMA"/*) return 0 ;;
    "$APP_USUARIO" | "$APP_USUARIO"/*) return 0 ;;
    "$CLONE" | "$CLONE"/*) return 0 ;;
  esac
  local fis=""
  fis="$(caminho_fisico "$1")"
  case "$fis" in
    "$APP_SISTEMA_FIS" | "$APP_SISTEMA_FIS"/*) return 0 ;;
    "$APP_USUARIO_FIS" | "$APP_USUARIO_FIS"/*) return 0 ;;
    "$CLONE_FIS" | "$CLONE_FIS"/*) return 0 ;;
    *) return 1 ;;
  esac
}

# Campo de um corpo JSON, com parser DE VERDADE: o corpo vai para um arquivo
# e o plutil (CoreFoundation, presente em todo macOS) extrai a chave. Não
# usamos o python3 do sistema porque ele só existe com Command Line Tools
# instaladas — a máquina da pessoa pode não ter. JSON inválido ou chave
# ausente → saída vazia (quem chama trata como falta de prova).
json_campo_plist() {
  local corpo="$1" campo="$2" arq=""
  arq="$(mktemp "${TMPDIR:-/tmp}/bruto-json.XXXXXX")" || return 1
  printf '%s' "$corpo" >"$arq"
  plutil -extract "$campo" raw "$arq" 2>/dev/null || true
  rm -f "$arq"
}

# Identidade do servidor da porta — CLASSE AA: só age sobre processo cuja
# identidade foi PROVADA, nunca adivinhada pelo nome no comando. Provas:
#   (1) o PID escuta na porta;
#   (2) o comando completo (ps) OU o cwd (lsof) aponta para um caminho do
#       Bruto — /Applications/Bruto.app, ~/Applications/Bruto.app ou ~/Bruto;
#   (3) se a porta responder /api/versao, o campo app tem de ser "bruto".
# Qualquer dúvida → SERV_PROVADO=0 com o motivo em SERV_MOTIVO. Nunca falha
# a rodada (sempre retorna 0; o chamador decide olhando as variáveis).
analisar_servidor_da_porta() {
  SERV_PID="" SERV_CMD="" SERV_CWD="" SERV_PROVADO=0 SERV_MOTIVO=""
  SERV_PID="$(pid_na_porta)"
  [ -n "$SERV_PID" ] || {
    SERV_MOTIVO="nada escutando na porta $PORTA"
    return 0
  }
  SERV_CMD="$(comando_do_pid "$SERV_PID")"
  SERV_CWD="$(cwd_do_pid "$SERV_PID")"

  local token prova_caminho=""
  for token in $SERV_CMD; do
    case "$token" in
      /*)
        if prefixo_do_bruto "$token"; then
          prova_caminho="comando: $token"
          break
        fi
        ;;
    esac
  done
  if [ -z "$prova_caminho" ] && [ -n "$SERV_CWD" ] && prefixo_do_bruto "$SERV_CWD"; then
    prova_caminho="cwd: $SERV_CWD"
  fi
  if [ -z "$prova_caminho" ]; then
    SERV_MOTIVO="nem o comando nem o cwd apontam para um caminho do Bruto (comando: ${SERV_CMD:-?} · cwd: ${SERV_CWD:-?}) — o nome no comando (server.js, next-server…) não prova nada"
    return 0
  fi

  local resposta=""
  resposta="$(curl -fsS --max-time 3 "http://127.0.0.1:$PORTA/api/versao" 2>/dev/null || true)"
  if [ -n "$resposta" ]; then
    local app=""
    app="$(json_campo_plist "$resposta" app)"
    if [ "$app" != "bruto" ]; then
      SERV_MOTIVO="o caminho é do Bruto ($prova_caminho), mas /api/versao respondeu app=${app:-?} (≠ bruto) — dúvida não é prova"
      return 0
    fi
    SERV_MOTIVO="$prova_caminho · /api/versao: app=bruto"
  else
    SERV_MOTIVO="$prova_caminho · /api/versao: sem resposta (a prova é o caminho)"
  fi
  SERV_PROVADO=1
  return 0
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
  analisar_servidor_da_porta
  if [ -n "$SERV_PID" ]; then
    nota "# pid $SERV_PID: $SERV_CMD"
    if [ "$SERV_PROVADO" = "1" ]; then
      nota "#   · PROVADO servidor DO BRUTO — provas: $SERV_MOTIVO. O 'limpar' pode encerrá-lo (com confirmação)."
    else
      nota "#   · NÃO provado ser do Bruto — o 'limpar' NÃO encerra este processo."
      nota "#     motivo: $SERV_MOTIVO"
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

  # 3) servidor da porta: só o de identidade PROVADA (classe AA), e com
  #    confirmação. Dúvida → não é do Bruto, não se oferece encerrar.
  analisar_servidor_da_porta
  if [ -n "$SERV_PID" ]; then
    if [ "$SERV_PROVADO" = "1" ]; then
      printf 'A porta %s tem um servidor PROVADO do Bruto (pid %s):\n  %s\n  provas: %s\n' "$PORTA" "$SERV_PID" "$SERV_CMD" "$SERV_MOTIVO" >&2
      printf 'Encerrar agora para liberar a porta? [s/N] ' >&2
      local resp_serv=""
      read -r resp_serv || true
      case "$resp_serv" in
        s | S)
          if kill "$SERV_PID" 2>/dev/null; then
            printf '  · TERM enviado ao pid %s\n' "$SERV_PID"
          else
            printf '  ✗ não consegui encerrar o pid %s (Operation not permitted? relate — nada é contornado)\n' "$SERV_PID" >&2
          fi
          ;;
        *)
          printf '  · mantido no ar (pode continuar servindo da pasta antiga até ser fechado).\n' >&2
          ;;
      esac
    else
      printf 'porta %s: pid %s NÃO provado ser do Bruto — não encerrado.\n  motivo: %s\n' "$PORTA" "$SERV_PID" "$SERV_MOTIVO" >&2
    fi
  fi

  # 4) executa: MOVE o que pode guardar dado da pessoa (clone e dados),
  #    remove só o que é regenerável (apps e manifestos).
  local moveu=""
  while IFS=$'\t' read -r tag caminho; do
    [ -n "${tag:-}" ] || continue
    case "$tag" in
      clone)
        if [ -e "$caminho" ]; then
          mv "$caminho" "$CLONE_MOVIDO"
          printf '  ✓ movido: %s → %s\n' "$caminho" "$CLONE_MOVIDO"
          moveu=1
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
          moveu=1
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
  if [ -n "$moveu" ]; then
    printf 'Para desfazer (depois do teste): bash roteiro-macbook-air.sh restaurar\n'
    printf '  (o restaurar preserva o que o teste recriar em *-do-teste-%s antes de\n' "$DATA"
    printf '   devolver os backups ao lugar — nada é apagado)\n'
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

  # A versão esperada é a do app INSTALADO — a única que este teste pode
  # aprovar (BB: `testar` só aprova o que provou).
  local versao_esperada=""
  versao_esperada="$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$APP_SISTEMA/Contents/Info.plist" 2>/dev/null | tr -d '\r\n' || true)"

  local json="" i=0
  while [ "$i" -lt 90 ]; do
    json="$(curl -fsS --max-time 3 "http://127.0.0.1:$PORTA/api/versao" 2>/dev/null || true)"
    [ -n "$json" ] && break
    sleep 1
    i=$((i + 1))
  done

  if [ -z "$json" ]; then
    rel "✗ REPROVADO: o servidor NÃO respondeu em 90 s — nada é aprovado sem prova."
    rel "  log do servidor: $DADOS/logs/servidor.log (copie as últimas linhas para o resumo)."
    printf '\nTeste REPROVADO (motivo no resumo). Resumo em: %s — mande este arquivo de volta.\n' "$resumo"
    exit 1
  fi
  rel "resposta recebida de /api/versao: $json"

  # Validação com parser REAL (plutil/CoreFoundation) — nunca sed. python3
  # do sistema não é usado: só existe com Command Line Tools.
  local app="" versao="" origem="" reprovado=""
  app="$(json_campo_plist "$json" app)"
  versao="$(json_campo_plist "$json" versao)"
  origem="$(json_campo_plist "$json" origem)"
  if [ -z "$app" ] && [ -z "$versao" ] && [ -z "$origem" ]; then
    reprovado="o corpo de /api/versao não é JSON válido (ou não tem NENHUM dos campos app/versao/origem) — resposta: $json"
  elif [ -z "$versao_esperada" ]; then
    reprovado="não consegui ler a versão esperada do app instalado (/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' $APP_SISTEMA/Contents/Info.plist)"
  elif [ "$app" != "bruto" ]; then
    reprovado="/api/versao respondeu app=${app:-?} — só se aprova app=bruto"
  elif [ "$origem" != "pacote" ]; then
    reprovado="/api/versao respondeu origem=${origem:-?} — o servidor da porta NÃO provou ser o do pacote (.dmg)"
  elif [ "$versao" != "$versao_esperada" ]; then
    reprovado="/api/versao respondeu versao=$versao, mas o app instalado diz $versao_esperada (CFBundleShortVersionString do Info.plist)"
  fi
  if [ -n "$reprovado" ]; then
    rel "✗ REPROVADO: $reprovado"
    printf '\nTeste REPROVADO (motivo no resumo). Resumo em: %s — mande este arquivo de volta.\n' "$resumo"
    exit 1
  fi
  rel "✓ PROVADO servidor do pacote no ar em http://127.0.0.1:$PORTA —"
  rel "  app: bruto · origem: pacote · versão: $versao (igual à do Info.plist do app instalado)."

  rel ""
  rel "== Próximo passo =="
  rel "1. na janela que abriu, cole um vídeo curto do YouTube (uns 20 s) e processe."
  rel "2. espere os metadados, a legenda, o resumo, o mapa e a categoria."
  rel "3. exporte o resumo (o primeiro export baixa o navegador que gera os arquivos)."
  rel "log do servidor, se algo estranho acontecer: $DADOS/logs/servidor.log"

  printf '\nResumo gravado em: %s — mande este arquivo de volta.\n' "$resumo"
  return 0
}

# --- restaurar (classe CC: rollback seguro no estado em que a pessoa está) ----
# O `limpar` move clone e dados para *-antes-do-teste-<data>. Depois do
# `testar`, o app pode ter RECREADO ~/.bruto e ~/Bruto — um `mv` solto para
# copiar e colar poria o backup DENTRO da pasta nova (achado 3 da rodada 3).
# O restaurar preserva a pasta recriada em *-do-teste-<data> (nada é apagado)
# antes de devolver o backup ao lugar, e recusa a rodada inteira se não
# conseguir preservar.
restaurar() {
  # 1) valida TUDO antes de mexer em qualquer coisa.
  local recusas=""
  if [ -d "$DADOS_MOVIDO" ] && [ -e "$DADOS" ] && [ -e "$DADOS_DO_TESTE" ]; then
    recusas="${recusas}  ✗ já existe $DADOS_DO_TESTE — não vou sobrescrever o que uma restauração anterior preservou.\n"
  fi
  if [ -d "$CLONE_MOVIDO" ] && [ -e "$CLONE" ] && [ -e "$CLONE_DO_TESTE" ]; then
    recusas="${recusas}  ✗ já existe $CLONE_DO_TESTE — não vou sobrescrever o que uma restauração anterior preservou.\n"
  fi
  if [ -n "$recusas" ]; then
    printf '✗ Restauração RECUSADA — NADA foi movido:\n%b' "$recusas" >&2
    printf '  Trate a(s) pasta(s) -do-teste-%s antes de rodar o restaurar de novo.\n' "$DATA" >&2
    exit 1
  fi

  # 2) servidor do Bruto na porta: só o PROVADO (classe AA), com confirmação.
  #    Restaurar por cima de um servidor no ar é o cenário perigoso — recusar
  #    fechar ABORTA a rodada inteira, sem mover nada.
  analisar_servidor_da_porta
  if [ -n "$SERV_PID" ]; then
    if [ "$SERV_PROVADO" = "1" ]; then
      printf 'A porta %s tem um servidor PROVADO do Bruto (pid %s):\n  %s\n  provas: %s\n' "$PORTA" "$SERV_PID" "$SERV_CMD" "$SERV_MOTIVO" >&2
      printf 'Fechar agora para restaurar? [s/N] ' >&2
      local resp=""
      read -r resp || true
      case "$resp" in
        s | S)
          if ! kill "$SERV_PID" 2>/dev/null; then
            printf '✗ não consegui encerrar o pid %s — nada foi movido (relate; nada é contornado).\n' "$SERV_PID" >&2
            exit 1
          fi
          local i=0
          while kill -0 "$SERV_PID" 2>/dev/null && [ "$i" -lt 50 ]; do
            sleep 0.1
            i=$((i + 1))
          done
          if kill -0 "$SERV_PID" 2>/dev/null; then
            printf '✗ o pid %s não saiu em 5 s — nada foi movido (relate; nada é contornado).\n' "$SERV_PID" >&2
            exit 1
          fi
          printf '  · servidor do Bruto encerrado (pid %s)\n' "$SERV_PID"
          ;;
        *)
          printf '✗ restaurar ABORTADO sem mover nada: restaurar com o servidor do Bruto no ar pode corromper a biblioteca. Feche-o e rode de novo.\n' >&2
          exit 1
          ;;
      esac
    else
      printf 'porta %s: pid %s NÃO provado ser do Bruto — deixado no ar. Motivo: %s\n' "$PORTA" "$SERV_PID" "$SERV_MOTIVO" >&2
    fi
  fi

  # 3) executa: preserva o que o teste recriou e devolve os backups.
  local restaurou=0
  if [ -d "$DADOS_MOVIDO" ]; then
    if [ -e "$DADOS" ]; then
      mv "$DADOS" "$DADOS_DO_TESTE"
      printf '  ✓ preservada a pasta recriada pelo teste: %s → %s\n' "$DADOS" "$DADOS_DO_TESTE"
    fi
    mv "$DADOS_MOVIDO" "$DADOS"
    printf '  ✓ biblioteca de volta: %s → %s\n' "$DADOS_MOVIDO" "$DADOS"
    restaurou=1
  else
    printf '  · sem backup de %s (nada para restaurar dele)\n' "$DADOS_MOVIDO"
  fi
  if [ -d "$CLONE_MOVIDO" ]; then
    if [ -e "$CLONE" ]; then
      mv "$CLONE" "$CLONE_DO_TESTE"
      printf '  ✓ preservada a pasta recriada pelo teste: %s → %s\n' "$CLONE" "$CLONE_DO_TESTE"
    fi
    mv "$CLONE_MOVIDO" "$CLONE"
    printf '  ✓ clone de volta: %s → %s\n' "$CLONE_MOVIDO" "$CLONE"
    restaurou=1
  else
    printf '  · sem backup de %s (nada para restaurar dele)\n' "$CLONE_MOVIDO"
  fi

  if [ "$restaurou" -eq 1 ]; then
    printf '\nPronto. As pastas *-do-teste-%s guardam o que o teste recriou — NADA foi apagado.\n' "$DATA"
  else
    printf '\nNada para restaurar: não existe %s nem %s\n' "$DADOS_MOVIDO" "$CLONE_MOVIDO"
    printf '(o limpar de hoje não moveu nada, ou já foi restaurado).\n'
  fi
  return 0
}

# --- guarda-livros ------------------------------------------------------------
case "${1:-}" in
  listar) shift; [ $# -eq 0 ] || { printf '✗ listar não aceita opções\n' >&2; exit 1; }; listar ;;
  limpar) shift; limpar "$@" ;;
  testar) shift; [ $# -eq 0 ] || { printf '✗ testar não aceita opções\n' >&2; exit 1; }; testar ;;
  restaurar) shift; [ $# -eq 0 ] || { printf '✗ restaurar não aceita opções\n' >&2; exit 1; }; restaurar ;;
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
