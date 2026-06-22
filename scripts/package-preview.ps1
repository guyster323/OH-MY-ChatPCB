param(
    [string]$OutputRoot = "$PSScriptRoot\..\dist"
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$packageName = "ChatPCB-KiCad-Preview-windows-x64"
$stagingRoot = Join-Path $OutputRoot $packageName
$zipPath = Join-Path $OutputRoot "$packageName.zip"

Push-Location $repoRoot
try {
    if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
        throw "Rust Cargo was not found. Install Rust before building the preview package."
    }

    cargo build --release -p chatpcb-core -p chatpcb-desktop

    if (Test-Path $stagingRoot) {
        Remove-Item -Recurse -Force $stagingRoot
    }
    New-Item -ItemType Directory -Force -Path $stagingRoot | Out-Null

    Copy-Item -Force -Path "$repoRoot\target\release\chatpcb-core.exe" -Destination "$stagingRoot\chatpcb-core.exe"
    Copy-Item -Force -Path "$repoRoot\target\release\chatpcb-desktop.exe" -Destination "$stagingRoot\ChatPCB KiCad Preview.exe"
    Copy-Item -Force -Path "$repoRoot\packaging\Install ChatPCB KiCad Preview.cmd" -Destination "$stagingRoot\Install ChatPCB KiCad Preview.cmd"
    Copy-Item -Force -Path "$repoRoot\packaging\install-from-package.ps1" -Destination "$stagingRoot\install-from-package.ps1"
    Copy-Item -Force -Path "$repoRoot\packaging\README-FIRST.txt" -Destination "$stagingRoot\README-FIRST.txt"

    if (Test-Path $zipPath) {
        Remove-Item -Force $zipPath
    }

    Compress-Archive -Path "$stagingRoot\*" -DestinationPath $zipPath

    Write-Host "Created package folder: $stagingRoot"
    Write-Host "Created package zip: $zipPath"
}
finally {
    Pop-Location
}
