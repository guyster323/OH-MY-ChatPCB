$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$fork = if ($env:CHATPCB_KICAD_FORK) {
    $env:CHATPCB_KICAD_FORK
} else {
    'C:\Users\windo\kicad-source-mirror-chatpcb'
}

$eeschemaCandidates = @(
    (Join-Path $fork 'build\chatpcb-vcpkg\eeschema\eeschema.exe'),
    (Join-Path $fork 'build\eeschema\eeschema.exe')
)
$eeschema = $eeschemaCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1

if (-not $eeschema) {
    Write-Error @"
ChatPCB-enabled KiCad schematic editor was not found.

Expected:
  $($eeschemaCandidates -join "`n  ")

Build it from this repository:
  npm run sync:kicad-fork
  npm run configure:kicad-fork
  then rebuild eeschema as documented in docs/KICAD_FORK_BOOTSTRAP.md

The product UI is the KiCad right-side ChatPCB panel, not the standalone browser fallback.
"@
    exit 2
}

$panelPath = [System.IO.Path]::GetFullPath((Join-Path $repoRoot 'apps\panel\index.html'))
$panelAssets = @(
    $panelPath,
    (Join-Path $repoRoot 'apps\panel\panel.js'),
    (Join-Path $repoRoot 'apps\panel\styles.css')
) | Where-Object { Test-Path -LiteralPath $_ }
$panelStamp = ($panelAssets | ForEach-Object { (Get-Item -LiteralPath $_).LastWriteTimeUtc.Ticks } | Measure-Object -Maximum).Maximum
$panelUrl = 'file:///' + ($panelPath -replace '\\', '/') + "?v=$panelStamp"
$cliPath = [System.IO.Path]::GetFullPath((Join-Path $repoRoot 'bin\chatpcb-cli.js'))
$daemonCommand = "node $cliPath daemon --host 127.0.0.1 --port 41317"

$healthOk = $false
try {
    $health = Invoke-WebRequest -Uri 'http://127.0.0.1:41317/health' -UseBasicParsing -TimeoutSec 2
    $healthOk = $health.StatusCode -eq 200
} catch {
    $healthOk = $false
}

if (-not $healthOk) {
    Write-Host 'Starting chatpcb-agentd on 127.0.0.1:41317'
    Start-Process -FilePath 'node' -ArgumentList @($cliPath, 'daemon', '--host', '127.0.0.1', '--port', '41317') -WorkingDirectory $repoRoot -WindowStyle Hidden | Out-Null
    $deadline = (Get-Date).AddSeconds(20)
    do {
        Start-Sleep -Milliseconds 400
        try {
            $health = Invoke-WebRequest -Uri 'http://127.0.0.1:41317/health' -UseBasicParsing -TimeoutSec 2
            $healthOk = $health.StatusCode -eq 200
        } catch {
            $healthOk = $false
        }
    } while (-not $healthOk -and (Get-Date) -lt $deadline)

    if (-not $healthOk) {
        throw 'chatpcb-agentd did not become healthy on 127.0.0.1:41317'
    }
}

$eeschemaDir = Split-Path -Parent $eeschema
$vcpkgBin = Join-Path $fork 'build\chatpcb-vcpkg\vcpkg_installed\x64-windows\bin'
$pathPrefix = $eeschemaDir
if (Test-Path -LiteralPath $vcpkgBin) {
    $pathPrefix = "$eeschemaDir;$vcpkgBin"
}

Write-Host "Launching ChatPCB-enabled KiCad schematic editor"
Write-Host "  $eeschema"
Write-Host "  panel: $panelUrl"
Write-Host "Use the right-side ChatPCB panel. Official KiCad builds do not include this host."

# `start` detaches from this shell's job object so eeschema keeps running after the launcher exits.
$launchBat = Join-Path $env:TEMP 'launch-kicad-chatpcb.bat'
@"
@echo off
set "PATH=$pathPrefix;%PATH%"
set "CHATPCB_PANEL_URL=$panelUrl"
set "CHATPCB_CLI_COMMAND=$daemonCommand"
start "ChatPCB KiCad" /D "$eeschemaDir" "$eeschema"
"@ | Set-Content -Encoding ASCII -Path $launchBat

cmd.exe /c "`"$launchBat`""
