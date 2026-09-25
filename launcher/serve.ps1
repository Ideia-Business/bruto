# Bruto — launcher local (Windows).
# Garante o servidor de produção rodando em http://127.0.0.1:${BRUTO_PORT:-3000} e
# abre o app numa janela de aplicativo (Chrome/Edge, sem barra de navegação).
# Chamado pelo atalho "Bruto.lnk"; também pode ser rodado direto no PowerShell.
#
# Compatível com Windows PowerShell 5.1 (sem `??`, `?.`, ternário, `&&`/`||`).
# Espelha launcher/serve.sh (Unix) + a seção "O que o atalho faz" de install/CONTRATO.md.
#
# Roda quase sempre com -WindowStyle Hidden (o atalho): um `Write-Host` de erro
# nesse modo não aparece para ninguém — por isso todo caminho de falha real
# também mostra um popup (Aviso-Visivel, abaixo) antes de sair.

$ErrorActionPreference = 'Stop'

try {
    # Sem console anexado quando roda via -WindowStyle Hidden (o caso normal,
    # chamado pelo atalho) — segue sem forçar se não houver console.
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
} catch {
}

# O atalho herda o PATH de quem o disparou (Explorer, etc.), que pode não ter
# os shims do `uv tool` (yt-dlp, whisper: %USERPROFILE%\.local\bin) mesmo já
# instalados — o processo do Explorer pode ser mais antigo que a instalação.
# Espelha o export do serve.sh, que faz a mesma coisa com $HOME/.local/bin.
$env:Path = "$env:USERPROFILE\.local\bin;$env:Path"

function Aviso-Visivel {
    # Popup modal — a única forma confiável de uma falha aparecer quando este
    # script roda oculto (-WindowStyle Hidden, o caso do atalho). Tenta
    # MessageBox (WinForms); se não der (raríssimo — .NET sem WinForms),
    # cai para WScript.Shell.Popup, presente em qualquer Windows.
    param([string]$Mensagem)
    try {
        Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
        [System.Windows.Forms.MessageBox]::Show(
            $Mensagem,
            "Bruto",
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Warning
        ) | Out-Null
    } catch {
        try {
            $shell = New-Object -ComObject WScript.Shell
            $shell.Popup($Mensagem, 0, "Bruto", 48) | Out-Null
        } catch {
            # Sem popup possível — ao menos fica no log/console, se houver.
            Write-Host $Mensagem
        }
    }
}

# Raiz do projeto = diretório pai deste script. Funciona em qualquer clone,
# de qualquer usuário, sem edição — igual ao serve.sh.
$AppDir = Split-Path -Parent $PSScriptRoot

$Port = "3000"
if ($env:BRUTO_PORT) {
    $Port = $env:BRUTO_PORT
}
$Url = "http://127.0.0.1:$Port"
$Log = Join-Path $env:TEMP "bruto-server.log"

function Test-BrutoUp {
    try {
        Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2 | Out-Null
        return $true
    } catch [System.Net.WebException] {
        # Se o servidor respondeu com QUALQUER status HTTP (mesmo erro), ele está
        # de pé — só a ausência de resposta (Response == $null: recusado/timeout)
        # conta como "fora do ar". Espelha o curl do serve.sh, que não usa -f.
        if ($_.Exception.Response) {
            return $true
        }
        return $false
    } catch {
        return $false
    }
}

