# Bruto — cria os atalhos do Windows (Área de Trabalho + Menu Iniciar).
# Compatível com Windows PowerShell 5.1 (sem recursos exclusivos do PowerShell 7:
# sem `??`, `?.`, ternário, `&&`/`||`).
#
# Uso normal: chamado por install\instalar.ps1, que passa -ProjectDir explicitamente
# rodando este script num processo powershell.exe FILHO (nunca com `&` no mesmo
# processo — este script termina com `exit`, e `exit` dentro de um script chamado
# por `&`/dot-source no MESMO processo encerraria a sessão inteira do chamador).
# Também pode ser rodado sozinho: powershell -ExecutionPolicy Bypass -File launcher\atalho-windows.ps1

param(
    [string]$ProjectDir
)

$ErrorActionPreference = 'Stop'

try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
} catch {
}

if (-not $ProjectDir) {
    # Raiz do projeto = diretório pai deste script (launcher\..).
    $ProjectDir = Split-Path -Parent $PSScriptRoot
}
$ProjectDir = (Resolve-Path -LiteralPath $ProjectDir).Path

$ServeScript = Join-Path $ProjectDir "launcher\serve.ps1"
$IconPath = Join-Path $ProjectDir "launcher\icon.ico"

if (-not (Test-Path -LiteralPath $ServeScript)) {
    Write-Host "✗ Não achei $ServeScript — atalho não criado." -ForegroundColor Red
    exit 1
}

function New-BrutoAtalho {
    param(
        [string]$Destino
    )

    $shell = New-Object -ComObject WScript.Shell
    try {
        $atalho = $shell.CreateShortcut($Destino)
        $atalho.TargetPath = "powershell.exe"
        $atalho.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$ServeScript`""
        $atalho.WorkingDirectory = $ProjectDir
        if (Test-Path -LiteralPath $IconPath) {
            $atalho.IconLocation = $IconPath
        }
        $atalho.Save()
    } finally {
        [System.Runtime.InteropServices.Marshal]::ReleaseComObject($shell) | Out-Null
    }
}

$falhas = @()

try {
    $desktop = [Environment]::GetFolderPath('Desktop')
    New-BrutoAtalho -Destino (Join-Path $desktop "Bruto.lnk")
    Write-Host "✓ Atalho criado na Área de Trabalho"
} catch {
    Write-Host "✗ Não consegui criar o atalho na Área de Trabalho — $($_.Exception.Message)" -ForegroundColor Red
    $falhas += "Área de Trabalho"
}

try {
    $menuIniciar = [Environment]::GetFolderPath('Programs')
    New-BrutoAtalho -Destino (Join-Path $menuIniciar "Bruto.lnk")
    Write-Host "✓ Atalho criado no Menu Iniciar"
} catch {
    Write-Host "✗ Não consegui criar o atalho no Menu Iniciar — $($_.Exception.Message)" -ForegroundColor Red
    $falhas += "Menu Iniciar"
}

if ($falhas.Count -gt 0) {
    exit 1
}
exit 0
