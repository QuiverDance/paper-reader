[CmdletBinding()]
param(
    [ValidateRange(1, 65535)]
    [int]$Port = 1420,

    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$url = "http://127.0.0.1:$Port"

function Test-Paperloom {
    param([string]$Address)

    try {
        $response = Invoke-WebRequest -Uri $Address -UseBasicParsing -TimeoutSec 2
        return $response.StatusCode -eq 200 -and $response.Content -match "<title>Paperloom</title>"
    }
    catch {
        return $false
    }
}

try {
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue

    if (-not $nodeCommand -or -not $npmCommand) {
        throw "Node.js is required. Install Node.js 20 or newer, then run Paperloom.cmd again."
    }

    $viteReady = Test-Path (Join-Path $projectRoot "node_modules\.bin\vite.cmd")
    $codexReady = Test-Path (Join-Path $projectRoot "node_modules\@openai\codex\bin\codex.js")
    if (-not $viteReady -or -not $codexReady) {
        Write-Host "Preparing Paperloom for first use..."
        & $npmCommand.Source install --no-fund --no-audit
        if ($LASTEXITCODE -ne 0) {
            throw "The first-time setup did not finish successfully."
        }
    }

    if (-not (Test-Paperloom -Address $url)) {
        $stateRoot = if ($env:LOCALAPPDATA) {
            Join-Path $env:LOCALAPPDATA "Paperloom"
        }
        else {
            Join-Path ([System.IO.Path]::GetTempPath()) "Paperloom"
        }

        New-Item -ItemType Directory -Path $stateRoot -Force | Out-Null
        $outputLog = Join-Path $stateRoot "server.log"
        $errorLog = Join-Path $stateRoot "server-error.log"

        Write-Host "Starting Paperloom..."
        $serverProcess = Start-Process `
            -FilePath $npmCommand.Source `
            -ArgumentList @("run", "dev", "--", "--host", "127.0.0.1", "--port", "$Port") `
            -WorkingDirectory $projectRoot `
            -WindowStyle Hidden `
            -RedirectStandardOutput $outputLog `
            -RedirectStandardError $errorLog `
            -PassThru

        Set-Content -Path (Join-Path $stateRoot "server.pid") -Value $serverProcess.Id

        $ready = $false
        for ($attempt = 0; $attempt -lt 60; $attempt++) {
            if (Test-Paperloom -Address $url) {
                $ready = $true
                break
            }

            if ($serverProcess.HasExited) {
                break
            }

            Start-Sleep -Milliseconds 500
        }

        if (-not $ready) {
            $details = ""
            if (Test-Path $errorLog) {
                $details = (Get-Content $errorLog -Tail 8 -ErrorAction SilentlyContinue) -join [Environment]::NewLine
            }

            if ($details) {
                throw "Paperloom did not become ready.`n$details"
            }

            throw "Paperloom did not become ready. Another program may already be using port $Port."
        }
    }

    if (-not $NoBrowser) {
        Start-Process $url
    }

    Write-Host "Paperloom is ready at $url"
    exit 0
}
catch {
    Write-Error $_.Exception.Message
    exit 1
}
