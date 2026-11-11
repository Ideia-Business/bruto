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
#             e a rodada fica REGISTRADA em ~/.bruto-roteiro/rodada-<carimbo>.txt
#             (modo 600; é esse registro que o `restaurar` desfaz).
#   testar  — depois de instalar o .dmg em /Applications: quarentena,
#             assinatura, abre o app e espera /api/versao (até 90 s). SÓ
#             aprova com JSON ESTRITO (JSON.parse de verdade) — app=bruto,
#             origem=pacote e versão igual à do Info.plist do app instalado.
#             Corpo plist/XML/HTML/texto, ou qualquer campo errado, é
#             REPROVADO (exit ≠ 0, motivo no resumo). Grava o resumo em
#             ~/Desktop/bruto-teste-<data>.txt
#   restaurar — desfaz a RODADA registrada pelo `limpar` (a mais recente em
#             ~/.bruto-roteiro/, ou a escolhida com --rodada <arquivo>), NÃO
#             "a data de hoje": o que o teste recriou é preservado em
#             <nome>-do-teste-<data> (nada é apagado) e o backup registrado
#             volta ao lugar. Sem registro nenhum o restaurar FALHA
#             explicando — e listando os backups *-antes-do-teste-* que
#             houver no HOME. Nunca "nada para restaurar" com sucesso.
#
# Regras que este script cumpre (e não contorna):
# - Nunca sudo. Nunca toca no Homebrew, no uv global nem no Node do sistema.
# - yt-dlp/ffmpeg/node/uv achados no PATH NÃO são do Bruto: só aparecem como
#   informação no `listar` e nunca são removidos.
# - O roteiro NUNCA envia sinal a processo nenhum — não encerra nada, de
#   ninguém, por melhor que a "prova de identidade" pareça. `limpar` e
#   `restaurar` RECUSAM rodar (exit ≠ 0, nada alterado) se: algo escuta na
#   porta; há processo com Bruto.app no caminho do executável; ou o clone
#   ~/Bruto é cwd de algum processo. A mensagem diz COMO a pessoa fecha
#   (Cmd+Q no Bruto; fechar a janela do Terminal onde rodou o serve.sh; se
#   não souber, reiniciar o Mac) e manda rodar de novo. O `listar` só
#   informa o que escuta na porta (PID e comando), sem julgar se é do Bruto.
# - Item de listagem que não é do Bruto (ex.: alguém editou o arquivo e pôs
#   ~/Documents) reprova a rodada inteira: NADA é removido.
#
# Variáveis de ambiente que desviam alvos SEM mudar comportamento (para os
# testes automatizados, que não podem usar a porta 3000 nem /Applications):
# BRUTO_ROTEIRO_PORTA (default 3000), BRUTO_ROTEIRO_APP_SISTEMA (default
# /Applications/Bruto.app), BRUTO_ROTEIRO_DATA (default: hoje) e
# BRUTO_DATA_ROOT (default ~/.bruto).

set -euo pipefail

