# Resume Video

Sistema local-first: cole um link do YouTube e receba **resumo**, **transcrição** e **mapa mental** — exportáveis em **.docx** e **.pdf** — organizados num catálogo estilo Netflix, por categoria.

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

## Uso

```bash
npm run dev                        # app em http://localhost:3000
```

Ou via CLI, sem a interface:

```bash
npm run process -- "https://www.youtube.com/watch?v=<id>" [--whisper] [--traduzir]
```

## Stack

Next.js 16 · TypeScript · Tailwind + shadcn/ui · Drizzle + better-sqlite3 · yt-dlp · Whisper (vt.sh) · Claude CLI · docx · Playwright · markmap.
