# Testando a extensão

Como carregar a extensão no navegador e verificar que ela funciona de ponta a ponta. Leva uns cinco minutos.

Existe um trecho que **nenhum teste automático cobre**: a captura da legenda só roda depois que o Chrome concede a permissão `activeTab`, e essa permissão nasce do **clique de uma pessoa** no ícone da extensão. Robô não clica em ícone de extensão. Por isso este documento.

---

## 1. Escolha o modo que você vai testar

São dois, e a extensão decide sozinha qual usar. **Teste os dois** — cada um tem o seu jeito de falhar.

| Modo | Quando acontece | O que conferir |
|---|---|---|
| **Plano** | o app do Bruto está rodando em `http://127.0.0.1:3000` com um provedor de plano pronto | as opções dizem "Usando o seu plano"; a aula sai **sem nenhuma chave configurada** |
| **Chave** | sem app, ou app sem provedor de plano | as opções dizem "Usando chave de API — você paga por uso", **e explicam por quê** |

O modo é detectado quando o popup (ou a tela de opções) **abre**. Subiu o app depois? Feche e abra de novo — não há nada para clicar.

Para o modo plano, suba o app (`npm run app`) e confirme antes:

```bash
curl -s http://127.0.0.1:3000/api/llm/saude
# tem de responder {"ok":true,"provedores":[...]} com algum `"plano":true,"disponivel":true`
```

Para o modo chave, você precisa de uma chave de API de verdade, de um destes cinco. (A extensão não executa o Claude Code CLI: ele é um binário local, e binário não roda dentro do navegador — é justamente por isso que o modo plano passa pelo app.)

