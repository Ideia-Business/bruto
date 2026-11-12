# Como instalar o Bruto

Um passo a passo para quem nunca usou terminal. Escolha seu sistema — o processo é o mesmo em todos os três.

## Já instalei. Como abro o Bruto de novo?

O Bruto é um programa que roda **no seu computador** (o endereço é `http://localhost:3000`, só você acessa). Sempre se abre pelo atalho que o instalador criou — não precisa instalar de novo.

| Sistema | Onde está o atalho |
|---------|---|
| macOS (app baixado, `.dmg`) | **Launchpad** (ícone de foguete, ou `Fn + F4`) → **Bruto**. O app fica em **Aplicativos** (`/Applications/Bruto.app`) |
| macOS (instalação pelo terminal) | **Launchpad** → **Bruto**. O arquivo é `~/Applications/Bruto.app` |
| Windows | **Área de Trabalho** → `Bruto`, ou **Menu Iniciar** → procure `Bruto` |
| Linux | Menu de aplicativos → `Bruto` (Ubuntu: grid de pontinhos; Fedora: Activities) |

- **Fechei a janela sem querer.** Clique no atalho de novo. O servidor do Bruto continua rodando em segundo plano; o atalho só abre a janela outra vez.
- **A janela abre, mas a página fica em branco.** Espere alguns segundos e atualize com `⌘ + R` (macOS) ou `Ctrl + R`. Depois de uma atualização do Bruto, a primeira abertura leva mais tempo porque o app é reconstruído.
- **O atalho não aparece.** Recrie com o comando do seu sistema (seção "Atalho no computador" do [README](README.md#atalho-no-computador)).
- **No macOS e no Linux, pelo terminal** (serve quando o atalho não funciona):

  ```bash
  bash ~/Bruto/launcher/serve.sh
  ```

  Esse comando liga o servidor e abre a janela. Se der erro, o motivo fica em `bruto-server.log`, na pasta temporária do sistema.

---

## macOS

No macOS há dois caminhos. O novo — baixar o app pronto — não pede terminal, mas só serve para Mac com **chip da Apple** (M1 ou mais novo). O antigo — o terminal — serve para qualquer Mac.

### Caminho novo: baixar o app (sem terminal)

> Serve só para Mac com chip Apple (M1 ou mais novo). Não sabe qual é o seu? Veja [Qual é o chip do meu Mac?](#qual-é-o-chip-do-meu-mac) mais abaixo. Mac com chip Intel: use o [caminho com o terminal](#caminho-antigo-o-terminal-mac-intel-e-quem-prefere-assim).

#### 1. Baixar o instalador

Abra o navegador e acesse **https://github.com/Ideia-Business/bruto/releases/latest**. Baixe o arquivo chamado `Bruto-<versão>-arm64.dmg` (por exemplo, `Bruto-0.2.0-arm64.dmg`) — o que termina em `-arm64.dmg`. Ele fica na pasta **Downloads**.

#### 2. Instalar

1. Abra o arquivo `.dmg` (duplo clique). Uma janela abre com o ícone do **Bruto** e a pasta **Applications**.
2. Arraste o **Bruto** para cima da pasta **Applications** (Aplicativos).
3. Feche a janela. Pronto: o Bruto está em **Aplicativos**, como qualquer app do Mac.

#### 3. Primeira abertura: o macOS bloqueia (é esperado)

O app ainda não tem assinatura da Apple. Por isso, na primeira abertura o macOS mostra um aviso e **bloqueia**. Não é erro — é o jeito de liberar:

1. Duplo-clique no **Bruto**, em **Aplicativos**. O macOS bloqueia e mostra um aviso ("não pode ser verificado" ou "de um desenvolvedor não identificado"). Clique em **Concluir** ou **OK**.
2. Abra os **Ajustes do Sistema** (menu Apple → **Ajustes do Sistema…**) e entre em **Privacidade e Segurança**.
3. Role para baixo até a seção **Segurança**. Vai aparecer um aviso sobre o "Bruto" ter sido bloqueado, com o botão **Abrir Mesmo Assim**. Clique nele.
4. Confirme com **Abrir** (pode pedir sua senha).

Em macOS recentes, o clique-direito no app → **Abrir** **não basta** para liberar — é preciso passar pelos **Ajustes do Sistema**, como acima. Isso só acontece na primeira abertura.

#### 4. O primeiro vídeo (o app se completa sozinho)

- Na primeira vez que você usar um vídeo, o app baixa sozinho o baixador de vídeos. São alguns minutos a mais — só na primeira vez.
- O transcritor (**Whisper**, uns 3,5 GB entre ferramenta e modelo) **não** baixa sozinho: ele só é instalado se você pedir, nas **Configurações** do app — e já vem com o modelo que transcreve (o primeiro vídeo não espera nada). Ele lê o áudio de vídeos de Instagram e TikTok (que não têm legenda).
- O primeiro **export** (resumo em PDF/Word) baixa o navegador que gera os arquivos. Também é só na primeira vez.

#### 5. Ligar a IA

O Bruto precisa de um modelo de linguagem para gerar resumos. No app instalado pelo `.dmg`:

1. **Já usa o Claude:** instale o Claude Code e rode `claude auth login` no terminal — o app do Bruto acha sozinho.
2. **Já usa o ChatGPT:** instale o Codex CLI e rode `codex login`.
3. **Prefere uma chave de API:** crie o arquivo `~/.bruto/.env` com a sua chave (o formato é o da seção "O modelo de linguagem" do [README](README.md)). Esse é o caminho da chave no app instalado.

Se nenhum estiver ligado, o app avisa que a IA não está configurada. O passo a passo de cada opção está em [Próximos passos](#próximos-passos), abaixo.

### Qual é o chip do meu Mac?

Clique no menu **Apple** (a maçã, no canto superior esquerdo da tela) → **Sobre Este Mac**. Se aparecer a palavra **Chip** com um nome Apple (M1, M2, M3…), o caminho novo serve. Se aparecer **Processador** "Intel", use o caminho com o terminal abaixo.

### Já tinha o Bruto (instalado pelo terminal)?

- A sua biblioteca é a **mesma**: os vídeos ficam em `~/.bruto` e o app novo usa essa mesma pasta. Nada se perde.
- Feche o Bruto antigo antes de abrir o novo. Se esquecer, o app novo avisa e pede para fechá-lo.
- O app novo fica em **Aplicativos**. O antigo (`~/Applications/Bruto.app`) pode ser arrastado para o Lixo quando você quiser.

### Atualizar o app baixado

Quando houver versão nova, o app avisa, com o link. Para atualizar: baixe o `.dmg` novo e arraste o Bruto para **Aplicativos** de novo — substitui o anterior. Os seus vídeos não mudam de lugar.

### Desinstalar o app baixado

Arraste o **Bruto** (em **Aplicativos**) para o **Lixo**. Os vídeos e as ferramentas ficam na pasta `~/.bruto`: ela cresce com os vídeos e passa de 2 GB quando o Whisper é instalado (o modelo dele, de ~1,5 GB, fica em `~/.cache`, fora desta pasta). Quer apagar tudo mesmo? Apagar a pasta `~/.bruto` **apaga os seus vídeos** — não volta.

### Caminho antigo: o terminal (Mac Intel e quem prefere assim)

#### 1. Abrir o terminal

Pressione **Command (⌘) + Espaço** para abrir o Spotlight. Digite `Terminal` e pressione Enter.

#### 2. Instalar o Homebrew

Se você já tem o Homebrew (digite `brew --version` e, se aparecer um número de versão, já tem), pule para o passo 3. O instalador do Bruto não instala o Homebrew sozinho: sem ele, para logo na primeira etapa.

Se não tem, cole este comando exatamente como está — você pode colar com **Command + V**:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Pressione Enter. Ele vai pedir a sua senha (a mesma que você usa para desbloquear o Mac). Digite sem ver as letras — é normal — e pressione Enter de novo. Espere de 5 a 15 minutos.

Se pedir para adicionar o Homebrew ao PATH, copie o comando que aparecer (vai ser parecido com `export PATH="..."`), cole no terminal e pressione Enter.

#### 3. Instalar o Bruto

Cole este comando:

```bash
curl -fsSL https://raw.githubusercontent.com/Ideia-Business/bruto/main/install/instalar.sh | bash
```

Pressione Enter. Vai instalar as dependências (git, Node.js, Python, Whisper) e criar o app. Leva de 5 a 15 minutos — a primeira vez é mais lenta porque baixa as ferramentas.

O transcritor (Whisper) é o que lê o áudio de vídeos de Instagram e TikTok. Em Mac com chip Apple (M1 em diante) ele é instalado sozinho e não pergunta nada. Em Mac com chip Intel, aparece "Instalar o transcritor Whisper (openai-whisper, baixa ~2 GB de PyTorch)? [S/n]": pressione Enter (ou `s`) para instalar.

Quando terminar, vai dizer onde ficou instalado. Pronto!

#### 4. Abrir o app

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

Vai aparecer "Instalar o Whisper para transcrição de áudio (~2 GB de download, necessário para Instagram e TikTok)? [S/n]": pressione **S** (ou só Enter) para instalar.

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

Vai aparecer "Instalar o transcritor Whisper (openai-whisper, baixa ~2 GB de PyTorch)? [S/n]": pressione Enter (ou `s`) para instalar.

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

**Instalou pelo `.dmg` (macOS com chip Apple)?** Siga a seção [Desinstalar o app baixado](#desinstalar-o-app-baixado), lá em cima na parte do macOS.

Instalou pelo terminal? Apague a pasta do Bruto. Depois, o atalho e os dados (opcional):

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
   - macOS, app do `.dmg`: `~/.bruto/logs/servidor.log`
   - macOS / Linux, instalação pelo terminal: `$TMPDIR/bruto-server.log` (normalmente `/var/folders/...` ou `/tmp/...`)
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
