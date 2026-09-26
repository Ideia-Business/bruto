# Política de Privacidade — extensão Bruto

Última revisão: 13 de setembro de 2026 · aplica-se à extensão de navegador **Bruto — vídeo vira
aula**, publicada pela [Ideia Business](https://ideiabusiness.com.br).

## O resumo, em três frases

A extensão roda inteira no seu navegador e fala com um de três destinos: o **app do Bruto na sua própria máquina**, quando você o está rodando — e aí o consumo sai da assinatura de IA que você já paga —; **direto com o provedor de IA** que você escolheu, com a chave que você forneceu; ou o **servidor grátis da Ideia Business**, se você não configurou nada. No primeiro e no segundo, não há servidor nosso: nós não recebemos, não armazenamos e não temos como ver nada do que você faz. No terceiro, leia a seção **O modo grátis** abaixo.

Isso não é promessa de boa conduta: é consequência da arquitetura. **Nos modos plano e chave**, não há para onde seus dados irem, porque não há nada nosso no caminho. **No modo grátis**, a transcrição vai ao servidor — leia a seção 2c para os detalhes. O código é aberto e auditável
([MIT](../LICENSE), [repositório](https://github.com/Ideia-Business/bruto)).

## O que fica guardado, e onde

Tudo em `chrome.storage.local` — **neste navegador, neste perfil**. Nunca em
`chrome.storage.sync`, que replicaria na sua conta Google.

| O quê | Por que existe | Quando some |
|---|---|---|
| **UUID da instalação** (modo grátis) | identifica você para contar até 3 aulas de graça por dia. Gerado uma vez, nunca muda | guarda enquanto você tem a extensão; desaparece com a desinstalação |
| **Sua chave de IA** | autentica você no provedor escolhido. Só existe se você a colocou, e no modo do app local não é preciso nenhuma — se você já tinha guardado uma antes, ela continua aqui, guardada e sem uso, até você apagá-la | quando você a apaga nas opções, ou desinstala a extensão |
| **Bancada** — as aulas que você gerou | para que fechar o popup não perca o trabalho | guarda as 60 mais recentes; a mais antiga sai quando enche |
| **Caderno de Ideias** — as suas faíscas | é a única coisa aqui que nasce de você | quando você apaga a faísca, ou desinstala a extensão |
| **Preferências** (provedor, modelo) | para não reconfigurar a cada uso | ao desinstalar |

Desinstalar a extensão apaga tudo isso. **No modo plano e no modo chave**, não guardamos cópia em lugar nenhum — não temos onde. **No modo grátis**, o identificador aleatório da sua instalação e o hash do seu IP continuam no servidor da Ideia Business por até 36 horas, depois são descartados automaticamente — é só para contar as 3 aulas do dia e proteger contra abuso de reinstalação.

O que **sobrevive** à desinstalação é só o que você mesmo tirou daqui, de propósito: a aula que
você salvou com **Baixar .md** continua no seu computador, como qualquer arquivo seu, e o que
você copiou com **Copiar** (ou com **Lapidar**) continua na área de transferência até você copiar
outra coisa. São cópias suas, no seu aparelho; apagá-las é com você.

## Para onde os dados vão — a lista completa

Cinco destinos. Dois são da sua própria máquina (app do Bruto e Caderno de Ideias); dois são de terceiros que **você** escolheu (provedores de IA e YouTube); e um — o servidor grátis da Ideia Business — **é nosso, mas só existe porque você não configurou nada**. Nenhum deles recebe dado seu sem você mandar.

Modo pelo plano e modo pela chave: **nenhum servidor nosso** é envolvido. Modo grátis: apenas a transcrição, título e canal vão ao nosso servidor para gerar a aula. A escolha é sua.

O Lapid.ai (descrito no item 3) também é da mesma empresa que publica o Bruto, e só é aberto quando você aperta o botão **Lapidar**.

### 0. O app do Bruto, na sua máquina — quando você o está rodando

A extensão procura o app do Bruto em `http://127.0.0.1:3000`. Achou, e ele tem um provedor de
plano pronto? Então a aula é pedida a **ele**, e o consumo sai da assinatura de IA que você já
paga — sem chave, e sem cobrança por token.

`127.0.0.1` é o nome que a sua máquina dá a si mesma. Esse pedido **não sai do seu computador**:
não passa por rede, não passa por nós, e não há como passar. O app é do mesmo projeto, de código
aberto, e é você quem o instala e o executa.

| Vai junto | Não vai junto |
|---|---|
| o texto que pede a aula (o prompt) e a transcrição daquele vídeo | **a sua chave de API** — o app não precisa dela, porque usa o plano |
| a tarefa (`study`) e o nível de modelo (`fast`/`balanced`) | as suas faíscas, a Bancada, as suas preferências |

A partir daí, quem fala com a IA é o app, pela assinatura configurada **na sua conta**, e o que
ele faz está descrito no repositório dele.

Se o app não estiver aberto — o caso mais comum, de quem só instalou a extensão — nada disso
acontece: a extensão nem chega a alcançá-lo. Aí, a extensão entra em um de dois modos: **modo grátis** (se você não configurou chave nenhuma — seção 2c abaixo) ou **modo chave** (se você colocou uma chave — seção 1 abaixo).
A tela de opções diz, em letras, em qual dos três modos você está.

### 1. O provedor de IA que você escolheu — quando não há app

Sem o app, quando você manda destrinchar um vídeo, a extensão envia **a transcrição daquele
vídeo** e a **sua chave** diretamente ao provedor que você configurou — um destes, e só o que
você escolheu:

`api.anthropic.com` · `api.openai.com` · `openrouter.ai` · `ollama.com` ·
`generativelanguage.googleapis.com`

Esses endereços, mais o `127.0.0.1` do item anterior e `bruto-gratis.vercel.app` (modo grátis, item 2c), são os **únicos de onde a extensão busca ou
para onde ela envia dados por conta própria** (declarados em `host_permissions` no manifesto; o
navegador bloqueia qualquer outro). Há um destino a mais, que não entra nessa lista porque não é
busca nem envio automático: o **Lapid.ai**, que só é aberto — como uma aba nova, igual a clicar
num link — quando você aperta "Lapidar". Está descrito no item 3.
O tratamento que cada provedor dá ao que recebe é regido pela política **dele**, não por esta —
e a conta é sua, então a relação também.

### 2. O YouTube

A extensão lê a transcrição que o próprio YouTube já publica na página que você está vendo, e
pode redirecionar um Short para a rota `/watch` do mesmo vídeo, que é onde o painel de
transcrição existe. Ela **não baixa mídia** — nem vídeo, nem áudio. Nenhum dado seu é enviado
ao YouTube além da navegação normal que você já estava fazendo.

### 2b. Instagram e TikTok — encaminhamento ao app local

Quando você clica em destrinchar um Reel ou vídeo em Instagram ou TikTok, a extensão envia
**apenas a URL da aba ativa** ao app do Bruto na sua própria máquina, em `127.0.0.1:3000`.
Este pedido **não sai do seu computador**: `127.0.0.1` é sua própria máquina. Sem o app local aberto, nenhum servidor nosso
é envolvido, e nenhum dado é armazenado conosco. Se o app não está aberto, a extensão avisa e
não envia nada.

### 2c. O modo grátis — servidor da Ideia Business, sem chave, 3 aulas por dia

Sem configurar uma chave de API e sem o app local aberto, você cai no modo grátis: a extensão
envia a transcrição, título e canal do vídeo ao servidor `bruto-gratis.vercel.app`
(hospedado na Vercel, da Ideia Business). O servidor recebe essas três coisas, **monta o prompt
da aula ele mesmo**, e pede o resultado ao Ollama Cloud **com a conta da Ideia Business**
— não é sua chave, é a dele. O Ollama processa e declara não usar o que recebe para treinar modelos.

**O que o servidor faz:**
- Monta o prompt da aula (padrão fixo, igual ao do app local).
- Chama o Ollama Cloud.
- Devolve o resultado da aula — em markdown, como qualquer outro modo.

**O que o servidor NÃO faz:**
- Não guarda a transcrição.
- Não guarda a aula.
- Não guarda o título nem o canal — descartas depois de montar o prompt.
- Não vende, não usa para treinar, não compartilha.

**Como você é contado — sem identificação:**
- Na primeira vez que você usa a extensão, ela gera um UUID aleatório e guarda em `chrome.storage.local`.
- Cada aula grátis que você pede, a extensão envia esse UUID e o servidor o usa para contar até 3 por dia.
- O servidor também usa um hash do seu IP — nunca o IP em si —, com sal secreto, para proteger contra reinstalação abusiva (se você apaga e reinstala a extensão virou outro UUID, o IP segura isso).
- Essas contas caducam em 36 horas; depois saem do servidor para sempre.

**Os limites:**
- 3 aulas por instalação, por dia. Quando chegar ao terceiro, o popup avisa "Usou suas 3 aulas grátis de hoje".
- A 4ª aula mostra duas saídas: colar uma chave de API nas opções (e mudar para o modo da chave) ou abrir o app local (e mudar para o modo do plano).

Essa é a única forma em que dados seus — ainda que resumidos a UUID e hash — passam por servidor nosso. Se você não quer, **coloque uma chave nas opções** (modo da chave) ou **abra o app local** (modo do plano) — nos dois casos, nada disso sai daqui.

### 3. O Lapid.ai — só quando você clica em "Lapidar"

Este é o único envio que precisa da sua atenção, e por isso está descrito por extenso.

No Caderno de Ideias, o botão **Lapidar** abre o [Lapid.ai](https://lapid.ai) (produto pago da
mesma empresa) levando **o texto da sua faísca** — copiado para a área de transferência e
também embutido no endereço, limitado a 1200 caracteres. Isso é uma transmissão de conteúdo seu
para um site de terceiro, e acontece **exclusivamente** quando você clica nesse botão.

Vai junto um único dado que não é seu: uma marca de origem (`de=bruto`) no endereço, para o Lapid
saber de onde veio a visita. Ela não identifica você nem o seu navegador.

O que **não** vai junto: o resumo do vídeo, a transcrição, a aula, sua chave, ou qualquer outra
faísca. Só a anotação daquela faísca.

## O que a extensão não faz

- **Não tem analytics, telemetria, rastreador, pixel ou cookie.** Nenhum.
- **Não vende, aluga nem compartilha dados** — com uma exceção. **No modo grátis**, a transcrição, o título e o canal são enviados ao Ollama Cloud, o serviço de IA da Ollama, **pela conta da Ideia Business** (a chave é da Ideia Business, não sua). A Ollama processa o pedido para responder e declara não usar o que recebe para treinar modelos. **Nos modos plano e chave**, nós não recebemos os dados: eles vão do seu computador direto ao app local ou ao provedor que você escolheu.
- **Não usa seus dados para treinar modelo.** O que o provedor que você escolheu faz com o que
  recebe é decidido na conta que é sua, com ele.
- **Não carrega código remoto.** Tudo o que executa vem dentro do pacote, auditável.
- **Não pede login** e não tem conta. Não sabemos quem você é.

## Por que cada permissão existe

| Permissão | Para quê |
|---|---|
| `storage` | guardar sua chave, a Bancada, o Caderno e as preferências, localmente |
| `activeTab` | ler a transcrição da aba que você está vendo, quando você clica no ícone |
| `scripting` | injetar o leitor de transcrição nessa aba — é ele que lê o painel do YouTube |
| `downloads` | salvar uma aula em arquivo, quando você pede |
| `host_permissions` | falar com o app do Bruto na sua máquina (`127.0.0.1`), com o servidor grátis da Ideia Business (`https://bruto-gratis.vercel.app`, modo grátis), e com o provedor de IA que você escolheu — e **só** com eles |

## Crianças

A extensão não é direcionada a menores de 13 anos. Ela não coleta dados de identificação pessoal. **No modo plano e no modo chave**, não coleta dados de ninguém. **No modo grátis**, a extensão envia ao servidor da Ideia Business: transcrição, título, canal e um identificador aleatório de instalação (UUID gerado localmente, sem nenhuma ligação com você). O servidor guarda um hash do seu IP — nunca o IP em si — com sal secreto, por até 36 horas, só para contar a cota diária e proteger contra reinstalação abusiva de forma anônima. Nenhum desses dados identifica você; a escolha do modo grátis é sua e pode ser trocada a qualquer momento.

## Mudanças nesta política

Se algo aqui mudar, a alteração aparece no histórico público deste arquivo, com data e autor:
[histórico de commits](https://github.com/Ideia-Business/bruto/commits/main/extension/PRIVACIDADE.md).
Não há como alterá-la em silêncio.

## Contato

Abra uma issue em [github.com/Ideia-Business/bruto/issues](https://github.com/Ideia-Business/bruto/issues)
ou fale com a [Ideia Business](https://ideiabusiness.com.br).
