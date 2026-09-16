$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$fork = if ($env:CHATPCB_KICAD_FORK) {
    $env:CHATPCB_KICAD_FORK
} else {
    'C:\Users\windo\kicad-source-mirror-chatpcb'
}

if (-not (Test-Path -LiteralPath $fork)) {
    throw "KiCad fork checkout not found: $fork"
}

$panelSource = Join-Path $repoRoot 'kicad-fork\chatpcb_panel'
$panelDest = Join-Path $fork 'plugins\chatpcb_panel'
$assetSource = Join-Path $repoRoot 'apps\panel'
$assetDest = Join-Path $fork 'share\chatpcb_panel'

New-Item -ItemType Directory -Force -Path $panelDest | Out-Null
New-Item -ItemType Directory -Force -Path $assetDest | Out-Null
Copy-Item -Force -Path (Join-Path $panelSource '*') -Destination $panelDest
Copy-Item -Force -Path (Join-Path $assetSource '*') -Destination $assetDest

Write-Host "Synced ChatPCB panel sources into $fork"
Write-Host "  C++: $panelDest"
Write-Host "  WebView bundle: $assetDest"
