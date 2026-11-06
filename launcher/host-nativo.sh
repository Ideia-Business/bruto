#!/bin/bash
# Bruto — wrapper do host de native messaging (macOS e Linux).
# É este o `path` do manifesto: o Chrome não herda o PATH do shell, então o
# Node é escolhido pela versão (launcher/_node.sh), como no serve.sh.
# stdin/stdout passam intactos para o .mjs: nada aqui escreve em stdout.

set -u
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_node.sh
. "$DIR/_node.sh"
if ! bruto_escolher_node; then
  echo "Bruto: falta o Node.js 20 ou mais novo." >&2
  exit 1
fi
exec node "$DIR/host-nativo.mjs"
