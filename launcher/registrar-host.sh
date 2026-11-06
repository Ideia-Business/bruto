#!/bin/bash
# Bruto — registra (ou remove) o host de native messaging da extensão (macOS e Linux).
#
# Uso:
#   bash launcher/registrar-host.sh [--remover] [--extensao-id <id>] [--extensao-id <id> ...]
#   BRUTO_EXTENSAO_ID="<id1>,<id2> ..." bash launcher/registrar-host.sh
#
# Escreve com.ideiabusiness.bruto.json no diretório NativeMessagingHosts de cada
# navegador (Chrome, Chromium, Edge, Brave) que a pessoa JÁ tem — nunca cria a
# árvore de um navegador ausente. O manifesto aponta para launcher/host-nativo.sh
# (caminho absoluto) e libera só as extensões do Bruto (allowed_origins).
#
# IDs da extensão — pode haver VÁRIOS ao mesmo tempo (o da extensão
# descompactada usada no teste e o do item da loja): --extensao-id repetível (um
# ID por flag), BRUTO_EXTENSAO_ID com lista separada por vírgula e/ou espaço, e o
# derivado do campo "key" do extension/manifest.json (SHA-256 da chave pública,
# 16 bytes, nibbles a-p), que entra como MAIS UM ID junto com os informados.
# Repetidos entram uma vez só. Sem NENHUM ID, NÃO escreve nada, avisa e sai 0:
# nunca se inventa um ID. Se algum ID informado for inválido (não são 32 letras
# a-p), também não escreve nada: allowed_origins é superfície de segurança,
# nunca um subconjunto em silêncio.
#
# Idempotente. --remover apaga SÓ o arquivo que este script criou. Sem sudo, sem
# rede, sem /tmp. Compatível com bash 3.2 (macOS).

set -u

NOME_HOST="com.ideiabusiness.bruto"
ARQUIVO="$NOME_HOST.json"

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." 2>/dev/null && pwd)" || {
  echo "✗ não consegui resolver a pasta do Bruto" >&2
  exit 1
}

REMOVER=0
# IDs vindos de --extensao-id (repetível): um por linha, sempre com \n no fim.
IDS=""

while [ $# -gt 0 ]; do
  case "$1" in
    --remover) REMOVER=1; shift ;;
    --extensao-id)
      [ $# -ge 2 ] || { echo "✗ --extensao-id exige um valor" >&2; exit 1; }
      IDS="$IDS$2
"
      shift 2 ;;
    -h|--help)
      echo "Uso: registrar-host.sh [--remover] [--extensao-id <id>] [--extensao-id <id> ...]  (ou BRUTO_EXTENSAO_ID com lista: \"<id1>,<id2> ...\")"
      exit 0 ;;
    *) echo "✗ Opção desconhecida: $1" >&2; exit 1 ;;
  esac
done

