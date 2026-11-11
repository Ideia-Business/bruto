#!/bin/bash
# Bruto — wrapper do host de native messaging DENTRO do pacote (.app).
# Vai em Resources/host-nativo.sh (e em Resources/launcher/host-nativo.sh, que
# é o caminho que o registrar-host.sh do repo registra). Usa o Node do PACOTE
# (nunca o da máquina) e define BRUTO_LANCADOR para o host rodar o lançador do
# .app em vez do serve.sh do clone. stdin/stdout passam intactos: nada aqui
# escreve em stdout.

set -u

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Resources em caminho CANÔNICO (absoluto, sem "..") para as duas variantes
# de layout. O host-nativo.mjs só aceita BRUTO_LANCADOR no formato literal
# …/Bruto.app/Contents/MacOS/Bruto — caminho com "/../" é recusado como
# lancador-invalido (achado P2 da 1ª rodada do Codex), e a variante de
# Resources/ sobe um diretório a mais (…/Bruto.app/MacOS/Bruto): por isso o
# caminho é RESOLVIDO com cd+pwd antes de exportar, nunca concatenado com "..".
case "$DIR" in
  */Resources)
    RECURSOS="$DIR" ;;
  */Resources/launcher)
    RECURSOS="$(cd "$DIR/.." && pwd)" ;;
  *)
    echo "Bruto: host-nativo.sh fora do Bruto.app ($DIR)" >&2
    exit 1 ;;
esac
BRUTO_LANCADOR="$(cd "$RECURSOS/.." && pwd)/MacOS/Bruto"
NODE="$RECURSOS/node"
MJS="$RECURSOS/host-nativo.mjs"

# Falha alta se o lançador anunciado não existir de fato neste pacote (a
# mensagem vai ao stderr — o stdout é o canal do protocolo).
if [ ! -x "$BRUTO_LANCADOR" ]; then
  echo "Bruto: lançador do pacote não encontrado em $BRUTO_LANCADOR" >&2
  exit 1
fi
export BRUTO_LANCADOR

exec "$NODE" "$MJS"
