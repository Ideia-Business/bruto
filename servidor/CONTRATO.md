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
fixado no servidor. Quem chamar a rota com outra intenção recebe, no máximo, uma aula.

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
