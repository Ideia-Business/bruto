# Contribuindo com o Bruto

Obrigado por considerar contribuir. Este documento é curto de propósito — se algo aqui te travar, abra uma issue perguntando; a dúvida provavelmente é falha nossa de documentação.

## O jeito mais fácil de ajudar

Não precisa escrever código:

- **Relatar bug** — abra uma issue com o link do vídeo (se puder), o que esperava e o que aconteceu.
- **Pedir funcionalidade** — conte o problema que você tem, não a solução que imaginou. Ajuda mais.
- **Melhorar a documentação** — se você tropeçou na instalação, outra pessoa vai tropeçar também.
- **Traduzir** — o produto é PT-BR nativo, mas a interface pode falar outras línguas.

## Ambiente

```bash
git clone https://github.com/Ideia-Business/bruto.git
cd bruto
npm install
npx playwright install chromium
npm run db:push && npm run db:seed
npm run doctor          # diz exatamente qual dependência falta
npm run dev
```

Requer Node 20+, `yt-dlp` no PATH e o Claude Code CLI (ver README). `npm run doctor` é a fonte da verdade sobre o que está faltando.

## Como o código está organizado

```
src/
├─ pipeline/
│  ├─ steps/       01-metadata → 07-study — cada etapa isolada e testável
│  ├─ lib/         adaptadores externos (yt-dlp, whisper, LLM, paths)
│  └─ prompts/     todo texto enviado ao modelo mora aqui
├─ app/            Next.js (App Router) — páginas e rotas de API
├─ db/             schema Drizzle + queries
└─ components/     UI (shadcn/ui + componentes próprios)
```

Duas regras que valem mais que as outras:

1. **Prompt é conteúdo, não código.** Mudança de comportamento do modelo vai em `src/pipeline/prompts/`, nunca embutida num step.
2. **Adaptador externo fica em `pipeline/lib/`.** Se você precisa chamar um binário ou uma API, isole ali — o resto do pipeline não deve saber que ferramenta é.

## Pull requests

- Uma mudança por PR. PR que faz três coisas leva três vezes mais tempo para ser revisado.
- Descreva **o problema** no corpo do PR, não só a solução.
- Rode antes de abrir:
  ```bash
  npm run lint
  npx tsc --noEmit
  npm run build
  ```
- Mensagem de commit no imperativo, em português ou inglês: `corrige download de áudio do TikTok`.
- Não reformate arquivos que sua mudança não toca — o diff fica ilegível e a revisão morre.

## O que provavelmente será recusado

Melhor saber antes de gastar seu tempo:

- **Telemetria, analytics ou "phone home"** de qualquer natureza. O Bruto roda na máquina da pessoa e não conversa com servidor nosso. Isso não é negociável.
- **Dependência nova** que substitui algo que a linguagem ou o framework já resolvem.
- **Funcionalidade de download de vídeo** para além do necessário à transcrição — muda o caráter da ferramenta e cria problema de política de plataforma.
- **Mudança de licença.**

## Segurança

Achou algo que expõe dados ou credenciais de usuário? **Não abra issue pública.** Escreva para `desenvolvimento@ideiabusiness.com.br` e nós respondemos.

## Licença

Ao contribuir, você concorda que sua contribuição seja licenciada sob a [MIT](LICENSE), como o resto do projeto.
