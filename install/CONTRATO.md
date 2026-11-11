# Contrato dos instaladores do Bruto

Documento interno: é a especificação que `instalar.sh` (macOS e Linux) e `instalar.ps1`
(Windows) cumprem, para que os dois se comportem igual. Quem mudar um, muda o outro.

## Como a pessoa chama

| Sistema | Comando de uma linha |
|---|---|
| macOS e Linux | `curl -fsSL https://raw.githubusercontent.com/Ideia-Business/bruto/main/install/instalar.sh \| bash` |
| Windows (PowerShell) | `irm https://raw.githubusercontent.com/Ideia-Business/bruto/main/install/instalar.ps1 \| iex` |

Também roda de dentro de um clone: `bash install/instalar.sh` ou `powershell -ExecutionPolicy Bypass -File install\instalar.ps1`.

## Onde instala

- Rodando de dentro de um clone do Bruto: usa esse clone.
- Senão: `BRUTO_DIR`, ou `~/Bruto` (Windows: `%USERPROFILE%\Bruto`). Se a pasta já é um clone, `git pull --ff-only`; se existe e não é clone, **para** com mensagem (nunca apaga).
- Rodar de novo é **atualizar**: idempotente, pula o que já existe.

## Dependências e como cada uma entra

| Dependência | Obrigatória | macOS | Linux | Windows |
|---|---|---|---|---|
| git | sim | Xcode CLT (`xcode-select --install`) ou brew | apt/dnf/pacman/zypper | `winget Git.Git` |
| Node.js ≥ 20 | sim | brew `node@22` | gerenciador do sistema; se a versão for < 20, orienta e para | `winget OpenJS.NodeJS.LTS` |
| uv | sim (instala o resto) | brew | instalador oficial `astral.sh/uv/install.sh` | `winget astral-sh.uv` |
| yt-dlp | sim | `uv tool install yt-dlp` | idem | idem |
| ffmpeg | sim | brew | gerenciador do sistema | `winget Gyan.FFmpeg` |
| Whisper | opcional, **padrão sim** (Instagram e TikTok dependem dele) | Apple Silicon: `uv tool install mlx-whisper`; Intel: `uv tool install openai-whisper` | `uv tool install openai-whisper` | idem |

Regras:
- **Nada de `sudo` escondido.** Todo comando com privilégio é impresso antes e roda só com o gerenciador do sistema.
- No macOS sem Homebrew: orienta a instalar (link oficial) e para. Não instala o Homebrew sozinho.
- yt-dlp via `uv` porque o pacote das distros Linux costuma ter meses de atraso, e isso quebra Instagram e YouTube.
- O whisper aberto (openai-whisper) baixa ~2 GB (PyTorch). O instalador **avisa o tamanho** antes.

## Passos depois das dependências (nesta ordem)

1. `npm ci` (cai para `npm install` se não houver lockfile).
2. `npx playwright install chromium` (Linux: `--with-deps`, que usa sudo e é avisado).
3. `npm run db:migrate` e `npm run db:seed`.
4. `npm run build`, e grava o commit do build em `.next/.bruto-build-commit`.
5. `npm run doctor` (informativo; não reprova a instalação).
6. Cria o atalho (ver abaixo).
7. Registra o host de native messaging da extensão (`launcher/registrar-host.sh`; `--sem-host` pula). Escreve `com.ideiabusiness.bruto.json` em cada navegador que a pessoa já tem (Chrome, Chromium, Edge, Brave), apontando para `launcher/host-nativo.sh`. Aceita uma **lista de IDs** — o da extensão descompactada (teste) e o do item da loja (produção) coexistem: `--extensao-id` pode aparecer várias vezes (um ID por flag), `BRUTO_EXTENSAO_ID` aceita lista separada por vírgula e/ou espaço, e a `key` do `extension/manifest.json`, se existir, entra como mais um ID junto com os informados. Repetidos entram uma vez e `allowed_origins` fica com uma origem `chrome-extension://<id>/` por ID, em ordem. ID inválido em qualquer ponto da lista (não são 32 letras a–p) reprova a lista inteira: nada é escrito, avisa qual era inválido. Sem nenhum ID conhecido, não escreve nada e avisa. Falha do registro é **aviso**, nunca derruba a instalação. macOS e Linux; Windows fica fora desta onda.
8. Diz qual modelo de IA vai ser usado: `claude` ou `codex` logados = plano; senão explica as duas saídas (logar num dos dois, ou `.env` com chave). **Nunca** cria, lê nem escreve `.env`.

## Atalho

| Sistema | O que cria | O que o atalho executa |
|---|---|---|
| macOS | `~/Applications/Bruto.app` (via `launcher/install-app.sh`, que já existe) | `launcher/serve.sh` |
| Linux | `~/.local/share/applications/bruto.desktop` e cópia na Área de Trabalho, se existir (`xdg-user-dir DESKTOP`), marcada como confiável (`gio set … metadata::trusted true`, se houver `gio`) | `launcher/serve.sh` |
| Windows | `Bruto.lnk` na Área de Trabalho e no Menu Iniciar, ícone `launcher/icon.ico` | `powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File launcher\serve.ps1` |

