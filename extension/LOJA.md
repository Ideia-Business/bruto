# Envio à Chrome Web Store — o que já está pronto e o que falta

Este documento existe para que o envio seja **colar e conferir**, não escrever sob pressão. Os
textos abaixo já respeitam os limites de caracteres de cada campo do console.

Demanda no DevTasks: `7d0dff5e-ac73-4ff1-9dd3-24279f232fcd`.

---

## O que só você pode fazer

Nada disto é automatizável — exige conta, cartão e cliques:

1. **Conta de desenvolvedor** — taxa **única** de US$ 5, sob a identidade da empresa.
   Passo a passo detalhado na seção **[Criar a conta de desenvolvedor](#criar-a-conta-de-desenvolvedor)**,
   no fim deste documento. Leia antes de abrir o console: a primeira decisão é irreversível.
2. **Colar o endereço da política de privacidade** no console. Não precisa hospedar nada: o
   arquivo está versionado e o endereço já responde publicamente (conferido em 12/09/2026,
   `HTTP 200` sem nenhuma credencial). Cole exatamente isto:

   ```
   https://github.com/Ideia-Business/bruto/blob/main/extension/PRIVACIDADE.md
   ```

3. **A captura que vende o produto** — a aula pronta na tela. Ela precisa da sua chave de IA e de
   um vídeo real, então nenhum agente pode produzi-la: usar a sua chave gastaria o seu dinheiro, e
   montar a tela com texto inventado seria captura falsa, que é motivo de recusa. São dois minutos:

   ```bash
   npm run build:ext
   node scripts/captura-loja.mjs --ao-vivo
   ```

   O Chromium abre com a extensão já carregada. Ponha a chave, destrinche um vídeo, deixe a aula na
   tela e aperte ENTER no terminal — sai um PNG 1280×800 em `extension/pacote/capturas/`.
   Vale repetir para a Bancada com algumas aulas e para o Caderno com o botão Lapidar.

4. **Enviar o `.zip`** e responder o questionário de privacidade (respostas prontas abaixo).

## O que já está pronto

```bash
npx playwright install chromium   # só na primeira vez — é o que gera os ícones
npm run package:ext
# → extension/pacote/bruto-0.2.0.zip
```

O empacotador reprova, com código de saída, antes de você gastar uma revisão: arquivo
obrigatório faltando, versão do manifesto divergente da do `package.json`, texto acima do limite
da Loja, ícone declarado e ausente, e script remoto (que a Loja proíbe). O CI roda a mesma
conferência a cada push.

> ⚠️ **Gere o pacote com o Chromium instalado.** Sem ele o build sai sem ícones e a Loja recusa.
> O script avisa em letras garrafais quando isso acontece — mas o aviso só ajuda quem lê. Para
> conferir sem depender do aviso: `unzip -p extension/pacote/bruto-*.zip manifest.json` tem de
> mostrar a chave `icons`, e `unzip -l` os três PNG que ela declara.

E duas capturas de instalação limpa — a tela de opções e o primeiro uso do popup — saem sozinhas,
já no tamanho da Loja:

```bash
node scripts/captura-loja.mjs
# → extension/pacote/capturas/opcoes.png e popup-primeiro-uso.png (1280×800)
```

Servem de apoio na listagem. A captura principal continua sendo a da aula pronta, que depende da
sua chave — item 3 acima.

---

## Imagens da listagem (regras oficiais, conferidas em 25/09/2026)

| Peça | Tamanho | Situação |
|---|---|---|
| Ícone da loja | 128×128 | obrigatório · `extension/dist/icons/128.png` |
| Imagem promocional pequena | 440×280 | **obrigatório** · `extension/pacote/capturas/promo-440x280.png` (gerada da marca) |
| Capturas | 1280×800, de 1 a 5 | obrigatório ao menos 1 · falta a da aula (só o dono) |
| Destaque (*marquee*) | 1400×560 | opcional · `extension/pacote/capturas/marquee-1400x560.png` |

Guia passo a passo completo, com todos os textos para copiar: gerado em 25/09/2026 como HTML
(`guia-chrome-web-store-bruto.html`, entregue ao dono).

## O que a extensão entrega — conferido contra o código

Auditoria de 12/09/2026, cruzando os textos daqui com o código. O achado foi de uma classe só:
**os textos descreviam o aplicativo local, não a extensão.** Resolvido em 13/09, por decisão do
dono, pelo caminho de fazer o produto cumprir o texto — não o contrário.

| Entrega | Aplicativo local | Extensão |
|---|---|---|
| Aula: objetivos, conceitos do zero, glossário, teste de fixação | sim | **sim** (YouTube); **sim via app local** (Instagram, TikTok) |
| Transcrição para quem usa | sim | **não** — a fala é lida e mandada ao provedor, e nunca aparece na tela nem no arquivo |
| Mapa mental | sim (`src/pipeline/prompts/mindmap.ts`) | **não** — não existe mapa na extensão |
| Instagram e TikTok | sim | **sim, encaminha ao app local** — se app não está aberto, avisa |

As duas linhas com **não** saíram da descrição curta e do manifesto: um texto de loja não promete
o que a surface não faz, ainda que o projeto faça noutro lugar. As duas continuam sendo do
aplicativo local, e a descrição completa é quem diz isso a quem lê.

> Antes de 13/09 a extensão chamava a saída de "Aula" e produzia um resumo executivo — o popup
> importava `summaryPrompt`. Quem mexer aqui: a Aula é a saída contratada com a Loja, e trocar o
> prompt de volta tornaria a listagem falsa.

---

## Os campos da listagem

**Nome** (45 caracteres no console; o manifesto permite 75)

```
Bruto — vídeo vira aula
```

**Descrição curta** (máx. 132 — a que aparece no card de busca; é o `description` do manifesto)

```
Vira o vídeo do YouTube numa aula em português, pelo plano de IA que você já assina ou por chave. Instagram e TikTok: app local.
```

> A versão anterior deste campo dizia "resumo, **transcrição** e **mapa mental**". Nenhum dos dois
> últimos existe na extensão — são do aplicativo local. Ver a seção acima.

**Categoria:** Produtividade · **Idioma principal:** Português (Brasil)

**Descrição completa** (máx. 16.000)

```
O Bruto não resume. Ensina.

As dezenas de extensões que resumem vídeo devolvem cinco bullets e um paywall. O Bruto entrega uma aula: o que você deveria saber ao final, cada conceito explicado desde o começo, um glossário dos termos que o autor assumiu que você já conhecia, e um teste para descobrir se entendeu mesmo.

COMO FUNCIONA

NO YOUTUBE
Abra um vídeo, clique no ícone do Bruto e em Destrinchar. Ele lê a transcrição que o próprio YouTube publica na página — nunca baixa vídeo nem áudio — e monta a aula em português.

EM INSTAGRAM E TIKTOK
Num Reel ou num vídeo do TikTok, o ícone do Bruto reconhece a plataforma e oferece o botão Destrinchar no app local. Ele manda o link ao aplicativo do Bruto, que precisa estar aberto na sua máquina: o app transcreve o áudio e monta a aula. Se o app não estiver aberto, a extensão avisa e não envia nada.

DOIS MODOS, E A TELA DE OPÇÕES DIZ EM QUAL VOCÊ ESTÁ

1. O SEU PLANO. Se você já paga uma assinatura de IA, use-a. Com o app do Bruto aberto nesta máquina, a extensão pede a aula a ele, o app fala com a IA pelo plano, e não é preciso chave nenhuma. Uma extensão de navegador não executa programa — por isso quem conversa com a assinatura é o app, e a extensão só fala com ele, em 127.0.0.1, nesta máquina.

2. SUA CHAVE. Sem o app, você escolhe o provedor (Anthropic, OpenAI, OpenRouter, Ollama Cloud ou Google) e usa a sua própria chave. Ela fica só neste navegador e fala direto com o provedor: não existe servidor nosso no caminho. Aqui você paga por uso, ao provedor.

Em nenhum dos dois há mensalidade nossa, limite ou cadastro — a extensão não tem conta e não sabe quem você é. E a tela de opções diz, em letras, em qual modo você está e por quê: quem instalou isto para não pagar por token precisa ver quando está pagando por token.

BANCADA
As aulas que você destrincha ficam guardadas neste navegador. Fechar o popup não perde nada.

CADERNO DE IDEIAS
Ao fim de cada aula, uma pergunta: isso te deu alguma ideia? O que você escrever fica no Caderno. É a única coisa aqui que nasce de você — uma aula se refaz em trinta segundos, uma ideia que passou não volta.

CÓDIGO ABERTO
Licença MIT, auditável em github.com/Ideia-Business/bruto. O aplicativo local, do mesmo projeto, instala com um comando no macOS, no Linux e no Windows.

Projeto independente, sem afiliação com YouTube, Instagram, TikTok, Anthropic, OpenAI ou Google.
```

**Propósito único** (aba Privacy — o revisor lê primeiro)

```
Transformar o vídeo que a pessoa está assistindo numa aula em português: objetivos, conceitos explicados do zero, glossário e teste de fixação. No YouTube a extensão lê a transcrição publicada na própria página e gera a aula com a IA escolhida pela pessoa; em Instagram e TikTok ela encaminha o link ao aplicativo do Bruto que a pessoa roda na própria máquina. As aulas e as anotações ficam guardadas neste navegador.
```

**Justificativa de cada permissão** (o console pergunta uma a uma)

| Permissão | Cole isto |
|---|---|
| `storage` | Guardar, apenas neste navegador, a chave de IA do usuário, as aulas geradas e as anotações dele. Nada é enviado a servidor nosso — não existe servidor nosso. |
| `activeTab` | Ler, somente quando o usuário clica no ícone da extensão, o endereço da aba que ele está vendo (para saber se é YouTube, Instagram ou TikTok) e a transcrição publicada nessa aba. |
| `scripting` | Injetar, nessa aba, o script que lê o painel "Mostrar transcrição" do YouTube. É a única forma de obter o texto sem baixar mídia. |
| `downloads` | Salvar uma aula em arquivo, quando o usuário pede. O arquivo é gerado no próprio navegador. |
| `host_permissions` | Dois destinos, e nenhum outro é alcançável. (a) Os cinco endereços dos provedores de IA, para falar com o que o usuário escolheu, com a chave dele. (b) http://127.0.0.1:3000 — o aplicativo do Bruto, de código aberto, que o próprio usuário instala e roda na máquina dele: é por ele que a extensão usa a assinatura de IA que o usuário já paga, e é para ele que a extensão encaminha o link de um vídeo do Instagram ou do TikTok quando o usuário clica em Destrinchar no app local. 127.0.0.1 é a própria máquina: esse endereço não sai dela e não alcança servidor nenhum na internet. |

**Justificativa do código remoto:** não há. Todo o código executado vem dentro do pacote.

## Questionário de privacidade — as respostas

Declarar **uso de dados** (a Loja chama de *data usage*):

| Pergunta do console | Resposta |
|---|---|
| Coleta informação de identificação pessoal? | **Não** |
| Informação de saúde, financeira, de autenticação? | **Não** |
| Comunicações pessoais, localização? | **Não** |
| Histórico de navegação (*web history*)? | **Sim** — a definição oficial inclui qualquer URL com que o navegador interage. Em Instagram e TikTok, a URL da aba é enviada ao **app do Bruto na própria máquina** (`127.0.0.1`), só quando o usuário clica em *Destrinchar no app local*. |
| Atividade do usuário (cliques, movimento de mouse)? | **Não** |
| Conteúdo de site (texto, imagens da página)? | **Sim** — a transcrição do vídeo é lida da página e enviada para gerar a aula: ao **app do Bruto na própria máquina do usuário** (`127.0.0.1`), quando ele o está rodando, ou ao provedor de IA **escolhido por ele**, com a chave dele. Não passa por servidor nosso e não é armazenada por nós. |
| Vende ou transfere dados a terceiros fora dos casos aprovados? | **Não** |
| Usa dados para propósito alheio à função declarada? | **Não** |
| Usa dados para avaliar crédito ou conceder empréstimo? | **Não** |

Marcar as três declarações de conformidade no fim do formulário.

**Se o revisor perguntar sobre `http://127.0.0.1:3000`** — e é provável que pergunte, porque
permissão de localhost chama atenção — a resposta, curta:

> É o app do Bruto, de código aberto, que a própria pessoa instala e roda na máquina dela. A
> extensão pede a aula a ele para que o consumo saia da assinatura de IA que a pessoa já paga,
> em vez de exigir uma chave de API. `127.0.0.1` é a própria máquina: o pedido não sai dela.
> Sem o app, a extensão simplesmente não o encontra e volta a pedir a chave — nada trava.
> A extensão manda ao app o prompt e a transcrição do vídeo, e **nunca a chave** do usuário: o
> app não precisa dela, porque usa o plano.

Vale dizer também **por que a permissão é necessária, e o que de fato protege o plano** — porque
são duas coisas diferentes, e confundi-las é fácil:

- **A permissão** é o que deixa a extensão ler a resposta do app. Sem ela, a chamada da extensão
  morre como morreria a de qualquer página.
- **O que protege é o app exigir cabeçalhos que o navegador não dispensa.** São duas portas — a
  de gerar a aula e a de perguntar se o app está de pé — e **as duas exigem a mesma coisa**:
  `X-Bruto-Cliente: extensao`. A de gerar exige, além dele, `Content-Type: application/json`.
  Nenhum dos dois está na lista que dispensa verificação prévia, então uma página web que tente
  qualquer das duas chamadas dispara antes um *preflight*, e o preflight morre sem origem
  autorizada.

  A porta de "só perguntar se está de pé" precisa da tranca tanto quanto a outra, e por um motivo
  que não é óbvio: para responder, o app **executa programas** e verifica se o plano está
  autenticado. Um laço de chamadas viraria centenas de processos na máquina de quem instalou.

A explicação tentadora — "o app não manda cabeçalho CORS, então a página não alcança" — **está
errada**, e vale registrar por quê: sem CORS a página não **lê** a resposta, mas **dispara** a
requisição assim mesmo. Um POST `text/plain` é requisição simples: vai sem preflight, o app
executaria, e o prejuízo (assinatura queimada em laço por um site num separador esquecido) não
depende de ler resposta nenhuma. Medido no lado do app: `text/plain`,
`x-www-form-urlencoded`, `multipart/form-data` e cabeçalho ausente → **415**; `application/json`
→ 200. A extensão manda o cabeçalho sempre, e há teste que reprova se alguém o tirar.

**Um ponto a não esquecer:** o botão **Lapidar** do Caderno abre o Lapid.ai levando o texto da
faísca do usuário. É transmissão de conteúdo dele a um terceiro, disparada por clique explícito,
e está descrita em [`PRIVACIDADE.md`](PRIVACIDADE.md). Se o revisor perguntar, é isso: uma ação
do usuário, com o conteúdo que ele mesmo escreveu, para um destino nomeado na interface.

## Antes de clicar em enviar

- [ ] a aula que sai numa instalação limpa tem mesmo as seções que a descrição promete —
      objetivos, glossário e teste (o roteiro de `TESTANDO.md` cobre isso)
- [ ] `npm run package:ext` rodou **com** Chromium instalado e não avisou "SEM ÍCONES"
- [ ] a versão em `package.json` e no manifesto subiu desde o envio anterior
- [ ] a política de privacidade está acessível no endereço informado
- [ ] pelo menos uma captura de tela em 1280×800, e a principal mostra uma aula de verdade
- [ ] o roteiro de [`TESTANDO.md`](TESTANDO.md) passou numa instalação limpa

---

## Criar a conta de desenvolvedor

> ✅ **Feito em 12/09/2026.** Conta criada, taxa paga, e-mail de contato
> (`desenvolvimento@ideiabusiness.com.br`) **verificado**, nome de exibição **DEV IDEIA BUSINESS**,
> declaração de negociante marcada como **conta de negociante** e verificação de comerciante
> concluída. O passo seguinte é criar o item e subir o pacote.
>
> O passo a passo abaixo fica como registro de como foi feito — e para quem precisar repetir
> noutro produto.

Escrito em 12/09/2026. **Os rótulos do console mudam** — o fluxo abaixo é estável, os nomes exatos
dos botões podem ter mudado. Onde o texto não bater, o que vale é a etapa, não a palavra.

### Passo 0 — a decisão irreversível, antes de abrir qualquer página

**Qual conta Google vai ser dona da extensão?** Quem cria o item é o publicador; mudar depois
exige transferência entre contas, que é burocrática e nem sempre possível.

A Chrome Web Store **não está** em `manifests/deploy-identities.json` do IdeiaOS (conferido em
12/09/2026: há `vercel`, `github`, `supabase`, `lovable`, `devtasks`, `gcloud`, `plaud`). Por
`deploy-identity`, plataforma não mapeada exige decisão do dono — não assuma.

O candidato coerente com o resto da frota é **`desenvolvimento@ideiabusiness.com.br`**, que já é a
conta confirmada de Vercel e Supabase e o contato de segurança do `CONTRIBUTING.md`. **Nunca uma
conta pessoal**: a extensão fica atrelada a ela para sempre, e quem sair da empresa leva o item.

Decidida, **registre no registry** (`identities.chrome_web_store`) para a próxima pessoa não
precisar adivinhar.

### Passo 1 — entrar e aceitar o acordo

Acesse **<https://chrome.google.com/webstore/devconsole>** e entre **com a conta do Passo 0**.

> Se o navegador já estiver logado noutra conta Google, use uma janela anônima. Entrar com a conta
> errada aqui é o erro mais caro desta lista, e ele não avisa.

Aceite o **Contrato de Desenvolvedor**.

### Passo 2 — pagar a taxa de US$ 5

Cobrança **única por conta** (não por extensão), por cartão, via Google Payments. É
**não-reembolsável**. Um cartão da empresa mantém a coerência com o Passo 0.

Pode ser exigida verificação do e-mail de contato antes de liberar o envio.

### Passo 3 — dados do publicador

No console, em **Account / Publisher settings**:

- **Nome de exibição:** `Ideia Business` — é o que aparece sob o nome da extensão.
- **E-mail de contato:** o mesmo do Passo 0, **verificado**.
- **Site:** `https://ideiabusiness.com.br` — verificar o domínio faz o nome aparecer como
  publicador confirmado, o que ajuda na confiança e na revisão.

### Passo 4 — declaração de *trader* (a que costuma pegar de surpresa)

Exigida na União Europeia (DSA). Publicando **pela empresa**, a resposta é **trader** — e isso
obriga a informar **razão social, endereço, telefone e e-mail**, que ficam **públicos** na ficha
da loja.

Decida antes se o endereço a publicar é o da sede. Sem essa declaração, o item **não** é
distribuído na UE — e o console não deixa concluir o envio.

### Passo 5 — criar o item

**Add new item** → subir o zip:

```
extension/pacote/bruto-0.2.0.zip
```

A partir daqui, tudo o que o console pedir já está pronto neste documento: nome, descrições,
categoria, idioma, justificativa de cada permissão, política de privacidade e o questionário.

### O que esperar depois

A revisão costuma levar de alguns dias a duas semanas. **Espere pergunta sobre
`http://127.0.0.1:3000`** — permissão de localhost chama atenção. A resposta pronta está na seção
do questionário, acima.

Recusa não é o fim: o console diz o motivo, você corrige e reenvia. **Se reenviar, suba a versão**
em `package.json` **e** no manifesto — o console recusa pacote com versão repetida.