# Tudo abaixo roda dentro de um try/catch: qualquer erro inesperado (não só os
# casos específicos já tratados) vira um popup visível em vez de sumir numa
# janela oculta — a mesma resiliência que o serve.sh tem por não usar `set -e`
# neste arquivo.
try {
    if (-not (Test-Path -LiteralPath $AppDir)) {
        Aviso-Visivel "Bruto: projeto não encontrado em`n$AppDir"
        exit 1
    }
    Set-Location -LiteralPath $AppDir

    if (-not (Test-BrutoUp)) {
        $buildIdPath = Join-Path $AppDir ".next\BUILD_ID"
        $commitMarkerPath = Join-Path $AppDir ".next\.bruto-build-commit"

        $commitAtual = $null
        try {
            # Se "git" não estiver no PATH herdado pelo atalho, chamar o
            # comando lança CommandNotFoundException — que com
            # $ErrorActionPreference='Stop' vira erro terminal e mataria o
            # script aqui (sem isto, o app nunca sobe). Sem git, segue com
            # commit vazio: sempre builda por segurança, igual ao
            # commit_atual() do serve.sh (git rev-parse ... 2>/dev/null || echo "").
            $gitOut = git rev-parse HEAD 2>$null
            if ($LASTEXITCODE -eq 0 -and $gitOut) {
                $commitAtual = ([string]$gitOut).Trim()
            }
        } catch {
            $commitAtual = $null
        }

        $precisaBuild = $false
        if (-not (Test-Path -LiteralPath $buildIdPath)) {
            # Sem build nenhum ainda.
            $precisaBuild = $true
        } elseif (-not (Test-Path -LiteralPath $commitMarkerPath)) {
            # Existe build mas sem marcador de commit — trata como desatualizado,
            # com ou sem git (igual ao precisa_build do serve.sh; Grok, rodada 8).
            $precisaBuild = $true
        } elseif ($commitAtual) {
            $commitDoBuild = (Get-Content -LiteralPath $commitMarkerPath -Raw).Trim()
            if ($commitDoBuild -ne $commitAtual) {
                $precisaBuild = $true
            }
        }

        if ($precisaBuild) {
            "$(Get-Date) — build inicial…" | Out-File -FilePath $Log -Append -Encoding utf8
            $buildFalhou = $false
            try {
                # npm.cmd explícito: "npm" bare resolve para npm.ps1 no
                # PowerShell (o Node instala os dois lado a lado), e a
                # política padrão (Restricted) bloqueia scripts .ps1.
                npm.cmd run build *>> $Log
                if ($LASTEXITCODE -ne 0) {
                    $buildFalhou = $true
                }
            } catch {
                # npm.cmd não encontrado (Node ausente do PATH herdado) cai
                # aqui também — mesmo tratamento visível que uma falha de build.
                "$(Get-Date) — erro ao chamar npm.cmd: $($_.Exception.Message)" | Out-File -FilePath $Log -Append -Encoding utf8
                $buildFalhou = $true
            }
            if ($buildFalhou) {
                Aviso-Visivel "Bruto: o build falhou e o app não vai abrir.`n`nVeja o log em`n$Log`n`nSe você acabou de instalar Node/npm, feche esta janela, abra um terminal novo e rode o atalho de novo (às vezes é preciso uma sessão nova para o PATH atualizar)."
                exit 1
            }
            # Grava o marcador sempre — vazio quando não há git. Sem ele, todo
            # início a frio rebuildaria (Grok, rodada 9). Quando o git voltar,
            # o marcador vazio difere do commit e o próximo início rebuilda.
            $marcador = ''
            if ($commitAtual) { $marcador = $commitAtual }
            [System.IO.File]::WriteAllText($commitMarkerPath, $marcador)
        }

        "$(Get-Date) — iniciando servidor…" | Out-File -FilePath $Log -Append -Encoding utf8
        # Sobe o servidor escondido (sobrevive ao fechar o atalho): cmd /c redirecionando
        # stdout+stderr para o log, num Start-Process oculto. npm.cmd explícito aqui
        # também: cmd.exe já resolveria "npm" certo sozinho (seu PATHEXT não prioriza
        # .ps1 como o do PowerShell), mas fica explícito por consistência com o resto
        # do arquivo e para não depender desse detalhe do cmd.exe.
        $cmdArgs = "/c npm.cmd run start -- -p $Port >> `"$Log`" 2>&1"
        Start-Process -FilePath "cmd.exe" -ArgumentList $cmdArgs -WorkingDirectory $AppDir -WindowStyle Hidden

        # Aguarda ficar pronto (até ~40s no primeiro boot).
        $tentativas = 0
        while ($tentativas -lt 80) {
            if (Test-BrutoUp) {
                break
            }
            Start-Sleep -Milliseconds 500
            $tentativas++
        }
        if (-not (Test-BrutoUp)) {
            # Não é fatal (igual ao serve.sh, que também não trata isso como
            # erro): só avisa e segue para abrir a janela mesmo assim — o
            # servidor pode terminar de subir nos segundos seguintes.
            Aviso-Visivel "Bruto: o servidor está demorando mais que o normal para responder (mais de 40s).`n`nVeja o log em`n$Log`n`nA janela vai abrir mesmo assim — atualize a página em alguns segundos se aparecer em branco."
        }
    }

    # Abre em janela de app (Chrome ou Edge, modo --app). Fallback: navegador padrão.
    $candidatosNavegador = @(
        (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe"),
        (Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe"),
        (Join-Path $env:ProgramFiles "Microsoft\Edge\Application\msedge.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "Microsoft\Edge\Application\msedge.exe"),
        (Join-Path $env:LOCALAPPDATA "Microsoft\Edge\Application\msedge.exe")
    )

    $navegador = $null
    foreach ($candidato in $candidatosNavegador) {
        if ($candidato -and (Test-Path -LiteralPath $candidato)) {
            $navegador = $candidato
            break
        }
    }

    if ($navegador) {
        Start-Process -FilePath $navegador -ArgumentList "--app=$Url", "--new-window"
    } else {
        Start-Process $Url
    }
} catch {
    # Rede de segurança final: qualquer erro não previsto acima também vira
    # popup visível, nunca some numa janela oculta.
    Aviso-Visivel "Bruto encontrou um erro inesperado:`n`n$($_.Exception.Message)`n`nVeja também o log em`n$Log"
    exit 1
}
