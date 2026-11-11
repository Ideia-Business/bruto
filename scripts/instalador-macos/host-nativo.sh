#!/bin/bash
# Bruto — wrapper do host de native messaging DENTRO do pacote (.app).
# Vai em Resources/host-nativo.sh (e em Resources/launcher/host-nativo.sh, que
# é o caminho que o registrar-host.sh do repo registra). Usa o Node do PACOTE
# (nunca o da máquina) e define BRUTO_LANCADOR para o host rodar o lançador do
# .app em vez do serve.sh do clone. stdin/stdout passam intactos: nada aqui
# escreve em stdout.

set -u

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Caminhos absolutos do node/mjs do pacote e do lançador — o host-nativo.mjs
# só aceita BRUTO_LANCADOR no formato …/Bruto.app/Contents/MacOS/Bruto.
case "$DIR" in
  */Resources)
    BRUTO_LANCADOR="$DIR/../../MacOS/Bruto"
    NODE="$DIR/node"
    MJS="$DIR/host-nativo.mjs" ;;
  */Resources/launcher)
    BRUTO_LANCADOR="$DIR/../../MacOS/Bruto"
    NODE="$DIR/../node"
    MJS="$DIR/../host-nativo.mjs" ;;
  *)
    echo "Bruto: host-nativo.sh fora do Bruto.app ($DIR)" >&2
    exit 1 ;;
esac
export BRUTO_LANCADOR

exec "$NODE" "$MJS"
