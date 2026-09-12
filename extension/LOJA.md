# Envio à Chrome Web Store — o que já está pronto e o que falta

Este documento existe para que o envio seja **colar e conferir**, não escrever sob pressão. Os
textos abaixo já respeitam os limites de caracteres de cada campo do console.

Demanda no DevTasks: `7d0dff5e-ac73-4ff1-9dd3-24279f232fcd`.

---

## O que só você pode fazer

Nada disto é automatizável — exige conta, cartão e cliques:

1. **Conta de desenvolvedor** em [chrome.google.com/webstore/devconsole](https://chrome.google.com/webstore/devconsole)
   — taxa **única** de US$ 5. Use a identidade da empresa, não pessoal
   (ver `deploy-identity` no IdeiaOS: publicação sai sob identidade de serviço).
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

## O que a extensão entrega — conferido contra o código

Auditoria de 12/09/2026, cruzando os textos daqui com o código. O achado foi de uma classe só:
**os textos descreviam o aplicativo local, não a extensão.** Resolvido em 13/09, por decisão do
dono, pelo caminho de fazer o produto cumprir o texto — não o contrário.

| Entrega | Aplicativo local | Extensão |
|---|---|---|
| Aula: objetivos, conceitos do zero, glossário, teste de fixação | sim | **sim** — desde 13/09, usa o mesmo `studyPrompt` |
| Transcrição para quem usa | sim | **não** — a fala é lida e mandada ao provedor, e nunca aparece na tela nem no arquivo |
| Mapa mental | sim (`src/pipeline/prompts/mindmap.ts`) | **não** — não existe mapa na extensão |
| Instagram e TikTok | sim | não — e os textos daqui já dizem isso corretamente |

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
Vira o vídeo do YouTube que você está vendo numa aula em português: conceitos do zero, glossário e teste de fixação.
```

> A versão anterior deste campo dizia "resumo, **transcrição** e **mapa mental**". Nenhum dos dois
> últimos existe na extensão — são do aplicativo local. Ver a seção acima.

**Categoria:** Produtividade · **Idioma principal:** Português (Brasil)

**Descrição completa** (máx. 16.000)

```
O Bruto não resume. Ensina.

As dezenas de extensões que resumem vídeo devolvem cinco bullets e um paywall. O Bruto entrega
uma aula: o que você deveria saber ao final, cada conceito explicado desde o começo, um
glossário dos termos que o autor assumiu que você já conhecia, e um teste para descobrir se
entendeu mesmo.

COMO FUNCIONA
Abra um vídeo do YouTube, clique no ícone do Bruto e pronto. Ele lê a transcrição que o próprio
YouTube publica na página — nunca baixa vídeo nem áudio — e monta a aula em português.

A SUA CHAVE, O SEU CUSTO, SEM ASSINATURA
Você escolhe o provedor de IA (Anthropic, OpenAI, OpenRouter, Ollama Cloud ou Google) e usa a
sua própria chave. Ela fica só neste navegador e fala direto com o provedor: não existe servidor
nosso no caminho. Sem mensalidade, sem limite de uso, sem cadastro — a extensão não tem conta e
não sabe quem você é.

BANCADA
As aulas que você destrincha ficam guardadas neste navegador. Fechar o popup não perde nada.

CADERNO DE IDEIAS
Ao fim de cada aula, uma pergunta: isso te deu alguma ideia? O que você escrever fica no
Caderno. É a única coisa aqui que nasce de você — uma aula se refaz em trinta segundos, uma
ideia que passou não volta.

CÓDIGO ABERTO
Licença MIT, auditável em github.com/Ideia-Business/bruto. Há também um aplicativo local, do
mesmo projeto, que dá conta de Instagram e TikTok transcrevendo o áudio.

Projeto independente, sem afiliação com YouTube, Anthropic, OpenAI ou Google.
```

**Justificativa de cada permissão** (o console pergunta uma a uma)

| Permissão | Cole isto |
|---|---|
| `storage` | Guardar, apenas neste navegador, a chave de IA do usuário, as aulas geradas e as anotações dele. Nada é enviado a servidor nosso — não existe servidor nosso. |
| `activeTab` | Ler a transcrição publicada na aba que o usuário está vendo, somente quando ele clica no ícone da extensão. |
| `scripting` | Injetar, nessa aba, o script que lê o painel "Mostrar transcrição" do YouTube. É a única forma de obter o texto sem baixar mídia. |
| `downloads` | Salvar uma aula em arquivo, quando o usuário pede. O arquivo é gerado no próprio navegador. |
| `host_permissions` | Falar diretamente com o provedor de IA que o usuário escolheu, usando a chave dele. São cinco endereços fixos, e nenhum outro é alcançável. |

**Justificativa do código remoto:** não há. Todo o código executado vem dentro do pacote.

## Questionário de privacidade — as respostas

Declarar **uso de dados** (a Loja chama de *data usage*):

| Pergunta do console | Resposta |
|---|---|
| Coleta informação de identificação pessoal? | **Não** |
| Informação de saúde, financeira, de autenticação? | **Não** |
| Comunicações pessoais, localização, histórico de navegação? | **Não** |
| Atividade do usuário (cliques, movimento de mouse)? | **Não** |
| Conteúdo de site (texto, imagens da página)? | **Sim** — a transcrição do vídeo é lida da página e enviada ao provedor de IA **escolhido pelo usuário**, com a chave dele, para gerar a aula. Não passa por servidor nosso e não é armazenada por nós. |
| Vende ou transfere dados a terceiros fora dos casos aprovados? | **Não** |
| Usa dados para propósito alheio à função declarada? | **Não** |
| Usa dados para avaliar crédito ou conceder empréstimo? | **Não** |

Marcar as três declarações de conformidade no fim do formulário.

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
