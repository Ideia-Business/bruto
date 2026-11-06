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
