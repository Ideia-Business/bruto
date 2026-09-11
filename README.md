# Bruto

**Entra bruto, sai entendido.**

Cole o link de um vídeo — YouTube, Instagram ou TikTok — e receba **resumo**, **transcrição**, **mapa mental** e uma **aula completa** em português: objetivos, conceitos explicados do zero, glossário e teste de fixação. Exporta `.docx` e `.pdf`.

Roda na sua máquina, com a sua chave de IA. Sem assinatura, sem limite, sem lock-in.

---

## Por que ele existe

Existem dezenas de extensões que resumem vídeo. Quase todas devolvem cinco bullets e um paywall.

O Bruto entrega outra coisa: **material de estudo de verdade**. O modo *Estudar* monta uma aula sobre o vídeo — não um resumo mais longo, uma aula: o que você deveria saber ao final, cada conceito explicado desde o começo, um glossário dos termos que o autor assumiu que você conhecia, e um teste para você descobrir se entendeu mesmo.

E ele funciona onde os outros não vão: **Instagram e TikTok**. A maioria só faz YouTube porque depende de legenda pronta. Vídeo curto raramente tem — então o Bruto transcreve o áudio. (Verificado em 10/09/2026 com um reel real: metadados, Whisper, resumo, mapa mental e os exports, tudo de ponta a ponta.)

## Como funciona

1. `yt-dlp` busca metadados e legendas no idioma original, **sem baixar o vídeo**. Se não houver legenda, baixa só o áudio e transcreve com Whisper local.
2. Um modelo de linguagem gera resumo, mapa mental e classifica a categoria — tudo em PT-BR.
3. Vídeo em outro idioma pode ser traduzido por inteiro.
4. **Estudar** (sob demanda) monta a aula didática.
5. Exports em `.docx` e `.pdf`, com o mapa mental renderizado como imagem.
6. Catálogo em SQLite; arquivos em `~/.bruto/library/<id>/`.

Tudo local. Nenhum dado seu passa por servidor nosso — não existe servidor nosso.

## Instalação

```bash
git clone https://github.com/Ideia-Business/bruto.git
cd bruto

brew install yt-dlp                 # obrigatório
uv tool install mlx-whisper         # opcional — vídeos sem legenda
npm install
npx playwright install chromium     # exports .pdf + imagem do mapa
npm run db:push && npm run db:seed
npm run doctor                      # confere as dependências
```

### O modelo de linguagem — a sua chave, o seu custo

O Bruto precisa de um modelo para resumir. **Você escolhe qual, e a chave é sua.** Copie o exemplo e preencha **uma** linha:

```bash
cp .env.example .env
```

| Provedor | Variável | Onde pegar |
|---|---|---|
| Anthropic | `ANTHROPIC_API_KEY` | console.anthropic.com |
| OpenAI | `OPENAI_API_KEY` | platform.openai.com |
| OpenRouter | `OPENROUTER_API_KEY` | openrouter.ai — um cadastro, centenas de modelos |
| Ollama Cloud | `OLLAMA_API_KEY` | ollama.com — modelos abertos, hospedados |
| Google Gemini | `GOOGLE_API_KEY` | aistudio.google.com |
| Claude Code CLI | *nenhuma* | já autenticado na sua máquina |

Se você **já usa o Claude Code**, não precisa de chave nenhuma: o Bruto detecta o CLI e usa sua sessão. É o caminho de zero configuração.

A chave fica no seu `.env`, que está no `.gitignore`. Ela nunca sai da sua máquina, nunca vai para o repositório e nunca aparece em mensagem de erro — o texto de erro dos provedores é descartado no transporte, e só o código de status atravessa.

**Modelo:** o Bruto pede um *tier* (`fast` para classificar, `balanced` para resumo, mapa, aula e tradução) e cada provedor traduz para um modelo seu. Sobrescreva com `BRUTO_MODEL_BALANCED` se quiser outro — recomendado no OpenRouter e no Ollama Cloud, cujos catálogos são grandes e mudam com frequência.

