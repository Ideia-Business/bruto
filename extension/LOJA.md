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
2. **Hospedar a política de privacidade** num endereço público. Ela já está escrita em
   [`PRIVACIDADE.md`](PRIVACIDADE.md); o endereço do próprio GitHub serve:
   `https://github.com/Ideia-Business/bruto/blob/main/extension/PRIVACIDADE.md`
3. **Capturas de tela** — a Loja exige pelo menos uma, em 1280×800 ou 640×400. Sugestão do que
   mostrar, nesta ordem: o popup com uma aula pronta; a Bancada com três aulas; o Caderno com o
   botão Lapidar.
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
> O script avisa em letras garrafais quando isso acontece — mas o aviso só ajuda quem lê.

---

## Os campos da listagem

**Nome** (45 caracteres no console; o manifesto permite 75)

```
Bruto — vídeo vira aula
```

**Descrição curta** (máx. 132 — a que aparece no card de busca)

```
Transforma o vídeo que você está assistindo numa aula em português: resumo, transcrição e mapa mental.
```

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

- [ ] `npm run package:ext` rodou **com** Chromium instalado e não avisou "SEM ÍCONES"
- [ ] a versão em `package.json` e no manifesto subiu desde o envio anterior
- [ ] a política de privacidade está acessível no endereço informado
- [ ] pelo menos uma captura de tela em 1280×800
- [ ] o roteiro de [`TESTANDO.md`](TESTANDO.md) passou numa instalação limpa
