# Onde o Bruto está, e para onde vai

Documento honesto de estado. O que está marcado como pronto foi **exercido de verdade** — com vídeo real, chave real e o resultado conferido —, não apenas compilado.

Última revisão: 11/09/2026.

---

## Pronto

### O app local

Cole um link de YouTube, Instagram ou TikTok e receba resumo, transcrição, mapa mental e a Aula. Exporta `.docx` e `.pdf`. Catálogo em SQLite; arquivos em `~/.bruto/library/`.

**Verificado em 10/09/2026** com um reel do Instagram: metadados → áudio → Whisper → resumo → mapa mental → 9 artefatos. Whisper errou palavras na transcrição e o resumo as corrigiu pelo contexto.

### Transcrição local, sem script externo

Vídeo sem legenda é transcrito na própria máquina, por um de três backends detectados
automaticamente: mlx-whisper, a CLI `whisper` da OpenAI ou whisper.cpp. Não há dependência de
script de fora do repositório — o que antes só funcionava em máquina com a skill interna da casa
instalada agora funciona em clone limpo. O backend de REDE do script antigo (a API de
transcrição da OpenAI) não foi portado de propósito: transcrever áudio não precisa de
credencial, e o que não precisa de credencial não recebe credencial.

**Verificado em 11/09/2026, nos três backends** — cada um instalado e exercido com um áudio de
conteúdo conhecido, que voltou correto em todos:

| Backend | Tempo no mesmo áudio |
|---|---|
| mlx-whisper | 2,1 s |
| whisper.cpp | 14,8 s |
| whisper CLI (OpenAI) | 19,5 s |

Também exercidos: vídeo real baixado e transcrito de ponta a ponta; segunda chamada servida pelo
cache; e o caminho de falha, com o PATH sem transcritor nenhum, devolvendo `NO_TRANSCRIPT` com as
três instalações possíveis nomeadas.

### Sete caminhos para o modelo — dois pelo seu plano, cinco por chave

**Pelo plano, sem chave nenhuma:** Claude Code CLI (plano Claude) e Codex CLI (plano ChatGPT), pela sessão já autenticada na máquina. Os dois **confirmam positivamente** que a sessão é de plano e recusam autenticação por chave de API — inclusive `codex login --with-api-key`, que passa no mesmo comando de status e cobraria por token dizendo que não cobrava.

**Por chave:** Anthropic, OpenAI, OpenRouter, Ollama Cloud e Google. Sem dependência nova: são chamadas `fetch` diretas, e os três que falam o dialeto da OpenAI compartilham uma fábrica — acrescentar mais um é uma chamada de função (foi assim que o Codex entrou).

O pipeline pede **tier** (`fast`, `balanced`), nunca nome de modelo. Erro é classificado por status HTTP, e o corpo da resposta do fornecedor **nunca** atravessa a camada de rede: ele pode conter a chave de quem usa, e mensagem de erro acaba gravada em banco.

### A extensão de navegador

Resume o vídeo que você já está assistindo. Lê o painel "Mostrar transcrição" que o próprio YouTube renderiza — **nunca baixa mídia**, porque a Chrome Web Store proíbe e porque não é preciso. Shorts funcionam: a extensão abre o mesmo vídeo pela rota `/watch`, que tem o painel.

O resumo usa **exatamente o mesmo prompt** do app local — o build importa de `src/pipeline/prompts/`, então as duas superfícies não podem divergir.

As aulas ficam na **Bancada**, em `chrome.storage.local`: neste navegador, sem conta, sem nuvem.

**Verificado em 10/09/2026** com um Short real e chave do Google: redirecionamento, captura, resumo correto.

### Caderno de Ideias

Ao fim de uma Aula, uma pergunta — *"isso te deu alguma ideia?"* — e um campo livre. É a única coisa que **você** produz aqui, e fica no navegador, sem conta.

**Verificado em 11/09/2026.**

### A ponte

No Caderno, cada faísca tem um botão **Lapidar**: ele copia a ideia e abre o [Lapid.ai](https://lapid.ai), que a transforma numa especificação de produto. O que atravessa é **a anotação de quem escreveu**, nunca o resumo do vídeo — o Lapid trabalha a ideia da pessoa, e mandar para lá o resumo de um vídeo alheio produziria uma especificação do produto *do vídeo*: plausível e inútil.

É a única menção ao produto pago dentro da extensão, e aparece só onde há ideia sua para levar.

**Verificado em 11/09/2026.**

### Integração contínua

Tipos, lint, build do app, build da extensão, e conferência item a item do que o Chrome exige para carregar o pacote.

---

## A seguir

### Extensão na Chrome Web Store — pronta para envio

Tudo o que depende de código está feito: a [política de privacidade](extension/PRIVACIDADE.md),
os textos da listagem com as respostas do questionário de privacidade
([extension/LOJA.md](extension/LOJA.md)), e o empacotador `npm run package:ext`, que reprova
antes de gastar uma revisão da Loja — arquivo faltando, versão divergente, texto acima do
limite, ícone declarado e ausente, código remoto. O CI roda a mesma conferência a cada push.

Falta o que exige conta e cartão: conta de desenvolvedor (US$ 5, taxa única), uma captura de
tela e o envio. O passo a passo está no `LOJA.md`.


### Fase 3b — Conta e Cota da Casa (adiado por decisão)

Quem não quiser configurar chave própria ganharia uma cota pequena da casa. Exige Postgres, autenticação e contagem de uso.

**Adiado de propósito**, não esquecido: é a única parte do projeto com custo recorrente — servidor mais a IA que a casa paga por quem não tem chave. Construir antes de existir gente pedindo é pagar infraestrutura para um público hipotético. O Caderno de Ideias, que era a peça útil desta fase, foi entregue sem servidor nenhum.

Há uma dívida de modelagem a pagar quando ela vier: hoje `brutos.id` é o identificador do vídeo na plataforma, usado como chave primária. Com duas pessoas, o mesmo vídeo colide e uma sobrescreve o resumo da outra. A cura é separar o **vídeo canônico** (global, sem dono) da **entrada de biblioteca** (por pessoa).

---

## Limitações conhecidas

| O quê | Por quê |
|---|---|
| A extensão destrincha sozinha só no YouTube | Instagram e TikTok não expõem transcrição na página. Em ambas, a extensão encaminha ao app local (que precisa estar aberto) para transcrever o áudio |
| A extensão precisa que o vídeo tenha o botão "Mostrar transcrição" | É de lá que ela lê. Sem transcrição publicada, não há o que capturar |
| O endpoint `/api/timedtext` do YouTube está fechado | Desde ~09/2026 devolve resposta vazia com status de sucesso para requisição feita de dentro do navegador. Não afeta o app local, que usa `yt-dlp` |
| Não está na Chrome Web Store | Exige conta de desenvolvedor, política de privacidade e revisão. Por ora, carrega-se sem compactação |
| Sem testes automatizados de unidade | O CI cobre tipos, lint e build. As verificações de comportamento foram feitas à mão, com vídeo real — e estão descritas nos commits |
| Os modelos padrão envelhecem | O Gemini 2.0 Flash foi aposentado e virou 404. O campo **Modelo**, nas opções e no `.env`, existe para você contornar sem esperar correção |

---

## Como ajudar

O mais útil não é código: é relatar o que quebrou, com o link do vídeo e a mensagem **do console** do popup. Veja [CONTRIBUTING.md](CONTRIBUTING.md) e, se for mexer em texto ou tela, [BRAND.md](BRAND.md).
