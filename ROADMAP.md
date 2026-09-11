# Onde o Bruto está, e para onde vai

Documento honesto de estado. O que está marcado como pronto foi **exercido de verdade** — com vídeo real, chave real e o resultado conferido —, não apenas compilado.

Última revisão: 11/09/2026.

---

## Pronto

### O app local

Cole um link de YouTube, Instagram ou TikTok e receba resumo, transcrição, mapa mental e a Aula. Exporta `.docx` e `.pdf`. Catálogo em SQLite; arquivos em `~/.bruto/library/`.

**Verificado em 10/09/2026** com um reel do Instagram: metadados → áudio → Whisper → resumo → mapa mental → 9 artefatos. Whisper errou palavras na transcrição e o resumo as corrigiu pelo contexto.

### Seis caminhos para o modelo, com a sua chave

Claude Code CLI (sem chave, pela sessão local), Anthropic, OpenAI, OpenRouter, Ollama Cloud e Google. Sem dependência nova: os provedores de API são chamadas `fetch` diretas, e os três que falam o dialeto da OpenAI compartilham uma fábrica — acrescentar um sétimo é uma chamada de função.

O pipeline pede **tier** (`fast`, `balanced`), nunca nome de modelo. Erro é classificado por status HTTP, e o corpo da resposta do fornecedor **nunca** atravessa a camada de rede: ele pode conter a chave de quem usa, e mensagem de erro acaba gravada em banco.

### A extensão de navegador

Resume o vídeo que você já está assistindo. Lê o painel "Mostrar transcrição" que o próprio YouTube renderiza — **nunca baixa mídia**, porque a Chrome Web Store proíbe e porque não é preciso. Shorts funcionam: a extensão abre o mesmo vídeo pela rota `/watch`, que tem o painel.

O resumo usa **exatamente o mesmo prompt** do app local — o build importa de `src/pipeline/prompts/`, então as duas superfícies não podem divergir.

As aulas ficam na **Bancada**, em `chrome.storage.local`: neste navegador, sem conta, sem nuvem.

**Verificado em 10/09/2026** com um Short real e chave do Google: redirecionamento, captura, resumo correto.

### Caderno de Ideias

Ao fim de uma Aula, uma pergunta — *"isso te deu alguma ideia?"* — e um campo livre. É a única coisa que **você** produz aqui, e fica no navegador, sem conta.

**Verificado em 11/09/2026.**

### Integração contínua

Tipos, lint, build do app, build da extensão, e conferência item a item do que o Chrome exige para carregar o pacote.

---

## A seguir

### Fase 4 — A ponte

A faísca capturada no Caderno de Ideias atravessa para o [Lapid.ai](https://lapid.ai), que transforma ideia bruta em especificação de produto. O que atravessa é **a anotação de quem escreveu**, não o resumo do vídeo: o Lapid trabalha a ideia da pessoa, e mandar para lá o resumo de um vídeo alheio produziria uma especificação do produto *do vídeo* — plausível e inútil.

### Fase 3b — Conta e Cota da Casa (adiado por decisão)

Quem não quiser configurar chave própria ganharia uma cota pequena da casa. Exige Postgres, autenticação e contagem de uso.

**Adiado de propósito**, não esquecido: é a única parte do projeto com custo recorrente — servidor mais a IA que a casa paga por quem não tem chave. Construir antes de existir gente pedindo é pagar infraestrutura para um público hipotético. O Caderno de Ideias, que era a peça útil desta fase, foi entregue sem servidor nenhum.

Há uma dívida de modelagem a pagar quando ela vier: hoje `videos.id` é o identificador do vídeo na plataforma, usado como chave primária. Com duas pessoas, o mesmo vídeo colide e uma sobrescreve o resumo da outra. A cura é separar o **vídeo canônico** (global, sem dono) da **entrada de biblioteca** (por pessoa).

---

## Limitações conhecidas

| O quê | Por quê |
|---|---|
| A extensão só faz YouTube | Instagram e TikTok não expõem transcrição na página. Quem dá conta deles é o app local, que transcreve o áudio |
| A extensão precisa que o vídeo tenha o botão "Mostrar transcrição" | É de lá que ela lê. Sem transcrição publicada, não há o que capturar |
| O endpoint `/api/timedtext` do YouTube está fechado | Desde ~09/2026 devolve resposta vazia com status de sucesso para requisição feita de dentro do navegador. Não afeta o app local, que usa `yt-dlp` |
| Não está na Chrome Web Store | Exige conta de desenvolvedor, política de privacidade e revisão. Por ora, carrega-se sem compactação |
| Sem testes automatizados de unidade | O CI cobre tipos, lint e build. As verificações de comportamento foram feitas à mão, com vídeo real — e estão descritas nos commits |
| Os modelos padrão envelhecem | O Gemini 2.0 Flash foi aposentado e virou 404. O campo **Modelo**, nas opções e no `.env`, existe para você contornar sem esperar correção |

---

## Como ajudar

O mais útil não é código: é relatar o que quebrou, com o link do vídeo e a mensagem **do console** do popup. Veja [CONTRIBUTING.md](CONTRIBUTING.md) e, se for mexer em texto ou tela, [BRAND.md](BRAND.md).
