# Modo grátis — contrato entre a extensão e o servidor

Decisões do dono (25/09/2026): o modo grátis entra ANTES do envio à loja; servidor na Vercel da
Ideia Business (time `ideia-business`); 3 aulas por dia por instalação; usa a assinatura anual de
Ollama Cloud do dono; contador no Upstash Redis instalado pelo marketplace da Vercel.

## A regra que não se negocia

**A chave do Ollama nunca sai do servidor.** Ela vive em variável de ambiente da Vercel
(`OLLAMA_API_KEY`), colocada pelo dono. Não vai para a extensão, para o repositório, para log nem
para resposta.

**O servidor não é uma IA genérica grátis.** Ele recebe só a transcrição e os metadados do vídeo e
monta, ele mesmo, o prompt da aula (`studyPrompt` de `src/pipeline/prompts/study.ts`). O modelo é
fixado no servidor. A rota não tem outra resposta: quem a chama com outra intenção recebe uma aula
por pedido — sempre uma aula montada pelo próprio servidor sobre o texto enviado, nunca um chat
genérico — até bater nos limites. O volume é contido pelos tetos da seção "Limites" e pelo firewall
da Vercel (seção "Firewall da Vercel (borda)"). O que isso NÃO segura: sem autenticação, ~25 redes
diferentes (6 aulas/dia cada) esgotam o teto geral de 150/dia — risco aceito pelo dono em
05/11/2026 (relatório local `.security/relatorios-2026-11-05/seg-servidor-extensao.md`, achado
S-02); o firewall por IP não resolve esse caso, só a rajada de um mesmo IP.

## Rotas

Base: `https://bruto-gratis.vercel.app` (nome do projeto Vercel: `bruto-gratis`). Toda rota exige o
cabeçalho `X-Bruto-Cliente: extensao` (força preflight; mesma doutrina do app local).

### `POST /api/aula`

Corpo JSON, `Content-Type: application/json`, no máximo 200 KB:

| Campo | Tipo | Regra |
|---|---|---|
| `instalacao` | string | UUID v4 gerado pela extensão na primeira vez e guardado em `chrome.storage.local` |
| `titulo` | string | 1–300 caracteres |
| `canal` | string ou null | até 200 caracteres |
| `transcricao` | string | 200–120.000 caracteres |

Respostas:

| Status | Corpo | Quando |
|---|---|---|
| 200 | `{ "aula": "<markdown>", "restantes": n, "limite": 3 }` | deu certo |
| 400 | `{ "erro": "…" }` | corpo inválido |
| 413 | `{ "erro": "…" }` | corpo acima de 200 KB |
| 415 | `{ "erro": "…" }` | sem `Content-Type: application/json` ou sem `X-Bruto-Cliente` |
| 429 | `{ "erro": "…", "motivo": "instalacao" \| "rede" \| "geral", "restantes": 0, "limite": 3 }` | limite atingido |
| 502 | `{ "erro": "…" }` | o Ollama falhou (a cota da pessoa é devolvida) |
| 503 | `{ "erro": "…" }` | servidor sem `OLLAMA_API_KEY` ou sem Redis configurado |

### `GET /api/cota`

Cabeçalho `X-Bruto-Instalacao: <uuid v4>` — a instalação **nunca** vai na query string (ela entra
no access log da Vercel, que não tem o TTL de 36h do Redis; furaria a promessa de "some em 36h").
`200 { "restantes": n, "limite": 3 }`. Não consome nada. `400` se o cabeçalho faltar ou não for
UUID v4, ou se a requisição ainda mandar `?instalacao=` na query string (recusada, não ignorada).

### `OPTIONS` (preflight)

Responde 204 com `Access-Control-Allow-Origin` igual à origem **só** se ela começar com
`chrome-extension://`; `Access-Control-Allow-Headers: content-type, x-bruto-cliente,
x-bruto-instalacao`; `Access-Control-Allow-Methods: GET, POST, OPTIONS`. Outra origem: sem
cabeçalho CORS.

## Limites

| Chave | Teto | Por quê |
|---|---|---|
| por instalação, por dia | 3 (`BRUTO_LIMITE_DIARIO`) | a decisão do dono |
| por rede (IP), por dia | 6 (`BRUTO_LIMITE_REDE`) | apagar e reinstalar gera outra instalação; o IP segura isso |
| geral, por dia | 150 (`BRUTO_TETO_GERAL`) | protege a assinatura se a extensão viralizar ou for abusada |