DATA="${BRUTO_ROTEIRO_DATA:-$(date +%Y-%m-%d)}"
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
DIR_RODADAS="$HOME/.bruto-roteiro"
CARIMBO="${DATA}-$(date +%H%M%S)"
RODADA_ATUAL="$DIR_RODADAS/rodada-$CARIMBO.txt"

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
      NÃO serão removidos).
      Grava a lista em $MESA/bruto-listagem-$DATA.txt.

  limpar --listagem <arquivo>
      Remove EXATAMENTE os itens do arquivo de listagem que sejam do Bruto
      — mas só o que é regenerável sem perda: os dois Bruto.app e os
      manifestos do host (o instalador/registrador os recria). O clone
      ($CLONE — pode ter .env e mudanças locais) e $DADOS NUNCA são
      apagados: são MOVIDOS para $CLONE_MOVIDO e $DADOS_MOVIDO, e a rodada
      é REGISTRADA em $DIR_RODADAS/rodada-<carimbo>.txt (modo 600; é o
      registro que o subcomando restaurar desfaz). Se já existe qualquer
      backup *-antes-do-teste-* no HOME, a rodada é recusada antes de
      mexer em qualquer coisa (restaure a rodada anterior primeiro).
      RECUSA rodar (nada é alterado) se algo escuta na porta $PORTA, se há
      processo com Bruto.app no caminho do executável ou se $CLONE é cwd
      de algum processo — este roteiro NUNCA encerra processos; a saída diz
      COMO fechar (Cmd+Q no Bruto; fechar a janela do Terminal onde rodou
      o serve.sh; se não souber, reiniciar o Mac) e manda rodar de novo.
      Pede a confirmação digitada LIMPAR antes de qualquer remoção.
      Nunca usa sudo.

  testar
      Depois de instalar o .dmg em $APP_SISTEMA: confere o atributo de
      quarentena e informa o que a pessoa vai ver, verifica a assinatura
      (codesign), abre o app e espera /api/versao por até 90 s. SÓ aprova
      se a resposta for JSON ESTRITO — validado com JSON.parse de verdade
      (osascript -l JavaScript), e o resultado tem de ser um objeto;
      plist/XML/HTML/texto NÃO valem — com app=bruto, origem=pacote e
      versão igual à do Info.plist do app instalado. Qualquer outra coisa
      REPROVA o teste (exit ≠ 0, motivo no resumo). Diz o próximo passo e
      onde está o log ($DADOS/logs/servidor.log).
      Grava o resumo em $MESA/bruto-teste-$DATA.txt.

  restaurar [--rodada <arquivo>]
      Desfaz a RODADA que o `limpar` registrou — a mais recente em
      $DIR_RODADAS/rodada-*.txt, ou a do arquivo passado com --rodada — e
      não "a data de hoje". O app do teste pode ter recriado $DADOS e
      $CLONE: o restaurar preserva o recriado em <nome>-do-teste-$DATA
      (nada é apagado) e devolve o backup registrado ao lugar. RECUSA a
      rodada inteira se algum destino -do-teste- de hoje já existir, se um
      item do registro não puder ser tratado, ou se a máquina estiver
      ocupada (porta $PORTA, processo com Bruto.app, cwd no $CLONE) —
      nunca encerra nada; a saída diz como fechar. Sem registro nenhum:
      FALHA (exit ≠ 0) explicando e listando os backups
      *-antes-do-teste-* que houver no HOME — nunca "nada para restaurar"
      com sucesso.

Variáveis de ambiente (testes): BRUTO_ROTEIRO_PORTA (default 3000),
BRUTO_ROTEIRO_APP_SISTEMA (default /Applications/Bruto.app),
BRUTO_ROTEIRO_DATA (default: hoje), BRUTO_DATA_ROOT (default ~/.bruto).
EOF
}

# --- sondas -------------------------------------------------------------------

# PIDs de TUDO que escuta na porta (lsof não existe ou não acha nada →
# saída vazia; nunca falha a rodada).
pids_na_porta() {
  lsof -nP -iTCP:"$PORTA" -sTCP:LISTEN -F p 2>/dev/null | sed -n 's/^p//p' || true
}

comando_do_pid() {
  ps -p "$1" -o command= 2>/dev/null || true
}

# Caminho físico (symlinks do diretório resolvidos). No macOS o lsof devolve
# o caminho RESOLVIDO (/private/var/… enquanto o $HOME pode aparecer como
# /var/…) — sem comparar as duas formas, o casamento do cwd falharia em
# falso. Diretório inexistente → devolve o caminho como veio (a forma crua
# ainda é comparada no case).
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

CLONE_FIS="$(caminho_fisico "$CLONE")"

# Linhas de comando que passam por um Bruto.app (o app instalado, aberto).
# O "[B]" na expressão evita que a própria procura apareça no resultado.
# Best effort: ps indisponível → saída vazia.
processos_com_bruto_app() {
  ps -axo command= 2>/dev/null | grep -- '[B]ruto\.app' || true
}