`npm run doctor` mostra o estado de todos os provedores e diz qual está ativo.

## Uso

```bash
npm run dev            # http://localhost:3000
npm run app            # sobe produção e abre em janela de app (macOS)

# ou sem interface:
npm run process -- "https://www.youtube.com/watch?v=<id>" [--whisper] [--traduzir]
```

## Extensão de navegador

Resume o vídeo que você **já está assistindo**, sem sair da aba. Ela lê a legenda da página e chama o modelo com a sua chave — não baixa mídia nenhuma.

```bash
npm run build:ext
```

Depois, no Chrome: `chrome://extensions` → **Modo do desenvolvedor** → **Carregar sem compactação** → escolha `extension/dist`. Abra as opções da extensão, escolha o provedor e cole a sua chave.

A chave fica em `chrome.storage.local` — **só neste navegador**, nunca sincronizada com sua conta Google, nunca enviada para servidor nenhum nosso. A extensão fala direto com o provedor que você escolheu.

As aulas que você destrincha ficam na **Bancada**, no mesmo lugar: neste navegador, sem conta, sem nuvem. As 60 mais recentes; a bancada esquece a mais antiga quando enche. Fechar o popup não perde mais nada.

O resumo usa **exatamente o mesmo prompt** do app local: o build importa de `src/pipeline/prompts/`, então as duas superfícies nunca divergem.

Passo a passo de instalação e teste, com a tabela de erros comuns: [extension/TESTANDO.md](extension/TESTANDO.md).

### App clicável no macOS

```bash
bash launcher/install-app.sh
```

Cria **Bruto** em `~/Applications`. Duplo-clique sobe o servidor e abre numa janela dedicada.

## Stack

Next.js 16 · TypeScript · Tailwind + shadcn/ui · Drizzle + better-sqlite3 · yt-dlp · Whisper · docx · Playwright · markmap

## Contribuindo

Contribuições são bem-vindas — leia o [CONTRIBUTING.md](CONTRIBUTING.md) e, se for mexer em texto de interface ou tela, o [BRAND.md](BRAND.md) (léxico e tom, para os nomes ficarem iguais em todo lugar). Se você só quer relatar um bug ou pedir uma funcionalidade, abra uma issue: isso já ajuda muito.

## Quem faz, e por que é de graça

O Bruto é feito pela [Ideia Business](https://ideiabusiness.com.br), e vai continuar gratuito e MIT — não é isca com prazo, não vira assinatura depois.

Dito isso, sem rodeio: **ele também existe para você conhecer o que mais fazemos.** Nosso produto pago é o [Lapid.ai](https://lapid.ai), que pega uma ideia bruta e a transforma numa especificação de produto acionável. Se em algum momento um vídeo que você destrinchar aqui te der uma ideia, é para lá que ela vai — e você decide se quer ou não.

Achamos que isso é melhor dito na cara do que descoberto depois.

## Aviso de uso

Ferramenta de uso pessoal, para conteúdo público que você tem direito de acessar. Você é responsável por cumprir os termos de uso das plataformas e a legislação de direito autoral aplicável ao que processar. O software é fornecido "como está", sem garantias (ver [LICENSE](LICENSE)). Projeto independente, sem afiliação com YouTube, Instagram, TikTok, Anthropic, OpenAI ou Google.

## Atribuições

Componentes de UI derivados do [shadcn/ui](https://ui.shadcn.com) (MIT). O Bruto **invoca** — nunca redistribui — ferramentas externas instaladas por você, cada uma sob a própria licença: [yt-dlp](https://github.com/yt-dlp/yt-dlp) (Unlicense), [ffmpeg](https://ffmpeg.org) (LGPL/GPL conforme o build), [Whisper](https://github.com/openai/whisper) (MIT), [Playwright](https://playwright.dev) (Apache-2.0).

## Licença

[MIT](LICENSE) — use, modifique, distribua, inclusive comercialmente.

---

Feito pela [Ideia Business](https://ideiabusiness.com.br). Se o Bruto te for útil, dá uma ⭐ — é o que faz outras pessoas o encontrarem.
