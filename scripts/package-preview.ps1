param(
    [string]$OutputRoot = "$PSScriptRoot\..\dist"
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$packageName = "ChatPCB-KiCad-Preview-windows-x64"
$stagingRoot = Join-Path $OutputRoot $packageName
$zipPath = Join-Path $OutputRoot "$packageName.zip"
$releaseEvidencePath = Join-Path $stagingRoot "RELEASE-EVIDENCE.txt"
$sha256Path = Join-Path $stagingRoot "SHA256SUMS.txt"

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
    Copy-Item -Force -Path "$repoRoot\packaging\Uninstall ChatPCB KiCad Preview.cmd" -Destination "$stagingRoot\Uninstall ChatPCB KiCad Preview.cmd"
    Copy-Item -Force -Path "$repoRoot\packaging\install-from-package.ps1" -Destination "$stagingRoot\install-from-package.ps1"
    Copy-Item -Force -Path "$repoRoot\packaging\uninstall-preview.ps1" -Destination "$stagingRoot\uninstall-preview.ps1"
    Copy-Item -Force -Path "$repoRoot\packaging\README-FIRST.txt" -Destination "$stagingRoot\README-FIRST.txt"

    $commit = (git rev-parse --short HEAD).Trim()
    $branch = (git branch --show-current).Trim()
    $workingTreeState = if ((git status --porcelain).Length -eq 0) { "clean" } else { "dirty" }
    $builtAt = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss zzz")
    $packageFiles = Get-ChildItem -File -Path $stagingRoot | Sort-Object Name

    $evidence = @(
        "ChatPCB KiCad Preview release evidence",
        "=======================================",
        "",
        "Package: $packageName",
        "Built at: $builtAt",
        "Git branch: $branch",
        "Git commit: $commit",
        "Working tree: $workingTreeState",
        "",
        "Included files:",
        ($packageFiles | ForEach-Object { "- $($_.Name) ($($_.Length) bytes)" }),
        "",
        "Verified scope:",
        "- Native Windows preview shell",
        "- Provider Login local CLI status detection",
        "- Prompt input and Send design transcript flow",
        "- Pipeline status transitions for first-run actions",
        "- Preview workspace evidence folder creation on Send design",
        "- Left workspace status update after Send design",
        "- Left tab status updates for schematic/layout/validation/manufacturing preview",
        "- Open evidence button for the saved preview workspace",
        "- Local install into %LOCALAPPDATA%\ChatPCB3\ChatPCB KiCad Preview",
        "",
        "Current boundary:",
        "- Preview only; not order-ready KiCad output yet",
        "- No real schematic, PCB autoroute, Gerber, BOM, or CPL generation yet",
        "- No provider credentials are stored by ChatPCB3"
    )
    Set-Content -Path $releaseEvidencePath -Value $evidence -Encoding ASCII

    Get-ChildItem -File -Path $stagingRoot |
        Sort-Object Name |
        ForEach-Object {
            $hash = Get-FileHash -Algorithm SHA256 -Path $_.FullName
            "$($hash.Hash.ToLowerInvariant())  $($_.Name)"
        } |
        Set-Content -Path $sha256Path -Encoding ASCII

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
