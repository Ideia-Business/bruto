# Bruto

**Entra bruto, sai entendido.**

Cole o link de um vídeo — YouTube, Instagram ou TikTok — e receba **resumo**, **transcrição**, **mapa mental** e uma **aula completa** em português: objetivos, conceitos explicados do zero, glossário e teste de fixação. Exporta `.docx` e `.pdf`.

Roda na sua máquina, com a sua chave de IA. Sem assinatura, sem limite, sem lock-in.

---

## Por que ele existe

Existem dezenas de extensões que resumem vídeo. Quase todas devolvem cinco bullets e um paywall.

O Bruto entrega outra coisa: **material de estudo de verdade**. O modo *Estudar* monta uma aula sobre o vídeo — não um resumo mais longo, uma aula: o que você deveria saber ao final, cada conceito explicado desde o começo, um glossário dos termos que o autor assumiu que você conhecia, e um teste para você descobrir se entendeu mesmo.

E ele funciona onde os outros não vão: **Instagram e TikTok**. A maioria só faz YouTube porque depende de legenda pronta. Vídeo curto raramente tem — então o Bruto transcreve o áudio.

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

### O modelo de linguagem

O Bruto precisa de um modelo para resumir. **Hoje ele usa o [Claude Code CLI](https://claude.ai/code)**, que autentica pela sua própria sessão — nenhuma chave de API é necessária, e nenhum custo passa por nós.

```bash
# se ainda não tiver:  npm i -g @anthropic-ai/claude-code  &&  claude login
claude --version                    # o `npm run doctor` também confere
```

> **Transparência sobre o roadmap:** o suporte a **chave própria** de Anthropic, OpenAI e Google (BYOK) é a próxima entrega e vai remover a dependência do CLI. Enquanto não sai, o Claude Code CLI é obrigatório — está escrito aqui para você não descobrir isso depois de clonar.

## Uso

```bash
npm run dev            # http://localhost:3000
npm run app            # sobe produção e abre em janela de app (macOS)

# ou sem interface:
npm run process -- "https://www.youtube.com/watch?v=<id>" [--whisper] [--traduzir]
```

### App clicável no macOS

```bash
bash launcher/install-app.sh
```

Cria **Bruto** em `~/Applications`. Duplo-clique sobe o servidor e abre numa janela dedicada.

## Stack

Next.js 16 · TypeScript · Tailwind + shadcn/ui · Drizzle + better-sqlite3 · yt-dlp · Whisper · docx · Playwright · markmap

## Contribuindo

Contribuições são bem-vindas — leia o [CONTRIBUTING.md](CONTRIBUTING.md). Se você só quer relatar um bug ou pedir uma funcionalidade, abra uma issue: isso já ajuda muito.

## Aviso de uso

Ferramenta de uso pessoal, para conteúdo público que você tem direito de acessar. Você é responsável por cumprir os termos de uso das plataformas e a legislação de direito autoral aplicável ao que processar. O software é fornecido "como está", sem garantias (ver [LICENSE](LICENSE)). Projeto independente, sem afiliação com YouTube, Instagram, TikTok, Anthropic, OpenAI ou Google.

## Atribuições

Componentes de UI derivados do [shadcn/ui](https://ui.shadcn.com) (MIT). O Bruto **invoca** — nunca redistribui — ferramentas externas instaladas por você, cada uma sob a própria licença: [yt-dlp](https://github.com/yt-dlp/yt-dlp) (Unlicense), [ffmpeg](https://ffmpeg.org) (LGPL/GPL conforme o build), [Whisper](https://github.com/openai/whisper) (MIT), [Playwright](https://playwright.dev) (Apache-2.0).

## Licença

[MIT](LICENSE) — use, modifique, distribua, inclusive comercialmente.

---

Feito pela [Ideia Business](https://ideiabusiness.com.br). Se o Bruto te for útil, dá uma ⭐ — é o que faz outras pessoas o encontrarem.