- O "dia" é o de Brasília (UTC−3). Chaves no Redis expiram em 36 h.
- O IP nunca é gravado como está: grava-se `sha256(ip + BRUTO_SAL)`, e `BRUTO_SAL` é variável de ambiente.
- Incrementa ANTES de chamar o Ollama (evita corrida); se o Ollama falhar, devolve a unidade.

## Firewall da Vercel (borda)

Duas regras de WAF ativas no projeto `bruto-gratis` (time `ideia-business`), criadas em 12/11/2026
(demanda `4657c736`). Contador por IP, janela fixa de 10 min (o máximo que a Vercel Pro aceita),
resposta `429` na borda — o pedido morre antes de chegar à função e ao Redis:

| Regra | Condição | Limite |
|---|---|---|
| `bruto: POST /api/aula por IP` | método POST e caminho = `/api/aula` | 6 por 10 min |
| `bruto: /api/ por IP` | caminho começa com `/api/` (cota, aula, preflight) | 60 por 10 min |

Prova medida: rajada de 65 `GET /api/cota` do mesmo IP → 60 chegaram à função (e responderam 400)
e as demais receberam `429` com `x-vercel-mitigated: deny`. Os contadores da Vercel são por
região. O plano Pro cobra o firewall por uso (pedidos verificados). Para mudar as regras: painel
do projeto → Firewall, ou API `PATCH /v1/security/firewall/config` (`rules.insert`,
`mitigate.action: "rate_limit"`).

## Chamada ao Ollama

`POST https://ollama.com/v1/chat/completions`, `Authorization: Bearer $OLLAMA_API_KEY`, modelo
`BRUTO_MODELO` (padrão `gpt-oss:120b`), `system` = studyPrompt, `user` = transcrição,
`max_tokens` 8000, timeout de 170 s. A resposta é texto; limitar a 200 KB antes de devolver.

## O que nunca vai para log

Chave, transcrição, título, IP ou instalação. Log só com contagens e status.

## Extensão

- Terceiro modo, `gratis`, ao lado de `app` e `chave`. Ordem de escolha: app com plano → chave
  configurada → grátis. Quem não configurou nada cai no grátis.
- Guarda o UUID em `chrome.storage.local` na chave `bruto.instalacao`.
- Mostra quantas aulas grátis restam hoje e, no 429, oferece as duas saídas: colar uma chave ou
  abrir o app local.
- Trata a resposta como entrada não confiável: teto de bytes, forma conferida, markdown pelo mesmo
  renderizador.
- `host_permissions` ganha `https://bruto-gratis.vercel.app/*`.

## Publicação (só com o dono)

1. Dono: `vercel integration add upstash/upstash-kv --scope ideia-business` (aceita os termos).
2. Criar o projeto `bruto-gratis` no time e ligar o Redis a ele.
3. Dono coloca `OLLAMA_API_KEY` e `BRUTO_SAL` nas variáveis de ambiente, sem passar pelo chat.
4. Deploy por `vercel-deploy-isolado`, só com a ordem do dono em palavras.

Estado atual do Redis: plano Free do Upstash pela integração da Vercel — 500 mil comandos por mês,
região `iad1`. Store atual `upstash-kv-crimson-fence`, ligado ao `bruto-gratis` em 12/11/2026.

### Se o Redis sumir de novo (já sumiu uma vez)

O store anterior (`upstash-kv-cinnabar-island`) foi desinstalado em data não registrada; o host
deixou de existir (`ENOTFOUND`) e todo `/api/cota` e `/api/aula` respondia 500. Foi assim que o
dono recuperou, em 12/11/2026:

1. Recriar a integração do Upstash na Vercel e criar o store novo.
2. Desligar a ligação morta do store antigo ANTES de ligar o novo ao projeto — senão a Vercel
   recusa com `env_var_prefix_not_unique`.
3. Remover as variáveis de ambiente antigas, que apontavam para o host morto.
4. Redeploy isolado (`vercel-deploy-isolado`), só com a ordem do dono.

Verificação barata para repetir: `GET /api/cota` com `X-Bruto-Cliente: extensao` e
`X-Bruto-Instalacao: <uuid v4>` qualquer → espera-se `200` com `{ "restantes": n, "limite": 3 }`.
Provado na recuperação de 12/11/2026: cota `200 {restantes:3}`, uma aula `200`, cota depois
`{restantes:2}`.
