# Learnings — bruto

Cada arquivo aqui é **um aprendizado da IA** extraído de uma sessão de implantação. Estrutura padronizada via `_TEMPLATE.md` — não escreva em formato livre.

## Convenção de nomes

`YYYY-MM-DD-<slug-do-padrão>.md`

Bons exemplos:
- `2026-05-28-cache-rls-vs-rpc-override-divergence.md`
- `2026-05-15-stripe-webhook-fail-closed-policy.md`
- `2026-04-22-supabase-view-sem-coluna-bug-silencioso.md`

Maus exemplos:
- `2026-05-28-inc-351.md` — perde o padrão, não procurável
- `bug-do-crm.md` — sem data, sem categoria

## Como usar

### No início de uma sessão (skill `/recall-learnings`)

A IA lê **automaticamente** os 5 learnings mais recentes + busca por tags relevantes ao pedido do usuário. Não precisa ser invocada explicitamente — está embutida no ritual de abertura definido em `AGENTS.md`.

### Durante a sessão

Marcar mentalmente candidatos a aprendizado (não interromper o trabalho).

### No fim (skill `/extract-learnings`)

Após o resumo final da implantação (modelo de 6 blocos), a IA produz **automaticamente** um novo arquivo aqui se a sessão gerou aprendizado não-trivial. Sessões puramente operacionais (dep bump, doc typo) podem ser puladas.

## Quando promover

Um learning aqui é **específico do projeto**. Quando a regra prática derivada se aplica a outros projetos da equipe ou ao stack em geral:

- Marcar `applies_to_projects: [global]` no frontmatter
- A skill `/extract-learnings` sincroniza para `~/.claude/projects/.../memory/`
- (Fase B) Promover para Obsidian Vault como referência curada cross-projeto

## Anti-padrões a evitar

- Não duplicar postmortems: learnings extraem o **padrão**, postmortems contam a **história**.
- Não copiar código longo: linkar `arquivo:linha` em vez de colar 30 linhas.
- Não escrever em primeira pessoa narrativa ("hoje descobri que…"). Use voz prescritiva ("quando X, fazer Y").
- Não criar learning para cada bug: só quando o padrão é replicável ou a causa raiz foi surpreendente.

## Vendor / Stack tags úteis

Use tags consistentes para facilitar busca:

- Stack: `[supabase, lovable, vite, react, tanstack-query, stripe, ...]`
- Categoria: `[rls, performance, race-condition, cache, deploy, ux, security]`
- Severidade: `[gotcha, critical-pattern, false-positive, vendor-bug]`
