# Bruto — launcher local (Windows).
# Garante o servidor de produção rodando em http://127.0.0.1:${BRUTO_PORT:-3000} e
# abre o app numa janela de aplicativo (Chrome/Edge, sem barra de navegação).
# Chamado pelo atalho "Bruto.lnk"; também pode ser rodado direto no PowerShell.
#
# Compatível com Windows PowerShell 5.1 (sem `??`, `?.`, ternário, `&&`/`||`).
# Espelha launcher/serve.sh (Unix) + a seção "O que o atalho faz" de install/CONTRATO.md.

$ErrorActionPreference = 'Stop'

try {
    # Sem console anexado quando roda via -WindowStyle Hidden (o caso normal,
    # chamado pelo atalho) — segue sem forçar se não houver console.
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
} catch {
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

if (-not (Test-Path -LiteralPath $AppDir)) {
    Write-Host "Projeto não encontrado em $AppDir"
    exit 1
}
Set-Location -LiteralPath $AppDir

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

if (-not (Test-BrutoUp)) {
    $buildIdPath = Join-Path $AppDir ".next\BUILD_ID"
    $commitMarkerPath = Join-Path $AppDir ".next\.bruto-build-commit"

    $commitAtual = $null
    $gitOut = git rev-parse HEAD 2>$null
    if ($LASTEXITCODE -eq 0 -and $gitOut) {
        $commitAtual = ([string]$gitOut).Trim()
    }

    $precisaBuild = $false
    if (-not (Test-Path -LiteralPath $buildIdPath)) {
        # Sem build nenhum ainda.
        $precisaBuild = $true
    } elseif ($commitAtual) {
        if (Test-Path -LiteralPath $commitMarkerPath) {
            $commitDoBuild = (Get-Content -LiteralPath $commitMarkerPath -Raw).Trim()
            if ($commitDoBuild -ne $commitAtual) {
                $precisaBuild = $true
            }
        } else {
            # Existe build mas sem marcador de commit — trata como desatualizado.
            $precisaBuild = $true
        }
    }

    if ($precisaBuild) {
        "$(Get-Date) — build inicial…" | Out-File -FilePath $Log -Append -Encoding utf8
        npm run build *>> $Log
        if ($LASTEXITCODE -ne 0) {
            Write-Host "Build falhou — veja $Log"
            exit 1
        }
        if ($commitAtual) {
            [System.IO.File]::WriteAllText($commitMarkerPath, $commitAtual)
        }
    }

    "$(Get-Date) — iniciando servidor…" | Out-File -FilePath $Log -Append -Encoding utf8
    # Sobe o servidor escondido (sobrevive ao fechar o atalho): cmd /c redirecionando
    # stdout+stderr para o log, num Start-Process oculto.
    $cmdArgs = "/c npm run start -- -p $Port >> `"$Log`" 2>&1"
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
