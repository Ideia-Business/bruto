# shellcheck shell=bash
# Escolhe o Node pela VERSÃO, não pela ordem do PATH, e põe só ele (com npm e
# npx) na frente, por uma pasta de links própria.
#
# POR QUE: ordenar pastas no PATH sempre deixava uma combinação perdedora —
# o Homebrew inteiro na frente trazia o yt-dlp antigo; ~/.local/bin na frente
# trazia um Node velho que estivesse lá (Codex e Grok, rodadas 3 e 4, 25/09).
# Aqui ninguém mais disputa: o yt-dlp do uv continua vencendo, e o Node é o
# primeiro >= 20 que existir.
#
# A última escolha fica gravada em ~/.local/share/bruto/nodebin: o atalho não
# herda o PATH do nvm/fnm/Volta, e é por esse link que ele reencontra um Node
# que só existia lá (Grok, passada final, 25/09). Vem por ÚLTIMO: o Node vivo
# do PATH, quando há, vence o link antigo (Grok, rodada 8).
#
# Uso: . launcher/_node.sh && bruto_escolher_node   (retorna 1 se não houver)

bruto_node_major() {
  "$1" -v 2>/dev/null | sed 's/^v//' | cut -d. -f1
}

bruto_escolher_node() {
  local candidato major escolhido="" dir_links
  for candidato in \
    "$HOME/.local/share/bruto/node/bin/node" \
    /opt/homebrew/opt/node/bin/node \
    /opt/homebrew/bin/node \
    /usr/local/opt/node/bin/node \
    /usr/local/bin/node \
    "$HOME/.local/bin/node" \
    /usr/bin/node \
    "$(command -v node 2>/dev/null)" \
    "$HOME/.local/share/bruto/nodebin/node"; do
    [ -n "$candidato" ] && [ -x "$candidato" ] || continue
    major="$(bruto_node_major "$candidato")"
    case "$major" in ''|*[!0-9]*) continue ;; esac
    if [ "$major" -ge 20 ]; then escolhido="$candidato"; break; fi
  done
  [ -n "$escolhido" ] || return 1

  dir_links="$HOME/.local/share/bruto/nodebin"
  # Numa segunda chamada, `command -v node` devolve o NOSSO link; ligar o link
  # a ele mesmo quebraria o node ("too many levels of symbolic links") com
  # Node de nvm/fnm/Volta (Grok, rodada 6, 25/09). Sempre o binário real.
  while [ -L "$escolhido" ] && [ "$(dirname "$escolhido")" = "$dir_links" ]; do
    escolhido="$(readlink "$escolhido")"
  done
  [ "$(dirname "$escolhido")" = "$dir_links" ] && return 1
  mkdir -p "$dir_links"
  ln -sf "$escolhido" "$dir_links/node"
  local b
  for b in npm npx; do
    if [ -x "$(dirname "$escolhido")/$b" ]; then ln -sf "$(dirname "$escolhido")/$b" "$dir_links/$b"; fi
  done
  # Sempre NA FRENTE, mesmo que já esteja no PATH: alguém pode ter anteposto
  # ~/.local/bin depois da última escolha (Grok, rodada 5, 25/09).
  local p=":$PATH:"
  p="${p//:$dir_links:/:}"
  p="${p#:}"; p="${p%:}"
  PATH="$dir_links${p:+:$p}"
  export PATH
  hash -r 2>/dev/null || true
}
