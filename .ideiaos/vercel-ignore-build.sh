#!/usr/bin/env bash
# vercel-ignore-build.sh — template do Ignored Build Step P-092.
#
# Este arquivo é renderizado por scripts/render-vercel-ignore-build.sh para cada
# produto em .ideiaos/. As quatro listas vêm de source/lib/doutrina-projeto.sh;
# não edite a cópia no produto, pois ela é atualizada na próxima propagação.
set -u

IDEIAOS_DOUTRINA_GERADA=(
  .claude/hooks/enforce-git-push-authority.cjs
  .claude/rules/ideiaos-common-
  .cursor/rules/ideiaos-
  .cursor/rules/lovable-deploy.mdc
  .codex/ideiaos-rules.md
  .ideiaos/vercel-ignore-build.sh
  IDEIAOS.md
  docs/ideiaos/GUIDE-HUMANS.md
  docs/ideiaos/GUIDE-AI.md
  docs/ideiaos/DECISION-MATRIX.md
)
IDEIAOS_DOUTRINA_MESCLADA=(
  .claude/settings.json
  .claude/settings.local.json
  AGENTS.md
)
IDEIAOS_DOUTRINA_SE_FALTA=(
  CLAUDE.md
  STATE.md
  CONTRIBUTING.md
  .cursor/rules/session-continuation.mdc
  .cursor/rules/agents-md-protocol.mdc
  .cursor/rules/planning-branch.mdc
  docs/CONTINUATION_HANDOFF.md
  docs/learnings/README.md
  docs/learnings/_TEMPLATE.md
  docs/lovable/_TEMPLATE.md
  docs/lovable/conclusao-implantacao.md
  docs/playbook-implantacao.md
  docs/postmortems/.gitkeep
  .security/review-ledger.log
)
IDEIAOS_DOUTRINA_AGENTES=(
  .codex/agents/build_error_resolver.toml
  .codex/agents/claude_continuation.toml
  .codex/agents/code_explorer.toml
  .codex/agents/code_simplifier.toml
  .codex/agents/doc_updater.toml
  .codex/agents/ideiaos_checker.toml
  .codex/agents/mkt_copywriter.toml
  .codex/agents/mkt_designer.toml
  .codex/agents/mkt_estrategista.toml
  .codex/agents/mkt_revisor.toml
  .codex/agents/performance_optimizer.toml
  .codex/agents/planner.toml
  .codex/agents/pr_test_analyzer.toml
  .codex/agents/react_reviewer.toml
  .codex/agents/refactor_cleaner.toml
  .codex/agents/rls_reviewer.toml
  .codex/agents/security_reviewer.toml
  .codex/agents/silent_failure_hunter.toml
  .codex/agents/typescript_reviewer.toml
)

escape_ere() {
  printf '%s' "$1" | sed 's/[][\\.^$*+?(){}|]/\\&/g'
}

adiciona_padrao() {
  local item="$1" padrao
  case "$item" in
    *-) padrao="$(escape_ere "${item%-}").*" ;;
    *) padrao="$(escape_ere "$item")" ;;
  esac
  if [ -n "${PADROES:-}" ]; then
    PADROES="$PADROES|$padrao"
  else
    PADROES="$padrao"
  fi
}

PADROES=""
for item in "${IDEIAOS_DOUTRINA_GERADA[@]}" \
            "${IDEIAOS_DOUTRINA_MESCLADA[@]}" \
            "${IDEIAOS_DOUTRINA_SE_FALTA[@]}" \
            "${IDEIAOS_DOUTRINA_AGENTES[@]}"; do
  [ -n "$item" ] && adiciona_padrao "$item"
done
[ -n "$PADROES" ] || exit 1
REGEX="^($PADROES)$"

# A Vercel roda o Ignored Build Step dentro do Root Directory. A decisão,
# contudo, precisa ver todo o commit e não somente o subdiretório da aplicação.
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 1
cd "$REPO_ROOT" || exit 1

# Sem a base explícita da Vercel, clone raso ou qualquer erro de Git: constrói.
BASE="${VERCEL_GIT_PREVIOUS_SHA:-}"
[ -n "$BASE" ] || exit 1
git rev-parse --verify "${BASE}^{commit}" >/dev/null 2>&1 || exit 1
git rev-parse --verify HEAD^{commit} >/dev/null 2>&1 || exit 1
MUDANCAS="$(git diff --name-only "$BASE" HEAD 2>/dev/null)" || exit 1

# Diff vazio não contém mudança de produto; só caminhos da doutrina cancelam.
[ -z "$MUDANCAS" ] && exit 0
if printf '%s\n' "$MUDANCAS" | grep -Eqv "$REGEX"; then
  exit 1
else
  # grep retorna 1 somente quando não encontrou caminho fora da doutrina.
  # Qualquer outro erro (inclusive regex inválido) é fail-safe: constrói.
  [ "$?" -eq 1 ] || exit 1
fi
exit 0
