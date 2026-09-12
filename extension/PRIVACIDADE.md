# Política de Privacidade — extensão Bruto

Última revisão: 11 de setembro de 2026 · aplica-se à extensão de navegador **Bruto — vídeo vira
aula**, publicada pela [Ideia Business](https://ideiabusiness.com.br).

## O resumo, em três frases

**Não existe servidor nosso.** A extensão roda inteira no seu navegador e fala direto com o
provedor de IA que **você** escolheu, com a chave que **você** forneceu. Nós não recebemos,
não armazenamos e não temos como ver nada do que você faz nela.

Isso não é promessa de boa conduta: é consequência da arquitetura. Não há para onde seus dados
irem, porque não há nada nosso no caminho. O código é aberto e auditável
([MIT](../LICENSE), [repositório](https://github.com/Ideia-Business/bruto)).

## O que fica guardado, e onde

Tudo em `chrome.storage.local` — **neste navegador, neste perfil**. Nunca em
`chrome.storage.sync`, que replicaria na sua conta Google.

| O quê | Por que existe | Quando some |
|---|---|---|
| **Sua chave de IA** | é ela que autentica você no provedor escolhido | quando você a apaga nas opções, ou desinstala a extensão |
| **Bancada** — as aulas que você gerou | para que fechar o popup não perca o trabalho | guarda as 60 mais recentes; a mais antiga sai quando enche |
| **Caderno de Ideias** — as suas faíscas | é a única coisa aqui que nasce de você | quando você apaga a faísca, ou desinstala a extensão |
| **Preferências** (provedor, modelo) | para não reconfigurar a cada uso | ao desinstalar |

Desinstalar a extensão apaga tudo isso. Não há cópia em lugar nenhum.

## Para onde os dados vão — a lista completa

Três destinos, e nenhum é nosso.

### 1. O provedor de IA que você escolheu

Quando você manda destrinchar um vídeo, a extensão envia **a transcrição daquele vídeo** e a
**sua chave** diretamente ao provedor que você configurou — um destes, e só o que você escolheu:

`api.anthropic.com` · `api.openai.com` · `openrouter.ai` · `ollama.com` ·
`generativelanguage.googleapis.com`

Esses são os únicos endereços que a extensão pode alcançar (declarados em `host_permissions` no
manifesto; o navegador bloqueia qualquer outro). O tratamento que cada provedor dá ao que
recebe é regido pela política **dele**, não por esta — e a conta é sua, então a relação também.

### 2. O YouTube

A extensão lê a transcrição que o próprio YouTube já publica na página que você está vendo, e
pode redirecionar um Short para a rota `/watch` do mesmo vídeo, que é onde o painel de
transcrição existe. Ela **não baixa mídia** — nem vídeo, nem áudio. Nenhum dado seu é enviado
ao YouTube além da navegação normal que você já estava fazendo.

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
- **Não vende, aluga nem compartilha dados** — não teria como: não os possui.
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
| `host_permissions` | falar com o provedor de IA que você escolheu, e **só** com ele |

## Crianças

A extensão não é direcionada a menores de 13 anos e não coleta dados de ninguém — portanto
tampouco deles.

## Mudanças nesta política

Se algo aqui mudar, a alteração aparece no histórico público deste arquivo, com data e autor:
[histórico de commits](https://github.com/Ideia-Business/bruto/commits/main/extension/PRIVACIDADE.md).
Não há como alterá-la em silêncio.

## Contato

Abra uma issue em [github.com/Ideia-Business/bruto/issues](https://github.com/Ideia-Business/bruto/issues)
ou fale com a [Ideia Business](https://ideiabusiness.com.br).