| Provedor | Onde pegar | Nota |
|---|---|---|
| **OpenRouter** | [openrouter.ai/keys](https://openrouter.ai/keys) | tem modelos gratuitos — o caminho mais barato para um primeiro teste |
| **Google Gemini** | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | tem camada gratuita |
| Anthropic | [console.anthropic.com](https://console.anthropic.com) | |
| OpenAI | [platform.openai.com](https://platform.openai.com) | |
| Ollama Cloud | [ollama.com](https://ollama.com) | modelos abertos hospedados |

Deixe a chave copiada antes de seguir — assim você visita a tela de opções uma vez só.

> **Se escolher OpenRouter ou Ollama Cloud**, separe também o nome de um modelo: o catálogo deles é grande e muda, então o campo de modelo é obrigatório. No OpenRouter, algo como `openai/gpt-4o-mini` serve.

## 2. Monte o pacote

```bash
cd ~/dev/bruto
npm install          # só na primeira vez
npm run build:ext
```

A saída termina em `✔ extensão em extension/dist`. É essa pasta que o Chrome carrega — não a `extension/` inteira.

> Se aparecer *"ícones não gerados"*, é cosmético e não impede nada. Para ter o ícone próprio: `npx playwright install chromium` e rode o build de novo.

## 3. Carregue no Chrome

1. Abra `chrome://extensions`.
2. Ligue o **Modo do desenvolvedor** (canto superior direito).
3. Clique em **Carregar sem compactação**.
4. Escolha a pasta `extension/dist` — dentro do repositório, não outra.

A extensão aparece como **"Bruto — vídeo vira aula"**.

5. **Fixe o ícone na barra**: clique no ícone de peça de quebra-cabeça, ao lado da barra de endereço, e no alfinete ao lado do Bruto. Sem isso não há onde clicar, e sem clique não há permissão.

## 4. Coloque a chave

Ainda em `chrome://extensions`, no cartão do Bruto: **Detalhes** → role até quase o fim → **Opções de extensão** (é esse o nome exato na interface em português, logo acima de "Abrir o site da extensão", com um ícone de link externo).

Também dá para chegar clicando no ícone do Bruto na barra e depois em **Colocar a chave**.

1. Escolha o provedor.
2. Cole a chave.
3. Preencha o modelo, se o provedor pedir.
4. Clique em **Testar credencial** e espere o resultado. Isso faz uma chamada mínima de verdade — se falhar aqui, falharia depois, e é melhor saber agora.
5. **Salvar**.

A chave fica em `chrome.storage.local`: só neste navegador, sem sincronizar com sua conta Google, sem passar por servidor nenhum do Bruto.

### Se o provedor não responder: libere o acesso ao site dele

Na mesma tela de **Detalhes**, em **"Acesso a sites"**, aparecem os cinco domínios dos provedores. Dependendo da versão do Chrome e de como a extensão foi carregada, eles vêm **desligados** — e aí a chamada ao modelo falha com erro de rede, sem dizer o motivo real.

Ligue o interruptor do domínio do provedor que você escolheu:

| Provedor | Domínio a liberar |
|---|---|
| Anthropic | `https://api.anthropic.com/*` |
| OpenAI | `https://api.openai.com/*` |
| Google Gemini | `https://generativelanguage.googleapis.com/*` |
| OpenRouter | `https://openrouter.ai/*` |
| Ollama Cloud | `https://ollama.com/*` |

Você só precisa do domínio do provedor que vai usar — deixar os outros desligados é o correto.

## 5. Destrinche um vídeo

1. Abra um vídeo do YouTube **que tenha o botão "Mostrar transcrição"** (na descrição, depois de clicar em "...mais"). Se esse botão não existir no vídeo, o Bruto não tem o que ler.

> **Shorts funcionam**, com um detalhe visível: a interface de Shorts não tem painel de transcrição, mas o mesmo vídeo aberto como `/watch?v=<id>` tem. Ao clicar em Destrinchar num Short, o Bruto **muda a sua aba** para a rota normal e avisa que está fazendo isso. Não é falha — é o único caminho que o YouTube deixa aberto.
2. Clique no ícone do **Bruto**.
3. Clique em **Destrinchar**.

O esperado: *"Pegando a fala…"*, depois *"Fala pega: N caracteres. Destrinchando…"*, e a **Aula** aparece. Confira **Copiar** e **Baixar .md**.

A Aula tem seções fixas, e é isso que a listagem da Loja promete — **confira as quatro**: *O que você vai aprender*, *A aula* (em 3 a 6 conceitos), *Glossário essencial* e *Teste seu entendimento*. No teste, cada resposta começa **escondida**: clique em "Ver resposta" para abrir. Se as respostas vierem à mostra, ou aparecer `<details>` escrito por extenso na tela, o renderizador quebrou — é o caso de `tests/extension/markdown.test.ts`.

Feche o popup e abra de novo: clique em **Bancada**, no topo. A aula tem de estar lá.

---

## Se der errado

Antes de mais nada: **abra o console do popup**. Clique com o botão direito dentro do popup → **Inspecionar**. É lá que o erro real aparece — a mensagem na tela é a versão curta.

| O que aparece | O que provavelmente é | O que fazer |
|---|---|---|
| "Essa aba não tem um vídeo do YouTube" | a aba ativa não é uma página `/watch` | abra o vídeo em si, não a home nem a playlist |
| "Este vídeo não tem transcrição publicada" | o vídeo não tem o botão "Mostrar transcrição" | tente outro; o app local transcreve o áudio, a extensão não |
| A aba mudou de `/shorts/` para `/watch` sozinha | é o comportamento esperado | nada a fazer; é assim que se chega à transcrição |
| "abriu a transcrição mas não a carregou" | o YouTube não respondeu, ou você não está logado | recarregue; confira se está logado no YouTube |
| "O provedor recusou a credencial" | chave errada, expirada ou sem crédito | refaça o passo 4 e use **Testar credencial** |
| "O provedor respondeu limite de uso" | cota ou rate limit | espere, ou troque de provedor |
| Nada acontece ao clicar | o content script não injetou | recarregue a aba do vídeo e tente de novo; se persistir, recarregue a extensão em `chrome://extensions` |
| "está fora do ar" ou erro de rede logo na primeira chamada | o acesso ao site do provedor está desligado | Detalhes → **Acesso a sites** → ligue o domínio do seu provedor (tabela no passo 4) |
| Erro citando modelo inexistente | o modelo padrão não existe nesse provedor | preencha o campo de modelo nas opções |

**Depois de qualquer `npm run build:ext`**, clique no botão de recarregar no cartão da extensão em `chrome://extensions` — o Chrome não recarrega sozinho, e você estaria testando o pacote antigo.

## O que reportar

Se abrir uma issue, o que ajuda de verdade:

- o link do vídeo (ou que ele tem legenda manual/automática e em que idioma);
- qual provedor e qual modelo;
- a mensagem **do console do popup**, não só a da tela;
- se o **Testar credencial** das opções passou.
