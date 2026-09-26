# Como instalar o Bruto

Um passo a passo para quem nunca usou terminal. Escolha seu sistema — o processo é o mesmo em todos os três.

## macOS

### 1. Abrir o terminal

Pressione **Command (⌘) + Espaço** para abrir o Spotlight. Digite `Terminal` e pressione Enter.

### 2. Instalar o Homebrew

Cole este comando exatamente como está — você pode colar com **Command + V**:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Pressione Enter. Ele vai pedir a sua senha (a mesma que você usa para desbloquear o Mac). Digite sem ver as letras — é normal — e pressione Enter de novo. Espere de 5 a 15 minutos.

Se pedir para adicionar o Homebrew ao PATH, copie o comando que aparecer (vai ser parecido com `export PATH="..."`), cole no terminal e pressione Enter.

### 3. Instalar o Bruto

Cole este comando:

```bash
curl -fsSL https://raw.githubusercontent.com/Ideia-Business/bruto/main/install/instalar.sh | bash
```

Pressione Enter. Vai instalar as dependências (git, Node.js, Python, Whisper) e criar o app. Leva de 5 a 15 minutos — a primeira vez é mais lenta porque baixa as ferramentas.

Se perguntar "Deseja instalar o transcritor local? (s/n)", responda `s` (sim) e pressione Enter — ele transcreve vídeos de Instagram e TikTok.

Quando terminar, vai dizer onde ficou instalado. Pronto!

### 4. Abrir o app

Vá para **Launchpad** (ícone de foguete, ou pressione **Fn + F4**) e procure por **Bruto**. Duplo-clique. Na primeira vez, o sistema vai avisar que é de desenvolvedor — clique **Abrir**. Pronto, o app abre numa janela.

---

## Windows

### 1. Abrir o PowerShell

Clique no ícone **Iniciar** (canto inferior esquerdo), procure por `PowerShell` e clique no primeiro que aparecer. NÃO precisa ser administrador.

### 2. Instalar o gerenciador de pacotes (se precisar)

No Windows 10 e 11 atualizados, já vem `winget` pronto. Se der erro no próximo passo, abra a **Microsoft Store**, procure por "Instalador de Aplicativo" (App Installer) e clique em **Instalar ou Atualizar**. Depois, feche e reabra o PowerShell.

### 3. Instalar o Bruto

Cole este comando:

```powershell
irm https://raw.githubusercontent.com/Ideia-Business/bruto/main/install/instalar.ps1 | iex
```

Pressione Enter. Vai instalar tudo — git, Node.js, Python, Whisper, yt-dlp, ffmpeg. Leva de 5 a 15 minutos.

Se perguntar "Deseja instalar o transcritor local? (S/n)", pressione **S** (sim) e Enter.

Quando terminar, vai dizer onde ficou instalado (normalmente `C:\Users\[seu nome]\Bruto`).

### 4. Abrir o app

Vá à **Área de Trabalho**. Você vai ver o atalho **Bruto** (ícone quadrado). Duplo-clique. A primeira vez, o sistema pode pedir permissão — clique **Sim**. Pronto, o app abre.

Também pode abrir a partir do **Menu Iniciar** — procure por **Bruto**.

---

## Linux

### 1. Abrir o terminal

Pressione **Ctrl + Alt + T**. O terminal abre.

### 2. Instalar o curl (se não houver)

A maioria das distros já tem `curl`. Se faltar, copie o comando da sua distro:

**Ubuntu / Debian:**
```bash
sudo apt install curl
```

**Fedora / RHEL:**
```bash
sudo dnf install curl
```

**Arch:**
```bash
sudo pacman -S curl
```

Pressione Enter. Pode pedir a sua senha — é normal. Digite sem ver as letras e pressione Enter.

### 3. Instalar o Bruto

Cole este comando:

```bash
curl -fsSL https://raw.githubusercontent.com/Ideia-Business/bruto/main/install/instalar.sh | bash
```

Pressione Enter. Vai instalar tudo (git, Node.js, Python, Whisper, yt-dlp, ffmpeg). Leva de 5 a 15 minutos.

Se perguntar "Deseja instalar o transcritor local? (s/n)", responda `s` (sim) e pressione Enter.

Quando terminar, vai dizer onde ficou instalado (normalmente `~/Bruto`) e como abrir.

### 4. Abrir o app

O atalho **Bruto** é criado no seu menu de aplicativos. Procure por ele (cada distro tem um lugar diferente — Ubuntu: grid de pontinhos; Fedora: Activities). Duplo-clique para abrir.