# Diretórios NativeMessagingHosts candidatos: só entram os de navegador que existe
# (o diretório-pai do NativeMessagingHosts já está lá).
listar_diretorios() {
  case "$(uname -s)" in
    Darwin)
      base="$HOME/Library/Application Support"
      printf '%s\n' \
        "$base/Google/Chrome" \
        "$base/Chromium" \
        "$base/Microsoft Edge" \
        "$base/BraveSoftware/Brave-Browser"
      ;;
    Linux)
      # XDG_CONFIG_HOME (caminho absoluto, como manda a especificação XDG) é onde os
      # navegadores guardam a config e os manifestos de native messaging; sem ele, ~/.config.
      base="${XDG_CONFIG_HOME:-}"
      case "$base" in
        /*) ;;
        *) base="$HOME/.config" ;;
      esac
      printf '%s\n' \
        "$base/google-chrome" \
        "$base/chromium" \
        "$base/microsoft-edge" \
        "$base/BraveSoftware/Brave-Browser"
      ;;
    *) return 0 ;;
  esac
}

# --remover: apaga só o arquivo próprio, confirmando o nome.
if [ "$REMOVER" -eq 1 ]; then
  removidos=0
  while IFS= read -r pai; do
    [ -n "$pai" ] || continue
    alvo="$pai/NativeMessagingHosts/$ARQUIVO"
    if [ -f "$alvo" ] && [ "$(basename "$alvo")" = "$ARQUIVO" ]; then
      if rm -f "$alvo"; then
        echo "  ✓ removido: $alvo"
        removidos=$((removidos + 1))
      else
        echo "  ⚠️  não consegui remover $alvo" >&2
      fi
    fi
  done <<EOF
$(listar_diretorios)
EOF
  echo "→ host nativo: $removidos manifesto(s) removido(s)"
  exit 0
fi

# ID da extensão derivado do campo "key" do manifest, quando existir.
derivar_id_da_chave() {
  local manifest="$RAIZ/extension/manifest.json" chave hex
  [ -f "$manifest" ] || return 1
  chave="$(sed -n 's/.*"key"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$manifest" | head -n 1)"
  [ -n "$chave" ] || return 1
  command -v openssl >/dev/null 2>&1 || return 1
  hex="$(printf '%s' "$chave" | openssl base64 -d -A 2>/dev/null | openssl dgst -sha256 -binary 2>/dev/null | od -An -tx1 -N16 2>/dev/null | tr -d ' \n')"
  [ "${#hex}" -eq 32 ] || return 1
  printf '%s' "$hex" | tr '0-9a-f' 'a-p'
}

# Junta todos os IDs: --extensao-id (repetível), BRUTO_EXTENSAO_ID (lista com
# vírgula e/ou espaço) e o derivado da "key" do manifest — este entra como MAIS
# UM ID, junto com os informados. Um ID por linha, sem vazios, sem repetidos e em
# ordem: o arquivo gerado sai idêntico em rodadas repetidas (idempotência).
if [ -n "${BRUTO_EXTENSAO_ID:-}" ]; then
  IDS="$IDS$(printf '%s\n' "$BRUTO_EXTENSAO_ID" | tr ', ' '\n\n')
"
fi
id_da_chave="$(derivar_id_da_chave)" || id_da_chave=""
[ -z "$id_da_chave" ] || IDS="$IDS$id_da_chave
"
LISTA_IDS="$(printf '%s' "$IDS" | sed '/^$/d' | LC_ALL=C sort -u)"

if [ -z "$LISTA_IDS" ]; then
  echo "→ host nativo: ID da extensão desconhecido — nada registrado. Rode 'bash launcher/registrar-host.sh --extensao-id <id>' (ID em chrome://extensions)."
  exit 0
fi

# O ID do Chrome tem 32 letras de a a p. Se QUALQUER ID da lista for inválido,
# NADA entra no manifesto (nunca um subconjunto em silêncio: allowed_origins é
# superfície de segurança) — avisa qual era inválido e sai 0.
invalidos=""
while IFS= read -r id; do
  valido=1
  case "$id" in *[!a-p]*) valido=0 ;; esac
  [ "${#id}" -eq 32 ] || valido=0
  if [ "$valido" -eq 0 ]; then
    [ -n "$invalidos" ] && invalidos="$invalidos, "
    invalidos="$invalidos\"$id\""
  fi
done <<EOF
$LISTA_IDS
EOF
if [ -n "$invalidos" ]; then
  echo "→ host nativo: ID de extensão inválido (esperado 32 letras a-p): $invalidos — nada registrado." >&2
  exit 0
fi

CAMINHO_HOST="$RAIZ/launcher/host-nativo.sh"
# Escapa \ e " para o JSON (caminho com aspas ou barras invertidas).
caminho_json="$(printf '%s' "$CAMINHO_HOST" | sed 's/\\/\\\\/g; s/"/\\"/g')"

# Uma origem "chrome-extension://<id>/" por ID, na ordem da lista (ordenada).
origens=""
while IFS= read -r id; do
  [ -n "$id" ] || continue
  [ -n "$origens" ] && origens="$origens, "
  origens="$origens\"chrome-extension://$id/\""
done <<EOF
$LISTA_IDS
EOF

CONTEUDO="{
  \"name\": \"$NOME_HOST\",
  \"description\": \"Bruto — liga o app local pela extensão\",
  \"path\": \"$caminho_json\",
  \"type\": \"stdio\",
  \"allowed_origins\": [$origens]
}"

gravados=0
falhas=0
while IFS= read -r pai; do
  [ -n "$pai" ] || continue
  [ -d "$pai" ] || continue
  dir="$pai/NativeMessagingHosts"
  alvo="$dir/$ARQUIVO"
  if mkdir -p "$dir" && ( umask 022; printf '%s\n' "$CONTEUDO" > "$alvo" ); then
    echo "  ✓ registrado: $alvo"
    gravados=$((gravados + 1))
  else
    echo "  ⚠️  não consegui escrever $alvo" >&2
    falhas=$((falhas + 1))
  fi
done <<EOF
$(listar_diretorios)
EOF

if [ "$gravados" -eq 0 ] && [ "$falhas" -eq 0 ]; then
  echo "→ host nativo: nenhum navegador compatível encontrado (Chrome, Chromium, Edge, Brave) — nada registrado."
else
  echo "→ host nativo: $gravados manifesto(s) registrado(s)"
fi
exit 0
