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
    Copy-Item -Force -Path "$repoRoot\packaging\Run ChatPCB Self Test.cmd" -Destination "$stagingRoot\Run ChatPCB Self Test.cmd"
    Copy-Item -Force -Path "$repoRoot\packaging\Run First Chat Smoke Test.cmd" -Destination "$stagingRoot\Run First Chat Smoke Test.cmd"
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
        "- App launch focuses prompt input for immediate first chat",
        "- App launch selects available provider model",
        "- Prompt input has visible label and empty cue",
        "- Prompt input and Send design transcript flow",
        "- Prompt Enter key sends design",
        "- Empty prompt visibly uses the built-in ESP32-S3 example",
        "- Chat transcript append flow across Provider Login and Send design",
        "- Provider Login appends without erasing chat",
        "- Provider Login keeps built-in preview unblocked when no CLI is ready",
        "- Provider Login shows local CLI login hints",
        "- Self-test shortcut for installed package verification",
        "- Installer writes INSTALL-SELF-TEST.txt after copying executables",
        "- First chat smoke test shortcut for non-expert verification",
        "- Installer writes INSTALL-FIRST-CHAT-SMOKE.txt after copying executables",
        "- First Chat Guide Start Menu shortcut",
        "- Provider Login returns focus to prompt",
        "- Use example returns focus to prompt",
        "- Use example selects prompt text for immediate overwrite",
        "- Chat transcript latest-turn scrolling after updates",
        "- Pipeline status transitions for first-run actions",
        "- Preview workspace evidence folder creation on Send design",
        "- KiCad preview scaffold files generated on Send design",
        "- 50mm PCB preview outline in generated KiCad PCB",
        "- KiCad CLI preview compatibility check on Send design",
        "- KiCad ERC and DRC JSON reports on Send design",
        "- Beginner next steps file for first-run users",
        "- Actionable validation status points to Open PCB and Open evidence",
        "- Left workspace status update after Send design",
        "- Left tab status updates for schematic/layout/validation/manufacturing preview",
        "- Left design preview body for schematic/layout/validation/manufacturing preview",
        "- Open PCB/evidence waits until a preview workspace exists",
        "- Open evidence button for the saved preview workspace",
        "- Open evidence selects BEGINNER-NEXT-STEPS.txt for non-expert review",
        "- Open PCB button launches the generated KiCad PCB preview",
        "- Open PCB status distinguishes KiCad editor from file fallback",
        "- Open evidence recovers previous preview workspace after relaunch",
        "- Relaunch shows previous preview workspace status before another send",
        "- Relaunch mentions previous preview workspace in chat",
        "- KiCad fork CMake drop-in target",
        "- KiCad fork stdio chatpcb-core bridge skeleton",
        "- Local install into %LOCALAPPDATA%\ChatPCB3\ChatPCB KiCad Preview",
        "",
        "Current boundary:",
        "- Preview only; not order-ready KiCad output yet",
        "- No completed schematic, PCB autoroute, Gerber, BOM, or CPL generation yet",
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
