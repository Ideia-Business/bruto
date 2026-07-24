# Resume Video

Sistema local-first: cole um link do **YouTube, Instagram (reel) ou TikTok** e receba **resumo**, **transcrição** e **mapa mental** — exportáveis em **.docx** e **.pdf** — organizados num catálogo estilo Netflix, por categoria.

## Como funciona

1. `yt-dlp` baixa metadados + legendas (idioma original) sem baixar o vídeo; fallback para áudio → Whisper local quando não há legenda.
2. `claude -p` (headless, sua subscription — sem API key) gera resumo, mapa mental e classifica a categoria, tudo em PT-BR.
3. Vídeos em outro idioma podem ter tudo traduzido para PT-BR (opção "Traduzir tudo").
4. **Estudar** (sob demanda): monta uma aula didática — objetivos, conceitos explicados do zero, glossário, teste de fixação interativo e referências para aprofundar.
5. Exports: `.docx` (lib docx) e `.pdf` (Chromium headless), com o mapa mental renderizado como imagem (markmap via Playwright).
6. Catálogo em SQLite; arquivos em `~/.resume-video/library/<id>/`.

## Setup

```bash
brew install yt-dlp                # obrigatório
uv tool install mlx-whisper        # opcional (vídeos sem legenda / transcrição fiel)
npm install
npx playwright install chromium    # para exports pdf + imagem do mapa
npm run db:push && npm run db:seed  # cria o banco e as categorias
npm run doctor                     # confere as dependências
```

## Abrir como aplicativo (macOS)

Para ter um ícone clicável no Launchpad que sobe o servidor e abre em janela de app:

```bash
bash launcher/install-app.sh
```

Isso cria **"Resume Video"** em `~/Applications`. Dê duplo-clique — ele inicia o
servidor (se preciso) e abre numa janela dedicada do Chrome (sem barra, cara de
app). Também dá para instalar como PWA pelo próprio Chrome (⋮ → "Instalar Resume Video").

## Uso (desenvolvimento)

```bash
npm run dev                        # app em http://localhost:3000 (hot reload)
npm run app                        # sobe produção e abre a janela de app
```

Ou via CLI, sem a interface:

```bash
npm run process -- "https://www.youtube.com/watch?v=<id>" [--whisper] [--traduzir]
```

## Stack

Next.js 16 · TypeScript · Tailwind + shadcn/ui · Drizzle + better-sqlite3 · yt-dlp · Whisper (vt.sh) · Claude CLI · docx · Playwright · markmap.