Ou, se preferir pelo terminal, copie este comando (rodar o `.desktop` direto não funciona):

```bash
bash ~/Bruto/launcher/serve.sh
```

---

## Próximos passos

### Ligar a IA

O Bruto precisa de um modelo de linguagem para gerar resumos. Você tem três opções:

1. **Já usa Claude (Claude.com):** instale o Claude Code no seu computador. Vá [aqui](https://claude.com/claude-code) e siga as instruções (o app de mesa em claude.ai/download não serve — ele não instala o `claude` no terminal). Depois, abra o terminal e digite `claude auth login`. Pronto — o Bruto detecta sozinho.

2. **Já usa ChatGPT (ChatGPT.com):** instale o Codex CLI no seu computador. Vá [aqui](https://developers.openai.com/codex) e siga. Depois, no terminal: `codex login`. O Bruto usa.

3. **Prefere usar uma chave:** siga a seção "O modelo de linguagem" do [README.md](README.md). É mais caro, mas funciona com cinco provedores.

Se nenhum estiver ligado, o app vai avisar na primeira vez.

### Atualizar

Rodar o mesmo comando de novo atualiza tudo — é seguro. Ele pula o que já existe e puxa as novidades.

```bash
# macOS / Linux:
curl -fsSL https://raw.githubusercontent.com/Ideia-Business/bruto/main/install/instalar.sh | bash

# Windows (no PowerShell):
irm https://raw.githubusercontent.com/Ideia-Business/bruto/main/install/instalar.ps1 | iex
```

### Desinstalar

Apague a pasta do Bruto. Depois, o atalho e os dados (opcional):

| Sistema | Pasta | Atalho / Menu |
|---------|-------|---|
| macOS | `~/Bruto` | `~/Applications/Bruto.app` (aparece no Launchpad) |
| Windows | `%USERPROFILE%\Bruto` | Área de Trabalho: `Bruto.lnk` <br/> Menu Iniciar: procure `Bruto` |
| Linux | `~/Bruto` | Área de Trabalho: `Bruto` <br/> Menu de apps |

Os arquivos do app (vídeos, transcrições) ficam em:
- macOS: `~/.bruto/library/`
- Windows: `%USERPROFILE%\.bruto\library\`
- Linux: `~/.bruto/library/`

Apagá-los é opcional — deletar a pasta `Bruto` já desinstala o programa.

### Se der errado

Rodar o instalador de novo é seguro — ele retoma de onde parou. Se travar ou der erro estranho:

1. Abra o log do app. Ele fica em:
   - macOS / Linux: `$TMPDIR/bruto-server.log` (normalmente `/var/folders/...` ou `/tmp/...`)
   - Windows: `%TEMP%\bruto-server.log`
   
   Para visualizar, abra o Finder/File Explorer e navegue para o caminho acima. Se a pasta estiver oculta, procure pelas instruções de "mostrar arquivos ocultos" do seu sistema.

2. Se o erro fizer sentido, tente o passo que falhou de novo.

3. Se não fizer sentido ou não funcionar:
   - Abra uma **issue** no GitHub: https://github.com/Ideia-Business/bruto/issues
   - Copie a última linha do log e cole na issue
   - Descreva o que você tentava fazer

---

## Flags

| macOS / Linux | Windows | O que faz |
|---|---|---|
| `--sem-whisper` | `-SemWhisper` | Não instala o transcritor — vídeos sem legenda vão falhar |
| `--sem-atalho` | `-SemAtalho` | Não cria o atalho — abre pelo terminal com `npm run app` |
| `--sim` | `-Sim` | Não pergunta nada (assume sim para tudo) |
| `--dir <pasta>` | `-Dir <pasta>` | Instala em outra pasta (padrão: `~/Bruto`) |

No macOS e no Linux, as flags vão no fim do comando de uma linha, depois de `-s --`:

```bash
curl -fsSL https://raw.githubusercontent.com/Ideia-Business/bruto/main/install/instalar.sh | bash -s -- --sem-whisper
```

No Windows, o comando de uma linha não aceita flags. Baixe o instalador e rode com elas:

```powershell
irm https://raw.githubusercontent.com/Ideia-Business/bruto/main/install/instalar.ps1 -OutFile instalar.ps1
powershell -ExecutionPolicy Bypass -File .\instalar.ps1 -SemWhisper
```

De dentro de um clone: `bash install/instalar.sh --sem-whisper` ou `powershell -ExecutionPolicy Bypass -File install\instalar.ps1 -SemWhisper`.
