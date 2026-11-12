# O instalador do macOS é um `.dmg` autocontido para Apple Silicon, não um script embrulhado

O `curl | bash` serve para quem desenvolve, mas a pessoa que nunca abriu um terminal esbarra em
muros antes do Bruto: precisa do terminal em si, do Homebrew (que o instalador não instala
sozinho, por decisão) e de 5 a 15 minutos de saída de instalação que não sabe ler. Para ela o
problema não é o comando — é que não existe um app para arrastar.

Decisão: o Bruto para macOS Apple Silicon (arm64) passa a ser distribuído como
`Bruto-<versão>-arm64.dmg`, com um `Bruto.app` **autocontido**. Dentro dele viajam o Node do
build (pinado com SHA-256 em `scripts/instalador-macos/binarios.json`), o app Next em modo
standalone, `ffmpeg`, `ffprobe` e o `uv`. O que é grande e só é usado por algumas pessoas fica
de fora e desce por conta própria, tudo em `~/.bruto/ferramentas`: o `yt-dlp` é instalado pelo
`uv` no primeiro uso (com Python gerenciado pelo próprio `uv`, nunca o do sistema), o Whisper
(~3 GB entre ferramenta e modelo, baixados juntos sob pedido) só quando a pessoa pede em
Configurações, e o Chromium dos exports no primeiro export.
O servidor sobe em `127.0.0.1:3000` e se identifica em `GET /api/versao`
(`{"app":"bruto","versão":…,"origem":"pacote"|"clone"}`) — é assim que o lançador distingue o
seu servidor do de outra instalação antes de encerrar algo. Sem atualização silenciosa: o app
só avisa que há versão nova, com o link da release. Sem assinatura Apple na v1 — a conta de
desenvolvedor foi adiada (demanda `72a8fe8c`) —, o `.dmg` sai com assinatura ad-hoc e o passo
de Developer ID + notarização já está pronto no script, esperando as variáveis por nome
(`BRUTO_DEVELOPER_ID`, `BRUTO_NOTARY_PROFILE`). O build roda na máquina
(`npm run instalador:macos`), sem GitHub Actions; release e tag só por ordem do dono. O
`curl | bash` não muda: o modo clone continua existindo para quem desenvolve.

Alternativas rejeitadas: embrulhar o script `curl | bash` num app só para evitar o terminal (o
Homebrew continuaria sendo exigência indireta e o instalador continuaria mexendo na máquina da
pessoa); colocar tudo dentro, inclusive o `yt-dlp` e o Whisper (as dependências e o modelo
dele, ~3 GB, entrariam no pacote de todo mundo, mesmo de quem nunca transcreve); e um
binário universal arm64 + Intel (o
dobro do tamanho para todas as pessoas e um segundo caminho de build para provar — Mac Intel
fica no `curl | bash`).

Consequências assumidas: o `.dmg` de ~156 MB e o app de ~361 MB (v0.2.0) são maiores que um
instalador de script, porque carregam Node e ffmpeg; o Python das ferramentas passa a ser uma
cópia gerenciada pelo `uv` em `~/.bruto/ferramentas` (cpython 3.15) — tira o sistema da jogada,
mas instala duplicata; sem assinatura Apple, o Gatekeeper bloqueia a primeira abertura e a
pessoa precisa passar por Ajustes do Sistema → Privacidade e Segurança → "Abrir Mesmo Assim"
(custo aceito da conta adiada); e Mac Intel ficam fora deste caminho. A janela do app é o
Chrome em `--app`, então o ⌘Q fecha a janela, nunca o servidor — para desligar, Configurações
→ "Encerrar o Bruto" (`POST /api/encerrar`): o servidor mata os filhos que lançou
(yt-dlp/Whisper/ffmpeg, em grupo), apaga `servidor.pid` e sai, liberando a porta; abrir de novo
é papel do lançador, e reiniciar o Mac continua sendo o plano B.