## O que o atalho faz (serve)

1. Se o app já responde em `http://127.0.0.1:${BRUTO_PORT:-3000}`, só abre a janela.
2. Senão: se não há build, **ou** o build é de outro commit (`.next/.bruto-build-commit` ≠ `git rev-parse HEAD`), roda `npm run build` e grava o commit. Depois sobe `npm run start -- -p <porta>` em segundo plano, com log em `$TMPDIR/bruto-server.log` (Windows: `%TEMP%\bruto-server.log`), e espera até 40 s.
3. Abre a janela: Chrome/Chromium/Edge em modo `--app=<url>` se houver; senão o navegador padrão.

## Flags

| sh | ps1 | Efeito |
|---|---|---|
| `--sem-whisper` | `-SemWhisper` | não instala transcritor |
| `--sem-atalho` | `-SemAtalho` | não cria atalho |
| `--sem-host` | — (Windows fora da Onda 1) | não registra o host da extensão |
| `--sim` | `-Sim` | não pergunta nada (whisper = sim) |
| `--dir <pasta>` | `-Dir <pasta>` | pasta de instalação |

## Saída

- Cada etapa imprime `→ <o que está fazendo>` e termina em `✓` ou `✗ <motivo> — <o que fazer>`.
- Falha de etapa obrigatória: sai com código 1 e diz como retomar (rodar de novo o mesmo comando).
- No fim: onde ficou instalado, como abrir (atalho) e como atualizar (rodar de novo).

---

## Instalador executável (macOS) — o `.dmg`

Tudo acima (o `curl | bash`) **continua valendo e não muda**: é o instalador de quem
desenvolve e de Mac Intel. Esta seção é o segundo instalador do macOS: um `Bruto.app`
**autocontido** para Apple Silicon (arm64), distribuído como `dist/Bruto-<versão>-arm64.dmg`
e construído por `npm run instalador:macos` (`scripts/instalador-macos/construir.sh`).
Decisão registrada no ADR `docs/decisions/0005-instalador-macos-autocontido.md`.
Sem atualização silenciosa (o app avisa que há versão nova) e sem assinatura Apple na v1:
assinatura **ad-hoc**; Developer ID + notarização só ligam se `BRUTO_DEVELOPER_ID` e
`BRUTO_NOTARY_PROFILE` existirem por nome — sem elas, o build pula e **diz** que pulou.

### O que vai dentro e o que desce depois

| Peça | Dentro do `.app` | Como entra |
|---|---|---|
| Node (o mesmo do build, pinado) | sim | `binarios.json` (URL + SHA-256), cache em `~/.cache/bruto-instalador` |
| app Next (modo standalone + static + public + drizzle) | sim | `BRUTO_BUILD_STANDALONE=1` |
| `ffmpeg` / `ffprobe` / `uv` | sim (`Contents/Resources/bin`) | idem |
| `yt-dlp` | não | `uv` no primeiro uso, com **Python gerenciado** pelo próprio `uv` |
| Whisper (~2 GB) | não | só quando a pessoa pede, com aviso de tamanho |
| Chromium dos exports | não | Playwright, no primeiro export |

O que desce depois vai para `$BRUTO_FERRAMENTAS` (`~/.bruto/ferramentas`), nunca para o
sistema. **Inváriante do pacote:** em modo pacote, `ffmpeg`, `ffprobe`, `uv`, `yt-dlp`,
`whisper` e o Chromium são resolvidos por **caminho absoluto** pelas variáveis abaixo, nunca
pelo PATH — o PATH serve só para achar `claude`/`codex`, que são da pessoa.

### Layout do `Bruto.app`

```
Bruto.app/Contents/
  Info.plist            CFBundleIdentifier=com.ideiabusiness.bruto · versão do package.json · LSMinimumSystemVersion=13.0 · LSArchitecturePriority=arm64
  MacOS/Bruto           lançador (bash)
  Resources/
    icon.icns
    node                binário oficial nodejs.org darwin-arm64 (pinado)
    bin/ffmpeg bin/ffprobe bin/uv
    app/                saída de .next/standalone + static + public/ + drizzle/ + package.json
    host-nativo.sh      wrapper do host de native messaging (usa o node do pacote)
    launcher/           host-nativo.sh + registrar-host.sh (o par que gera caminhos existentes)
    registrar-host.sh   delegador do registrador acima
    host-nativo.mjs
    LICENSES/           licenças de Node, ffmpeg (e fonte), uv, yt-dlp
```

