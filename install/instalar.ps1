# Bruto — instalador Windows.
# Espelha install/instalar.sh (macOS/Linux); a especificação-fonte é install/CONTRATO.md
# — quem mudar um lado, muda o outro.
#
# Chamada de uma linha (sem clone prévio):
#   irm https://raw.githubusercontent.com/Ideia-Business/bruto/main/install/instalar.ps1 | iex
# De dentro de um clone:
#   powershell -ExecutionPolicy Bypass -File install\instalar.ps1
#
# Compatível com Windows PowerShell 5.1 (o que vem de fábrica no Windows) — nada
# exclusivo do PowerShell 7: sem `??`, `?.`, ternário `? :`, `&&`/`||`.
#
# Nota conhecida (modo `irm | iex`): PowerShell não permite passar -SemWhisper etc.
# diretamente nesse modo (é o texto do script executado no escopo atual, sem args).
# Quem precisar de flags: clone primeiro e rode com -File.
#
# Por que o corpo mora dentro de Instalar-Bruto: em modo `irm | iex` o script roda
# no ESCOPO da sessão interativa de quem colou o comando (não num processo filho).
# Um `exit 1` ali fecharia a janela da pessoa bem na hora em que ela mais precisa
# ler a mensagem de erro. Por isso toda falha de etapa lança `throw` (Falha, abaixo)
# em vez de `exit`; só o bloco try/catch no fim do arquivo decide o que fazer com
# isso — e só chama `exit 1` quando há um `$PSCommandPath` real (modo -File), nunca
# quando o script foi colado via iex.

param(
    [switch]$SemWhisper,
    [switch]$SemAtalho,
    [switch]$Sim,
    [string]$Dir
)

# Capturados ANTES de mexer neles: em modo `irm | iex` este script roda no
# escopo da sessão interativa de quem chamou (não num processo filho) — sem
# isto, $ErrorActionPreference e o diretório atual ficariam alterados depois
# que o instalador termina. Restaurados no `finally` no fim do arquivo.
$ErrorActionPreferenceOriginal = $ErrorActionPreference
$LocalizacaoOriginal = (Get-Location).Path

$ErrorActionPreference = 'Stop'

try {
    # Sem isto, os caracteres →/✓/✗ podem sair como "?" no console padrão do
    # Windows PowerShell 5.1 (codepage não-UTF-8 por padrão em muitas máquinas).
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
} catch {
    # Sem console anexado (raro aqui, comum em serve.ps1) — segue sem forçar.
}

$RepoUrl = "https://github.com/Ideia-Business/bruto.git"

# ---------------------------------------------------------------------------
# Ajudantes de saída — cada etapa imprime "→ ..." e termina em "✓" ou em
# "✗ <motivo> — <o que fazer>" (contrato, seção "Saída").
# ---------------------------------------------------------------------------

function Etapa {
    param([string]$Mensagem)
    Write-Host "→ $Mensagem"
}

function Sucesso {
    param([string]$Mensagem)
    Write-Host "✓ $Mensagem" -ForegroundColor Green
}

function Falha {
    param(
        [string]$Motivo,
        [string]$ComoFazer = ""
    )
    $texto = $Motivo
    if ($ComoFazer) {
        $texto = "$Motivo — $ComoFazer"
    }
    $texto = "$texto`n  Para retomar: rode este instalador de novo (é idempotente — pula o que já está pronto)."
    # Nunca `exit` aqui — ver nota no cabeçalho do arquivo. Quem decide encerrar
    # o processo (ou não) é o try/catch no fim, em torno de Instalar-Bruto.
    throw $texto
}

