---
date: 2026-09-16
session_type: <bug-fix | feature | refactor | infra | discovery>
incident: <INC-NN ou n/a>
commit: <hash principal ou n/a>
tags: [tag1, tag2, tag3]
applies_to_projects: [bruto]   # use [global] se padrão genérico replicável em outros projetos
promote_to_vault: false                    # true quando virar conteúdo curado no Obsidian (Fase B)
---

# <Título curto e específico — começar com o padrão, não com o incidente>

> Bons títulos: "Cache RLS vence override em comboboxes — causa divergência multi-user".
> Maus títulos: "Bug do INC-351" (perde o padrão).

## Trigger (quando reler isso)

Em **1 frase**: a situação futura em que este aprendizado seria útil. Se outro agente cair nessa
situação, esta seção é o que ele lê primeiro para decidir se continua lendo o resto.

> Ex: "Bug onde usuários diferentes veem dados diferentes no mesmo registro, especialmente em
> campos que vêm de tabelas com RLS por carteira."

## O padrão (abstrato)

Descrição genérica do padrão — **não** a solução específica. Pense: "se este aprendizado se aplica
a outro projeto, ele faria sentido sem citar `crm_leads` ou `referred_by_client_id`?"

## Evidência (concreta — desta sessão)

- Incidente / feature: <INC-NN, link postmortem se houver>
- Commit principal: `<hash>`
- Arquivos-chave:
  - `caminho/arquivo.ts:linha` — <o que estava errado>
  - `caminho/outro.ts:linha` — <correção aplicada>
- Logs/queries que provaram a causa raiz (se aplicável).

## Regra prática derivada

A regra acionável que outras sessões devem seguir. Linguagem de norma, não de descrição.

> Ex: "Em qualquer combobox/seletor que recebe `override` vindo de RPC SECURITY DEFINER, o override
> deve ter prioridade SOBRE cache local. Cache só enriquece campos secundários (email, phone),
> nunca sobrescreve nome canônico."

## Falsos positivos / armadilhas

Coisas que **parecem** ser este padrão mas não são. Evita que a próxima sessão aplique a regra
em situações erradas. Se não houver, escrever "Nenhum identificado nesta sessão".

## Cross-references

- `[[learning-anterior-relacionado]]` — se houver
- `docs/postmortems/<INC-NN>-<slug>.md` — postmortem detalhado
- `docs/lovable/<HANDOFF>.md` — handoff Lovable (se aplicável)
- Memória global: `reference_<tema>.md` — se promovido

## Promoção (preenchido depois)

- [ ] Promovido para memória global da ferramenta de IA (diretório local de memória do projeto) em ___ — motivo: padrão se aplica a `[global]`
- [ ] Promovido para Obsidian vault em ___ — motivo: síntese cross-projeto (Fase B)
- [ ] Aplicado retroativamente em outros learnings (refinou regra)
