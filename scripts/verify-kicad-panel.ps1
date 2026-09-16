$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$skill = Join-Path $repoRoot '.grok\skills\kicad-panel-computer-use\SKILL.md'
$launch = Join-Path $PSScriptRoot 'launch-kicad-chatpcb.ps1'

if (-not (Test-Path -LiteralPath $skill)) {
    throw "Missing computer-use skill: $skill"
}

$healthOk = $false
try {
    $health = Invoke-WebRequest -Uri 'http://127.0.0.1:41317/health' -UseBasicParsing -TimeoutSec 2
    $healthOk = $health.StatusCode -eq 200
} catch {
    $healthOk = $false
}

if (-not $healthOk) {
    Write-Host 'Starting chatpcb-agentd'
    Start-Process -FilePath 'node' -ArgumentList @(
        (Join-Path $repoRoot 'bin\chatpcb-cli.js'),
        'daemon', '--host', '127.0.0.1', '--port', '41317'
    ) -WorkingDirectory $repoRoot -WindowStyle Hidden | Out-Null
}

if (-not (Get-Process -Name eeschema -ErrorAction SilentlyContinue)) {
    & $launch
}

Write-Host 'Default interactive verification is Orca computer-use on eeschema.'
Write-Host "Follow: $skill"
Write-Host 'Do not treat npm run verify:ui as the KiCad panel gate.'
