# Testando a extensão

Como carregar a extensão no navegador e verificar que ela funciona de ponta a ponta. Leva uns cinco minutos.

Existe um trecho que **nenhum teste automático cobre**: a captura da legenda só roda depois que o Chrome concede a permissão `activeTab`, e essa permissão nasce do **clique de uma pessoa** no ícone da extensão. Robô não clica em ícone de extensão. Por isso este documento.

---

## 1. Tenha uma chave de IA em mãos

A extensão não usa o Claude Code CLI — ele é um binário local e não existe dentro do navegador. Você precisa de uma chave de API de verdade, de um destes cinco:

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

Ainda em `chrome://extensions`, no cartão do Bruto: **Detalhes** → **Opções da extensão**. (Ou clique no ícone do Bruto e depois em "Colocar a chave".)

1. Escolha o provedor.
2. Cole a chave.
3. Preencha o modelo, se o provedor pedir.
4. Clique em **Testar credencial** e espere o resultado. Isso faz uma chamada mínima de verdade — se falhar aqui, falharia depois, e é melhor saber agora.
5. **Salvar**.

A chave fica em `chrome.storage.local`: só neste navegador, sem sincronizar com sua conta Google, sem passar por servidor nenhum do Bruto.

## 5. Destrinche um vídeo

1. Abra um vídeo do YouTube **que tenha legenda**. Para o primeiro teste, prefira um vídeo em português, com legenda de verdade (não a automática) e de menos de 20 minutos — assim, se der errado, o erro é do código e não do material.
2. Clique no ícone do **Bruto**.
3. Clique em **Destrinchar**.

O esperado: *"Pegando a fala…"*, depois *"Fala pega: N caracteres. Destrinchando…"*, e o resumo aparece. Confira **Copiar** e **Baixar .md**.

---

## Se der errado

Antes de mais nada: **abra o console do popup**. Clique com o botão direito dentro do popup → **Inspecionar**. É lá que o erro real aparece — a mensagem na tela é a versão curta.

| O que aparece | O que provavelmente é | O que fazer |
|---|---|---|
| "Essa aba não tem um vídeo do YouTube" | a aba ativa não é uma página `/watch` | abra o vídeo em si, não a home nem a playlist |
| "Este vídeo não tem legenda disponível" | o vídeo não tem legenda mesmo | tente outro; o app local transcreve o áudio, a extensão não |
| "O provedor recusou a credencial" | chave errada, expirada ou sem crédito | refaça o passo 4 e use **Testar credencial** |
| "O provedor respondeu limite de uso" | cota ou rate limit | espere, ou troque de provedor |
| Nada acontece ao clicar | o content script não injetou | recarregue a aba do vídeo e tente de novo; se persistir, recarregue a extensão em `chrome://extensions` |
| Erro citando modelo inexistente | o modelo padrão não existe nesse provedor | preencha o campo de modelo nas opções |

**Depois de qualquer `npm run build:ext`**, clique no botão de recarregar no cartão da extensão em `chrome://extensions` — o Chrome não recarrega sozinho, e você estaria testando o pacote antigo.

## O que reportar

Se abrir uma issue, o que ajuda de verdade:

- o link do vídeo (ou que ele tem legenda manual/automática e em que idioma);
- qual provedor e qual modelo;
- a mensagem **do console do popup**, não só a da tela;
- se o **Testar credencial** das opções passou.