# cwds de processos DENTRO do clone ~/Bruto (o servidor do clone rodando de
# lá, um editor aberto…). Best effort: lsof indisponível → saída vazia.
cwds_no_clone() {
  lsof -nP -a -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | while IFS= read -r um; do
    case "$um" in
      "$CLONE" | "$CLONE"/*) printf '%s\n' "$um" ;;
      "$CLONE_FIS" | "$CLONE_FIS"/*) printf '%s\n' "$um" ;;
    esac
  done || true
}

# EE — como fechar o que está aberto. O roteiro NUNCA encerra processo
# nenhum: ele diz o caminho e a pessoa fecha.
como_fechar() {
  printf '  Como fechar, para rodar de novo:\n' >&2
  printf '    1. o Bruto está aberto? Clique nele e saia com Cmd+Q (fechar só a janela não fecha o app);\n' >&2
  printf '    2. rodou o serve.sh do clone noutra janela do Terminal? Feche AQUELA janela (Cmd+W) ou pare o comando com Ctrl+C nela;\n' >&2
  printf '    3. se não souber o que está aberto: reinicie o Mac — é a forma mais simples de garantir.\n' >&2
  printf '  Feche e rode o MESMO comando de novo.\n' >&2
}

# EE — limpar/restaurar só rodam com a máquina parada. Qualquer ocupação
# recusa a rodada INTEIRA (exit ≠ 0) antes de mexer em qualquer coisa.
exigir_maquina_parada() {
  local pid="" achou=""
  for pid in $(pids_na_porta); do
    [ -n "$pid" ] || continue
    printf '✗ O roteiro NUNCA encerra processos — e algo escuta na porta %s:\n' "$PORTA" >&2
    printf '    pid %s: %s\n' "$pid" "$(comando_do_pid "$pid")" >&2
    como_fechar
    exit 1
  done
  achou="$(processos_com_bruto_app | head -n 1 || true)"
  if [ -n "$achou" ]; then
    printf '✗ O roteiro NUNCA encerra processos — e há processo com Bruto.app no caminho do executável (o app aberto?):\n' >&2
    processos_com_bruto_app | sed 's/^/    /' >&2
    como_fechar
    exit 1
  fi
  achou="$(cwds_no_clone | head -n 1 || true)"
  if [ -n "$achou" ]; then
    printf '✗ O roteiro NUNCA encerra processos — e há processo rodando com diretório de trabalho (cwd) DENTRO de %s:\n' "$CLONE" >&2
    printf '    cwd: %s\n' "$achou" >&2
    como_fechar
    exit 1
  fi
}

# FF — registro de rodada mais recente (vazio se não houver nenhum).
registro_mais_recente() {
  [ -d "$DIR_RODADAS" ] || return 1
  find "$DIR_RODADAS" -maxdepth 1 -name 'rodada-*.txt' 2>/dev/null | LC_ALL=C sort | tail -n 1
}

# GG — validação ESTRITA de JSON: JSON.parse de verdade (osascript -l
# JavaScript, presente em todo macOS) sobre o corpo lido de ARQUIVO, e o
# resultado só vale se for um OBJETO. Devolve uma linha:
#   "JSON\t<app>\t<versao>\t<origem>" — objeto JSON válido, campos extraídos
#   "NAO_JSON"                       — plist/XML/HTML/texto/escalar
#   "ERRO_LER"                       — nem conseguiu ler o arquivo
# plutil NÃO serve aqui: parser de plist aprova corpo plist (achado da
# rodada 4). python3 do sistema não é usado: só existe com Command Line
# Tools instaladas — a máquina da pessoa pode não ter.
JSON_ESTRITO_JS='function run(argv) {
  var app = Application.currentApplication();
  app.includeStandardAdditions = true;
  var corpo = "";
  try { corpo = app.read(Path(argv[0])); } catch (e) { return "ERRO_LER"; }
  var obj = null;
  try { obj = JSON.parse(corpo); } catch (e) { return "NAO_JSON"; }
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) { return "NAO_JSON"; }
  function campo(k) { var v = obj[k]; return (typeof v === "string") ? v : ""; }
  return ["JSON", campo("app"), campo("versao"), campo("origem")].join("\t");
}'

json_estrito() {
  osascript -l JavaScript -e "$JSON_ESTRITO_JS" "$1" 2>/dev/null || true
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

  # EE — só informa PID e comando; o julgamento "é do Bruto?" não existe
  # mais (era a porta de entrada para encerrar processo).
  nota "== Porta $PORTA =="
  local pid="" viu=0
  for pid in $(pids_na_porta); do
    viu=1
    nota "# pid $pid: $(comando_do_pid "$pid")"
  done
  if [ "$viu" -eq 1 ]; then
    nota "# (o roteiro NUNCA encerra processos — só informa. O limpar/restaurar"
    nota "#  RECUSAM rodar com esta porta ocupada: feche o que a usa e rode de novo.)"
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

  # 0) EE — nada roda com a máquina ocupada. O roteiro NUNCA encerra
  #    processos: a recusa diz como fechar e manda rodar de novo.
  exigir_maquina_parada

  # 0.1) backup de rodada anterior ainda no HOME → recusa antes de mexer em
  #      qualquer coisa (desfaça a rodada anterior com o restaurar).
  local anteriores="" um=""
  anteriores="$(find "$HOME" -maxdepth 1 -name '*-antes-do-teste-*' 2>/dev/null | LC_ALL=C sort)"
  if [ -n "$anteriores" ]; then
    printf '✗ Já existe backup de rodada anterior — não vou sobrescrever um backup anterior:\n' >&2
    while IFS= read -r um; do
      [ -n "$um" ] || continue
      printf '  · %s\n' "$um" >&2
    done <<EOF
$anteriores
EOF
    printf '  Desfaça a rodada anterior primeiro (bash roteiro-macbook-air.sh restaurar) e rode de novo.\n' >&2
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

  # 3) FF — registro da rodada: cada MOVE vira uma linha "origem<TAB>backup";
  #    é esse registro (modo 600) que o restaurar desfaz, não a data de hoje.
  if [ -n "$acoes" ]; then
    mkdir -p "$DIR_RODADAS"
    chmod 700 "$DIR_RODADAS"
    if [ -e "$RODADA_ATUAL" ]; then
      printf '✗ Já existe um registro com este carimbo (%s) — nada foi feito; espere um minuto e rode de novo.\n' "$RODADA_ATUAL" >&2
      exit 1
    fi
    : >"$RODADA_ATUAL"
    chmod 600 "$RODADA_ATUAL"
    printf '# rodada do limpar — carimbo %s — cada linha "origem<TAB>backup" é um MOVE feito agora\n' "$CARIMBO" >>"$RODADA_ATUAL"
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
          printf '%s\t%s\n' "$caminho" "$CLONE_MOVIDO" >>"$RODADA_ATUAL"
          moveu=1
        else
          printf '  · já não existia: %s\n' "$caminho"
        fi
        ;;
      app-usuario | app-sistema)
        if [ -e "$caminho" ]; then
          rm -rf "$caminho"
          printf '  ✓ removido: %s\n' "$caminho"
          printf '# removido (regenerável): %s\n' "$caminho" >>"$RODADA_ATUAL"
        else
          printf '  · já não existia: %s\n' "$caminho"
        fi
        ;;
      manifesto)
        if [ -f "$caminho" ]; then
          rm -f "$caminho"
          printf '  ✓ removido: %s\n' "$caminho"
          printf '# removido (regenerável): %s\n' "$caminho" >>"$RODADA_ATUAL"
        else
          printf '  · já não existia: %s\n' "$caminho"
        fi
        ;;
      dados)
        if [ -d "$caminho" ]; then
          mv "$caminho" "$DADOS_MOVIDO"
          printf '  ✓ movido: %s → %s\n' "$caminho" "$DADOS_MOVIDO"
          printf '%s\t%s\n' "$caminho" "$DADOS_MOVIDO" >>"$RODADA_ATUAL"
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
    printf '  (registro desta rodada: %s — o restaurar desfaz pela RODADA registrada,\n' "$RODADA_ATUAL"
    printf '   não pela data; o que o teste recriar é preservado em *-do-teste-%s)\n' "$DATA"
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

  # GG — validação com parser ESTRITO: JSON.parse de verdade (osascript
  # JXA), e o resultado só vale se for objeto. plutil não serve: parser de
  # plist aprovaria corpo plist (achado da rodada 4). python3 do sistema
  # não é usado: só existe com Command Line Tools.
  local arq_corpo="" veredito="" app="" versao="" origem="" reprovado=""
  arq_corpo="$(mktemp "${TMPDIR:-/tmp}/bruto-corpo.XXXXXX")"
  printf '%s' "$json" >"$arq_corpo"
  veredito="$(json_estrito "$arq_corpo")"
  rm -f "$arq_corpo"
  case "$veredito" in
    "JSON"*)
      app="$(printf '%s' "$veredito" | cut -f2)"
      versao="$(printf '%s' "$veredito" | cut -f3)"
      origem="$(printf '%s' "$veredito" | cut -f4)"
      ;;
    "NAO_JSON")
      reprovado="o corpo de /api/versao não é JSON válido (parser estrito JSON.parse — plist/XML/HTML/texto NÃO valem) — resposta: $json"
      ;;
    *)
      reprovado="não consegui validar o corpo de /api/versao como JSON estrito (osascript) — nada é aprovado sem prova; resposta: $json"
      ;;
  esac
  if [ -z "$reprovado" ]; then
    if [ -z "$versao_esperada" ]; then
      reprovado="não consegui ler a versão esperada do app instalado (/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' $APP_SISTEMA/Contents/Info.plist)"
    elif [ "$app" != "bruto" ]; then
      reprovado="/api/versao respondeu app=${app:-?} — só se aprova app=bruto"
    elif [ "$origem" != "pacote" ]; then
      reprovado="/api/versao respondeu origem=${origem:-?} — o servidor da porta NÃO provou ser o do pacote (.dmg)"
    elif [ "$versao" != "$versao_esperada" ]; then
      reprovado="/api/versao respondeu versao=$versao, mas o app instalado diz $versao_esperada (CFBundleShortVersionString do Info.plist)"
    fi
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

# --- restaurar (FF: desfaz a RODADA registrada, no estado em que a pessoa está)
# O `limpar` registra cada MOVE em ~/.bruto-roteiro/rodada-<carimbo>.txt.
# O restaurar desfaz ESSA rodada (a mais recente, ou a escolhida com
# --rodada) — nunca "os backups da data de hoje". O que o teste recriou é
# preservado em <nome>-do-teste-<data> (nada é apagado) antes de o backup
# registrado voltar ao lugar; e a máquina tem de estar parada (EE: o
# roteiro nunca encerra processo nenhum).
restaurar() {
  local rodada=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --rodada)
        [ $# -ge 2 ] || { printf '✗ --rodada exige um arquivo\n' >&2; exit 1; }
        rodada="$2"
        shift 2
        ;;
      *)
        printf '✗ Opção desconhecida: %s (use --rodada <arquivo>)\n' "$1" >&2
        exit 1
        ;;
    esac
  done

  # 0) EE — nada roda com a máquina ocupada. O roteiro NUNCA encerra
  #    processos: a recusa diz como fechar e manda rodar de novo.
  exigir_maquina_parada

  # 1) resolve a rodada: a escolhida com --rodada, ou a mais recente.
  if [ -n "$rodada" ]; then
    [ -f "$rodada" ] || {
      printf '✗ Arquivo de rodada não encontrado: %s\n' "$rodada" >&2
      exit 1
    }
  else
    rodada="$(registro_mais_recente || true)"
    if [ -z "$rodada" ]; then
      printf '✗ restaurar: NENHUM registro de rodada em %s (rodada-*.txt) — o restaurar desfaz RODADAS registradas pelo limpar, não adivinha pela data de hoje.\n' "$DIR_RODADAS" >&2
      local lista="" bak=""
      lista="$(find "$HOME" -maxdepth 1 -name '*-antes-do-teste-*' 2>/dev/null | LC_ALL=C sort)"
      if [ -n "$lista" ]; then
        printf '  E há backups *-antes-do-teste-* no HOME SEM registro — NADA foi mexido e NADA deve ser apagado à mão:\n' >&2
        while IFS= read -r bak; do
          [ -n "$bak" ] || continue
          printf '  · %s\n' "$bak" >&2
        done <<EOF
$lista
EOF
      else
        printf '  (também não há backups *-antes-do-teste-* no HOME: não existe rodada registrada para desfazer.)\n' >&2
      fi
      exit 1
    fi
  fi
  printf 'Restaurando pela rodada: %s\n' "$rodada"

  # 2) valida TUDO antes de mexer em qualquer coisa: cada linha do registro
  #    é "origem<TAB>backup" (linhas # são informação, não MOVE).
  local recusas="" pares="" origem="" backup=""
  while IFS=$'\t' read -r origem backup _ || [ -n "${origem:-}" ]; do
    [ -n "${origem:-}" ] || continue
    case "$origem" in
      '#'*) continue ;;
    esac
    if [ -z "${backup:-}" ]; then
      recusas="${recusas}  ✗ linha do registro sem backup: ${origem}\n"
      continue
    fi
    pares="${pares}${origem}"$'\t'"${backup}"$'\n'
    if [ -e "$backup" ] && [ -e "$origem" ] && [ -e "${origem}-do-teste-$DATA" ]; then
      recusas="${recusas}  ✗ já existe ${origem}-do-teste-$DATA — não vou sobrescrever o que uma restauração anterior preservou.\n"
    fi
  done <"$rodada"
  if [ -n "$recusas" ]; then
    printf '✗ Restauração RECUSADA — NADA foi movido:\n%b' "$recusas" >&2
    printf '  Trate a(s) pasta(s) -do-teste-%s antes de rodar o restaurar de novo.\n' "$DATA" >&2
    exit 1
  fi
  if [ -z "$pares" ]; then
    printf '\nO registro %s não tem nenhum MOVE — nada para desfazer.\n' "$rodada"
    return 0
  fi

  # 3) executa: preserva o que o teste recriou e devolve o backup registrado.
  local restaurou=0 problemas=0
  while IFS=$'\t' read -r origem backup; do
    [ -n "${origem:-}" ] || continue
    if [ ! -e "$backup" ]; then
      if [ -e "$origem" ]; then
        printf '  · já restaurado antes (origem no lugar, backup consumido): %s\n' "$origem"
      else
        printf '  ✗ o registro aponta um backup que não existe (e a origem também não): %s → %s\n' "$origem" "$backup" >&2
        problemas=1
      fi
      continue
    fi
    if [ -e "$origem" ]; then
      mv "$origem" "${origem}-do-teste-$DATA"
      printf '  ✓ preservado o que o teste recriou: %s → %s\n' "$origem" "${origem}-do-teste-$DATA"
    fi
    mv "$backup" "$origem"
    printf '  ✓ de volta: %s → %s\n' "$backup" "$origem"
    restaurou=1
  done <<EOF
$pares
EOF

  if [ "$problemas" -eq 1 ]; then
    printf '✗ Restauração INCOMPLETA — algum item do registro não pôde ser tratado (mensagens acima). NADA foi apagado; relate.\n' >&2
    exit 1
  fi
  if [ "$restaurou" -eq 1 ]; then
    printf '\nPronto. As pastas *-do-teste-%s guardam o que o teste recriou — NADA foi apagado.\n' "$DATA"
    printf 'Registro da rodada restaurada (mantido para conferência): %s\n' "$rodada"
  else
    printf '\nEsta rodada já estava restaurada (registro: %s) — nada foi movido.\n' "$rodada"
  fi
  return 0
}

# --- guarda-livros ------------------------------------------------------------
case "${1:-}" in
  listar) shift; [ $# -eq 0 ] || { printf '✗ listar não aceita opções\n' >&2; exit 1; }; listar ;;
  limpar) shift; limpar "$@" ;;
  testar) shift; [ $# -eq 0 ] || { printf '✗ testar não aceita opções\n' >&2; exit 1; }; testar ;;
  restaurar) shift; restaurar "$@" ;;
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
