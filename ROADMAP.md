# Onde o Bruto está, e para onde vai

Documento honesto de estado. O que está marcado como pronto foi **exercido de verdade** — com vídeo real, chave real e o resultado conferido —, não apenas compilado.

Última revisão: 12/11/2026.

---

## Pronto

### O app local

Cole um link de YouTube, Instagram ou TikTok e receba resumo, transcrição, mapa mental e a Aula. Exporta `.docx` e `.pdf`. Catálogo em SQLite; arquivos em `~/.bruto/library/`.

**Verificado em 10/09/2026** com um reel do Instagram: metadados → áudio → Whisper → resumo → mapa mental → 9 artefatos. Whisper errou palavras na transcrição e o resumo as corrigiu pelo contexto.

### Instalador para macOS (.dmg)

Releases [v0.2.0 (11/11)](https://github.com/Ideia-Business/bruto/releases) e [v0.3.0 (12/11)](https://github.com/Ideia-Business/bruto/releases) — `.dmg` autocontido para Mac com chip Apple, provado em instalação limpa no MacBook Air. Desde a 0.3.0, o botão **Encerrar o Bruto**, em Configurações, desliga o servidor e libera a porta; vídeos interrompidos retomam ao reabrir.

### Modo grátis — servidor público da Ideia Business

No YouTube, quem não tem chave nem app local com plano recebe 3 aulas grátis por dia. O servidor `bruto-gratis` vive na Vercel (time ideia-business), recebe transcrição e metadados do vídeo, monta a aula com o Ollama Cloud (assinatura anual do dono) e não guarda nem transcrição nem aula — tudo some em 36 h. Limite por rede (IP) é 6 por dia; limite geral é 150. O identificador da instalação fica em `chrome.storage.local`, no navegador — reinstalar a extensão (ou limpar o storage) gera um novo; publicar de novo o servidor não tem efeito nenhum sobre ele.

**Publicado em 26/09/2026 (PR #13), revisado por Codex + Grok 4.7, em produção.** Dívida aceita documentada em `servidor/lib/redis-contador.ts` (`// debt: resposta do EVAL perdida no meio de falha rara de rede consome 1 aula sem gerar`): o trade-off entre resolver (timeout complexo, retry não-trivial) e deixar aberto (risco <1 aula perdida em ano) foi decidido como "deixar" por custo desproporcional ao benefício. Teste da reserva compensada (falha no meio da sequência de incrementos desfaz o que já foi contado) em `tests/servidor/limites.test.ts`. Extensão mostra quantas aulas restam hoje e, no limite, oferece as duas saídas: chave ou app local.

**Atualizado em 12/11/2026:** o Redis (Upstash, plano Free) foi recriado depois de ter sido desinstalado — o servidor ficou respondendo erro até a recuperação. Há também firewall da Vercel com limite por IP (detalhes em [`servidor/CONTRATO.md`](servidor/CONTRATO.md)).

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

**Atualizado em 12/11/2026:** o modelo padrão agora é o `large-v3-turbo`, baixado junto com a instalação da transcrição (~3 GB no total). Medido num MacBook Air M5: 3 minutos de fala em português transcritos em 21 s, com metade dos erros do modelo `base` anterior.

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

### Extensão na Chrome Web Store — enviada para revisão (12/11/2026)

A extensão 0.3.0 foi enviada à revisão da Loja em 12/11/2026 — status "Revisão pendente", com publicação automática após a aprovação. ID do item: `oljceemhpdalpchggipjmiknogmdglgj`. Até a aprovação, a instalação continua sendo "Carregar sem compactação".

Tudo o que dependia de código já estava pronto: a [política de privacidade](extension/PRIVACIDADE.md),
os textos da listagem com as respostas do questionário de privacidade
([extension/LOJA.md](extension/LOJA.md)), e o empacotador `npm run package:ext`, que reprova
antes de gastar uma revisão da Loja — arquivo faltando, versão divergente, texto acima do
limite, ícone declarado e ausente, código remoto. O CI roda a mesma conferência a cada push.
A descrição da loja reflete os três modos (grátis, plano, chave) — quem instala recebe 3 aulas
por dia gratuitamente, sem chave nem cadastro. Imagem promocional obrigatória 440×280 gerada
da marca em 25/09 e está em `extension/pacote/capturas/`.

**Depois da aprovação, falta:** registrar o ID do item no host nativo e gerar um `.dmg` novo, para o botão "Ligar o app" funcionar com a extensão da loja (demanda 5a22d19c; ADR [docs/decisions/0004-id-da-extensao-vem-da-loja.md](docs/decisions/0004-id-da-extensao-vem-da-loja.md)).

---

## Limitações conhecidas

| O quê | Por quê |
|---|---|
| A extensão destrincha sozinha só no YouTube | Instagram e TikTok não expõem transcrição na página. Em ambas, a extensão sempre encaminha ao app local (que precisa estar aberto) para transcrever o áudio — o modo grátis não se aplica a elas, só ao YouTube, onde a extensão já tem a transcrição e só falta a IA que escreve a aula |
| A extensão precisa que o vídeo tenha o botão "Mostrar transcrição" | É de lá que ela lê. Sem transcrição publicada, não há o que capturar |
| O endpoint `/api/timedtext` do YouTube está fechado | Desde ~09/2026 devolve resposta vazia com status de sucesso para requisição feita de dentro do navegador. Não afeta o app local, que usa `yt-dlp` |
| Em revisão na Chrome Web Store (desde 12/11/2026) | Enviada em 12/11/2026, aguardando aprovação. Por ora, carrega-se sem compactação |
| Sem testes automatizados de unidade | O CI cobre tipos, lint e build. As verificações de comportamento foram feitas à mão, com vídeo real — e estão descritas nos commits |
| Os modelos padrão envelhecem | O Gemini 2.0 Flash foi aposentado e virou 404. O campo **Modelo**, nas opções e no `.env`, existe para você contornar sem esperar correção |

---

## Como ajudar

O mais útil não é código: é relatar o que quebrou, com o link do vídeo e a mensagem **do console** do popup. Veja [CONTRIBUTING.md](CONTRIBUTING.md) e, se for mexer em texto ou tela, [BRAND.md](BRAND.md).