**Ponto corrigido em relação ao contrato original de empacotamento:** o manifesto do host
nativo (`com.ideiabusiness.bruto.json`) aponta para
`Contents/Resources/launcher/host-nativo.sh` — e não para `Resources/host-nativo.sh`.
O `registrar-host.sh` calcula a raiz como o pai da própria pasta; com ele em `launcher/`,
a raiz vira `Resources` e o caminho registrado existe de verdade. A cópia em
`Resources/host-nativo.sh` também existe (o wrapper é o mesmo nas duas).

### Variáveis que o lançador define para o servidor

| Variável | Valor |
|---|---|
| `BRUTO_EMPACOTADO` | `1` (liga o modo pacote) |
| `BRUTO_RECURSOS` | `…/Bruto.app/Contents/Resources` |
| `BRUTO_NODE` | `$BRUTO_RECURSOS/node` |
| `BRUTO_FFMPEG` / `BRUTO_FFPROBE` / `BRUTO_UV` | caminhos absolutos em `$BRUTO_RECURSOS/bin` |
| `BRUTO_FERRAMENTAS` | `$BRUTO_DATA_ROOT/ferramentas` (default `~/.bruto/ferramentas`) |
| `UV_TOOL_DIR` / `UV_TOOL_BIN_DIR` / `UV_PYTHON_INSTALL_DIR` / `UV_CACHE_DIR` | dentro de `$BRUTO_FERRAMENTAS` |
| `UV_PYTHON_PREFERENCE` | `only-managed` (nunca o Python do sistema) |
| `PLAYWRIGHT_BROWSERS_PATH` | `$BRUTO_FERRAMENTAS/ms-playwright` |
| `BRUTO_PLAYWRIGHT_CLI` | `cli.js` do playwright dentro de `app/node_modules` |
| `BRUTO_DATA_ROOT` | herdado, default `~/.bruto` (a MESMA biblioteca da instalação antiga) |
| `PORT` / `HOSTNAME` | `${BRUTO_PORT:-3000}` / `127.0.0.1` |
| `PATH` | bin do pacote, bin das ferramentas, PATH do shell de login do usuário, `/usr/bin:/bin:/usr/sbin:/sbin` — só para achar `claude`/`codex` |

### O que o servidor expõe e o lançador consome

- `GET /api/versao` → `200 {"app":"bruto","versao":"<package.json>","origem":"pacote"|"clone"}`
  (leitura pública local, sem dado sensível).
- Boot em modo pacote aplica migrações e seed antes de re-enfileirar órfãos
  (pasta `drizzle/` relativa ao cwd = `$BRUTO_RECURSOS/app`).

### O lançador (`Contents/MacOS/Bruto`), em resumo

1. Monta o ambiente acima; log em `$BRUTO_DATA_ROOT/logs/servidor.log`; PID do servidor que
   **ele** subiu em `$BRUTO_DATA_ROOT/servidor.pid`.
2. Porta responde `origem=pacote` e mesma versão: só abre a janela.
3. `origem=pacote` e outra versão: encerra **só** o PID do arquivo, se o comando dele for o
   servidor node **deste** pacote; senão não mexe em nada.
4. Porta ocupada por outra coisa (instalação antiga, que não tem `/api/versao`, ou
   `origem=clone`): **não mata nada**; diálogo "feche o Bruto antigo" com a opção
   "Abrir mesmo assim".
5. Porta livre: sobe `"$BRUTO_NODE" app/server.js` (`nohup`), espera `/api/versao` com
   `origem=pacote` por até 60 s e abre a janela (Chrome/Chromium/Edge em `--app=<url>`, senão
   `open`).
6. `BRUTO_SEM_JANELA=1`: só garante o servidor (é o que o host da extensão usa).
7. Primeira execução: registra o host de native messaging (sem ID de extensão conhecido, não
   registra nada — comportamento atual, ADR 0004).

### Build e provas (`scripts/instalador-macos/construir.sh`)

- Binários pinados (URL + SHA-256; hash diferente = para; cache em `~/.cache/bruto-instalador`).
- `npm ci` + `next build` com o **Node pinado** (o `better-sqlite3` precisa do ABI dele) e
  `BRUTO_BUILD_STANDALONE=1` — o modo clone não muda de comportamento.
- Provas no fim do build, com falha alta: **S** (nada da máquina de build sai no pacote —
  sem `.env`, sem `dist/`, sem caminho `/Users/`), **T** (assinar não tirou capacidade do
  binário — entitlements do node e `node -e`), **P1** (nenhum Mach-O liga em `/opt/homebrew`
  nem `/usr/local`; o lançador não cita; o `better-sqlite3` do pacote carrega com o node do
  pacote), **H** (todo caminho do host nativo existe, é absoluto, canônico e executável —
  inclusive o `path` do manifesto que o registrador gera).
- Assinatura ad-hoc de cada Mach-O + bundle; `.dmg` com atalho para `/Applications` e
  `.sha256` calculado **depois** de qualquer notarização. `dist/` no `.gitignore`.
- Sem sudo, sem GitHub Actions; build na máquina; release/tag só por ordem do dono.
