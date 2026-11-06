#!/usr/bin/env bash
# Roda na estação a verificação do GitHub Actions deste repositório: o Actions está suspenso por custo
# (decisão do dono, 21/10/2026). A lógica vive no kernel IdeiaOS e lê o .github/workflows/ deste repo,
# na cópia limpa do commit atual. Rode antes de integrar e cite a linha CI-LOCAL no PR.
#   bash scripts/ci-local.sh            # verificação completa
#   bash scripts/ci-local.sh --plano    # mostra o que rodaria, sem executar
#   (outras opções: --servicos, --pesado, --aqui, --job X, --workflow Y)
# Exit: 0 ok · 1 falhou (não integra) · 2 passou com NÃO EXECUTADO (declare) · 3 INDETERMINADO
CI_LOCAL="${IDEIAOS_CI_LOCAL:-$HOME/.ideiaos/bin/ci-local.sh}"
if [ ! -f "$CI_LOCAL" ]; then
  echo "ci-local: $CI_LOCAL ausente — instale o IdeiaOS na estação (bash ~/dev/IdeiaOS/setup.sh --global-only)" >&2
  exit 3
fi
exec bash "$CI_LOCAL" --repo "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)" "$@"