function Atualizar-Path {
    # winget/uv gravam no PATH da máquina e/ou do usuário via registro; a sessão
    # atual do PowerShell não vê isso sozinha — recarrega dos dois.
    $machine = [System.Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user = [System.Environment]::GetEnvironmentVariable('Path', 'User')
    $partes = @()
    if ($machine) { $partes += $machine }
    if ($user) { $partes += $user }
    $env:Path = [string]::Join(';', $partes)
}

function Tem-Comando {
    param([string]$Nome)
    # -All + filtro por CommandType: uma ferramenta instalada via npm global
    # (é o caso típico de "claude"/"codex" CLI) pode ter só um shim .ps1 ao
    # lado do .cmd/.exe — Get-Command sem filtro aceitaria o .ps1, que a
    # política padrão (Restricted) bloqueia de rodar. .cmd/.exe aparecem como
    # CommandType "Application"; .ps1 aparece como "ExternalScript" — só o
    # primeiro conta como "tem o comando" de verdade.
    $candidatos = Get-Command $Nome -All -ErrorAction SilentlyContinue
    foreach ($candidato in $candidatos) {
        if ($candidato.CommandType -eq 'Application') {
            return $true
        }
    }
    return $false
}

function Instalar-Winget {
    param(
        [string]$Id,
        [string]$Nome
    )
    Write-Host "  winget install --id $Id -e --accept-source-agreements --accept-package-agreements"
    winget install --id $Id -e --accept-source-agreements --accept-package-agreements
    $codigo = $LASTEXITCODE
    Atualizar-Path
    if ($codigo -ne 0) {
        # winget devolve código != 0 também quando o pacote já está instalado —
        # não é falha por si só. A prova real é a verificação de comando abaixo,
        # feita por quem chamou esta função.
        Write-Host "  (winget saiu com código $codigo para $Nome — pode já estar instalado; verificando…)"
    }
}

# ---------------------------------------------------------------------------
# Corpo do instalador — função, não script solto, para que uma falha (`Falha`
# acima, via `throw`) possa ser capturada pelo try/catch no fim do arquivo em
# vez de matar a sessão inteira de quem rodou via `irm | iex`.
# ---------------------------------------------------------------------------

function Instalar-Bruto {
    param(
        [switch]$SemWhisper,
        [switch]$SemAtalho,
        [switch]$Sim,
        [string]$Dir
    )

    # -----------------------------------------------------------------------
    # 0. winget é obrigatório para todas as dependências nativas no Windows.
    # -----------------------------------------------------------------------

    Etapa "Verificando o instalador de pacotes do Windows (winget)"
    if (-not (Tem-Comando "winget")) {
        Falha "winget (App Installer) não está instalado" "Abra a Microsoft Store, procure por 'App Installer', instale, e rode este instalador de novo."
    }
    Sucesso "winget disponível"

    # -----------------------------------------------------------------------
    # 1. Git — precisa vir primeiro: é ele que clona o projeto, se for o caso.
    # -----------------------------------------------------------------------

    Etapa "Instalando o Git"
    if (Tem-Comando "git") {
        Sucesso "Git já instalado"
    } else {
        Instalar-Winget -Id "Git.Git" -Nome "Git"
        if (-not (Tem-Comando "git")) {
            Falha "Git não foi encontrado depois da instalação" "Instale manualmente (winget install --id Git.Git -e) ou por https://git-scm.com, depois rode este instalador de novo."
        }
        Sucesso "Git instalado"
    }

    # -----------------------------------------------------------------------
    # 2. Onde instala (contrato, seção "Onde instala").
    # -----------------------------------------------------------------------

    $ModoRemoto = [string]::IsNullOrEmpty($PSScriptRoot)
    $ProjectDir = $null

    if ($Dir) {
        # -Dir explícito sempre vence a autodetecção.
        $PastaAlvo = $Dir
    } elseif (-not $ModoRemoto) {
        # Rodando via -File: pode já estar dentro de um clone (install\..).
        $CandidatoRaiz = Split-Path -Parent $PSScriptRoot
        $ehClone = (Test-Path -LiteralPath (Join-Path $CandidatoRaiz ".git")) -and (Test-Path -LiteralPath (Join-Path $CandidatoRaiz "package.json"))
        if ($ehClone) {
            $ProjectDir = $CandidatoRaiz
        }
        $PastaAlvo = $null
    } else {
        $PastaAlvo = $null
    }

    if (-not $ProjectDir) {
        if (-not $PastaAlvo) {
            if ($env:BRUTO_DIR) {
                $PastaAlvo = $env:BRUTO_DIR
            } else {
                $PastaAlvo = Join-Path $env:USERPROFILE "Bruto"
            }
        }

        if (Test-Path -LiteralPath $PastaAlvo) {
            $temGit = Test-Path -LiteralPath (Join-Path $PastaAlvo ".git")
            if ($temGit) {
                Etapa "Atualizando o clone em $PastaAlvo"
                Push-Location -LiteralPath $PastaAlvo
                try {
                    git pull --ff-only
                    if ($LASTEXITCODE -ne 0) {
                        Falha "Não consegui atualizar $PastaAlvo (git pull --ff-only falhou)" "Resolva manualmente (branch pode ter divergido) ou rode com -Dir apontando para outra pasta."
                    }
                } finally {
                    Pop-Location
                }
                Sucesso "Clone atualizado"
            } else {
                Falha "A pasta $PastaAlvo já existe e não é um clone do Bruto" "Apague-a manualmente, ou rode de novo com -Dir apontando para outra pasta. Nada foi apagado."
            }
        } else {
            Etapa "Clonando o Bruto em $PastaAlvo"
            git clone $RepoUrl $PastaAlvo
            if ($LASTEXITCODE -ne 0) {
                Falha "git clone falhou" "Confira a conexão com a internet e rode este instalador de novo."
            }
            Sucesso "Clonado em $PastaAlvo"
        }
        $ProjectDir = $PastaAlvo
    } else {
        Sucesso "Rodando de dentro do clone em $ProjectDir"
    }

    # Absolutiza ANTES do Set-Location abaixo — depois dele, um $ProjectDir
    # relativo (ex.: -Dir Bruto) passaria a apontar para dentro de si mesmo
    # (Bruto\Bruto\...) em todo Join-Path posterior, porque seria resolvido
    # contra o NOVO diretório atual. Mesma ordem que o instalar.sh usa com
    # $PWD antes do `cd "$BRUTO_ALVO"`.
    # Resolve pela pasta ATUAL DO POWERSHELL. [IO.Path]::GetFullPath usa a pasta
    # do processo .NET, que um Push/Pop-Location anterior pode ter deixado
    # dentro do clone (Grok, rodada 8).
    $ProjectDir = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($ProjectDir)

    Set-Location -LiteralPath $ProjectDir

    # -----------------------------------------------------------------------
    # 3. Node.js >= 20.
    # -----------------------------------------------------------------------

    Etapa "Instalando o Node.js"
    Instalar-Winget -Id "OpenJS.NodeJS.LTS" -Nome "Node.js"
    if (-not (Tem-Comando "node")) {
        Falha "Node.js não foi encontrado depois da instalação" "Instale manualmente (winget install --id OpenJS.NodeJS.LTS -e) ou por https://nodejs.org, depois rode este instalador de novo."
    }
    $versaoNode = (node --version).Trim()
    $versaoMajor = [int]($versaoNode.TrimStart('v').Split('.')[0])
    if ($versaoMajor -lt 20) {
        Falha "Node.js instalado é $versaoNode (precisa ser >= 20)" "Atualize com 'winget upgrade --id OpenJS.NodeJS.LTS -e' ou baixe a LTS em https://nodejs.org, depois rode este instalador de novo."
    }
    Sucesso "Node.js $versaoNode"

    # -----------------------------------------------------------------------
    # 4. uv — instala o resto (yt-dlp, whisper).
    # -----------------------------------------------------------------------

    Etapa "Instalando o uv"
    if (Tem-Comando "uv") {
        Sucesso "uv já instalado"
    } else {
        Instalar-Winget -Id "astral-sh.uv" -Nome "uv"
        if (-not (Tem-Comando "uv")) {
            Falha "uv não foi encontrado depois da instalação" "Instale manualmente (winget install --id astral-sh.uv -e) ou por https://astral.sh/uv, depois rode este instalador de novo."
        }
        Sucesso "uv instalado"
    }

    # -----------------------------------------------------------------------
    # 5. ffmpeg.
    # -----------------------------------------------------------------------

    Etapa "Instalando o ffmpeg"
    if (Tem-Comando "ffmpeg") {
        Sucesso "ffmpeg já instalado"
    } else {
        Instalar-Winget -Id "Gyan.FFmpeg" -Nome "ffmpeg"
        if (-not (Tem-Comando "ffmpeg")) {
            Falha "ffmpeg não foi encontrado depois da instalação" "Instale manualmente (winget install --id Gyan.FFmpeg -e), confira se entrou no PATH, e rode este instalador de novo."
        }
        Sucesso "ffmpeg instalado"
    }

    # -----------------------------------------------------------------------
    # 6. yt-dlp (via uv tool — os pacotes de distro/gerenciador ficam
    #    desatualizados e quebram Instagram/YouTube).
    # -----------------------------------------------------------------------

    Etapa "Instalando o yt-dlp"
    # --upgrade: rodar o instalador de novo é atualizar, e o yt-dlp é o que mais envelhece.
    uv tool install --upgrade yt-dlp
    if ($LASTEXITCODE -ne 0) {
        Falha "uv tool install yt-dlp falhou (código $LASTEXITCODE)" "Veja o erro acima, resolva e rode este instalador de novo."
    }
    Sucesso "yt-dlp instalado"

    # -----------------------------------------------------------------------
    # 7. Whisper — opcional, padrão SIM (Instagram e TikTok dependem dele).
    #    Windows não tem mlx (é exclusivo Apple Silicon): usa openai-whisper,
    #    que baixa ~2 GB de PyTorch — o instalador avisa o tamanho antes.
    # -----------------------------------------------------------------------

    $InstalarWhisper = $false
    if ($SemWhisper) {
        $InstalarWhisper = $false
    } elseif ($Sim) {
        $InstalarWhisper = $true
    } else {
        $resposta = Read-Host "Instalar o Whisper para transcrição de áudio (~2 GB de download, necessário para Instagram e TikTok)? [S/n]"
        if ($resposta -match '^[Nn]') {
            $InstalarWhisper = $false
        } else {
            $InstalarWhisper = $true
        }
    }

    if ($InstalarWhisper) {
        Etapa "Instalando o Whisper (openai-whisper, ~2 GB — pode demorar)"
        uv tool install openai-whisper
        if ($LASTEXITCODE -ne 0) {
            Falha "uv tool install openai-whisper falhou (código $LASTEXITCODE)" "Veja o erro acima, resolva e rode este instalador de novo (ou use -SemWhisper para pular)."
        }
        Sucesso "Whisper instalado"
    } else {
        Write-Host "→ Pulando o Whisper (Instagram e TikTok não vão transcrever até ele ser instalado)"
    }

    uv tool update-shell
    if ($LASTEXITCODE -ne 0) {
        # Não aborta — mesmo texto e mesma decisão do instalar.sh: é um aviso,
        # não uma dependência obrigatória (o instalador já corrigiu o PATH da
        # sessão atual via Atualizar-Path logo abaixo).
        Write-Host "  ⚠️  não consegui garantir %USERPROFILE%\.local\bin no PATH permanente — rode 'uv tool update-shell' você mesmo, ou adicione essa pasta ao PATH manualmente" -ForegroundColor Yellow
    }
    Atualizar-Path

    # -----------------------------------------------------------------------
    # 8. npm ci (cai para npm install se não houver lockfile).
    # -----------------------------------------------------------------------

    Etapa "Instalando dependências do projeto (npm)"
    # npm.cmd explícito, não "npm": o Node instala npm, npm.cmd E npm.ps1 lado a
    # lado, e o PowerShell resolve "npm" bare para npm.ps1 — que a política
    # padrão (Restricted) bloqueia de rodar ("cannot be loaded because running
    # scripts is disabled"). npm.cmd sempre existe e nunca esbarra nisso.
    if (Test-Path -LiteralPath (Join-Path $ProjectDir "package-lock.json")) {
        npm.cmd ci
    } else {
        npm.cmd install
    }
    if ($LASTEXITCODE -ne 0) {
        Falha "Instalação de dependências npm falhou (código $LASTEXITCODE)" "Veja o erro acima, resolva e rode este instalador de novo."
    }
    Sucesso "Dependências instaladas"

    # -----------------------------------------------------------------------
    # 9. Chromium do Playwright.
    # -----------------------------------------------------------------------

    # Chromium do Playwright: só serve para exportar PDF e a imagem do mapa
    # mental (src/pipeline/lib/browser.ts); o resto do Bruto funciona sem ele.
    # Por isso uma falha aqui é AVISO, nunca aborta a instalação — mesmo texto
    # e mesma decisão do instalar.sh.
    Etapa "Instalando o Chromium do Playwright (exporta PDF/imagem do mapa mental)"
    npx.cmd playwright install chromium
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  ⚠️  npx playwright install chromium falhou — só afeta exportar PDF e imagem do mapa mental; o resto do Bruto funciona sem isso" -ForegroundColor Yellow
        Write-Host "      rode manualmente depois: npx.cmd playwright install chromium" -ForegroundColor Yellow
    } else {
        Sucesso "Chromium instalado"
    }

    # -----------------------------------------------------------------------
    # 10. Banco: migrate + seed.
    # -----------------------------------------------------------------------

    Etapa "Rodando as migrations do banco"
    npm.cmd run db:migrate
    if ($LASTEXITCODE -ne 0) {
        Falha "npm run db:migrate falhou (código $LASTEXITCODE)" "Veja o erro acima, resolva e rode este instalador de novo."
    }
    Sucesso "Migrations aplicadas"

    Etapa "Populando dados iniciais (seed)"
    npm.cmd run db:seed
    if ($LASTEXITCODE -ne 0) {
        Falha "npm run db:seed falhou (código $LASTEXITCODE)" "Veja o erro acima, resolva e rode este instalador de novo."
    }
    Sucesso "Seed aplicado"

    # -----------------------------------------------------------------------
    # 11. Build — grava o commit em .next\.bruto-build-commit (serve.ps1 usa
    #     isso para saber se precisa rebuildar).
    # -----------------------------------------------------------------------

    Etapa "Compilando o Bruto (build)"
    npm.cmd run build
    if ($LASTEXITCODE -ne 0) {
        Falha "npm run build falhou (código $LASTEXITCODE)" "Veja o erro acima, resolva e rode este instalador de novo."
    }
    $commitAtual = (git rev-parse HEAD).Trim()
    if ($LASTEXITCODE -eq 0 -and $commitAtual) {
        $commitMarkerPath = Join-Path $ProjectDir ".next\.bruto-build-commit"
        [System.IO.File]::WriteAllText($commitMarkerPath, $commitAtual)
    }
    Sucesso "Build concluído"

    # -----------------------------------------------------------------------
    # 12. doctor — informativo, nunca reprova a instalação.
    # -----------------------------------------------------------------------

    Etapa "Rodando o doctor (diagnóstico informativo — não reprova a instalação)"
    npm.cmd run doctor
    Sucesso "Doctor executado (veja acima se há avisos)"

    # -----------------------------------------------------------------------
    # 13. Atalho — roda num processo powershell.exe FILHO de propósito: o
    #     script usa `exit` internamente, e isso só deve encerrar o filho,
    #     nunca esta função nem a sessão de quem chamou o instalador.
    # -----------------------------------------------------------------------

    if ($SemAtalho) {
        Write-Host "→ Pulando criação de atalho (-SemAtalho)"
    } else {
        Etapa "Criando os atalhos (Área de Trabalho + Menu Iniciar)"
        $atalhoScript = Join-Path $ProjectDir "launcher\atalho-windows.ps1"
        powershell.exe -NoProfile -ExecutionPolicy Bypass -File $atalhoScript -ProjectDir $ProjectDir
        if ($LASTEXITCODE -ne 0) {
            Write-Host "✗ Não consegui criar os atalhos automaticamente — rode depois: powershell -ExecutionPolicy Bypass -File `"$atalhoScript`"" -ForegroundColor Yellow
        } else {
            Sucesso "Atalhos criados"
        }
    }

    # -----------------------------------------------------------------------
    # 14. Qual IA vai processar — nunca cria, lê nem escreve .env.
    # -----------------------------------------------------------------------

    Etapa "Verificando qual IA vai processar (claude ou codex)"
    $temClaude = Tem-Comando "claude"
    $temCodex = Tem-Comando "codex"
    if ($temClaude -or $temCodex) {
        $nomes = @()
        if ($temClaude) { $nomes += "claude" }
        if ($temCodex) { $nomes += "codex" }
        Sucesso ("CLI encontrada: " + ([string]::Join(" e ", $nomes)) + ". Se estiver logada, o Bruto usa o plano dela.")
    } else {
        Write-Host "→ Nenhuma CLI de IA (claude ou codex) encontrada no PATH. Duas saídas:"
        Write-Host "  1) Instale e faça login na CLI do Claude (https://claude.com/claude-code) ou do Codex (OpenAI)."
        Write-Host "  2) Ou crie você mesmo um arquivo .env na raiz do projeto com a chave de API."
        Write-Host "  (Este instalador nunca cria, lê nem escreve o .env.)"
    }

    # -----------------------------------------------------------------------
    # Resumo final.
    # -----------------------------------------------------------------------

    Write-Host ""
    Write-Host "============================================"
    Write-Host " Bruto instalado em: $ProjectDir"
    if ($SemAtalho) {
        Write-Host " Abrir: powershell -NoProfile -ExecutionPolicy Bypass -File `"$ProjectDir\launcher\serve.ps1`""
    } else {
        Write-Host " Abrir: atalho 'Bruto' na Área de Trabalho ou no Menu Iniciar."
    }
    Write-Host " Atualizar: rode este instalador de novo (irm ... | iex, ou -File install\instalar.ps1)."
    Write-Host "============================================"
}

# ---------------------------------------------------------------------------
# Chamada — @PSBoundParameters repassa só o que foi de fato informado
# (-SemWhisper, -SemAtalho, -Sim, -Dir <pasta>) do param() do script para o
# param() de Instalar-Bruto. Em modo `irm | iex` não há parâmetros (nota no
# cabeçalho), então @PSBoundParameters chega vazio — comportamento padrão.
#
# `exit 1` só roda quando $PSCommandPath existe (modo -File, processo próprio
# do PowerShell rodando um arquivo): aí sim faz sentido sinalizar falha por
# código de saída. Em modo iex, $PSCommandPath é $null — a sessão da pessoa
# continua aberta, com a mensagem de erro visível acima, para ela poder agir.
# -----------------------------------------------------------------------

try {
    Instalar-Bruto @PSBoundParameters
} catch {
    Write-Host "✗ $($_.Exception.Message)" -ForegroundColor Red
    if ($PSCommandPath) {
        exit 1
    }
} finally {
    # Roda em sucesso E em falha (inclusive quando `exit 1` acima dispara —
    # `exit` desenrola `finally` pendente antes de encerrar o processo). Em
    # modo -File isto é irrelevante (o processo termina de qualquer forma);
    # em modo iex é o que devolve a sessão da pessoa como ela estava antes.
    $ErrorActionPreference = $ErrorActionPreferenceOriginal
    Set-Location -LiteralPath $LocalizacaoOriginal
}
