param(
    [string]$ExpectedRemote = "git@github.com:guyster323/OH-MY-ChatPCB.git",
    [switch]$CheckRemoteHead
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$packageName = "ChatPCB-KiCad-Preview-windows-x64"
$packageRoot = Join-Path $repoRoot "dist\$packageName"
$zipPath = Join-Path $repoRoot "dist\$packageName.zip"
$releaseEvidencePath = Join-Path $packageRoot "RELEASE-EVIDENCE.txt"
$sha256Path = Join-Path $packageRoot "SHA256SUMS.txt"
$firstReadmePath = Join-Path $packageRoot "README-FIRST.txt"
$firstReadmeKoPath = Join-Path $packageRoot "README-FIRST-KO.txt"
$installerPath = Join-Path $packageRoot "install-from-package.ps1"

function Assert-Contains {
    param(
        [string]$Text,
        [string]$Needle,
        [string]$Message
    )

    if (-not $Text.Contains($Needle)) {
        throw $Message
    }
}

Push-Location $repoRoot
try {
    $head = (git rev-parse --short HEAD).Trim()
    $branch = (git branch --show-current).Trim()
    $remote = (git remote get-url origin).Trim()
    $workingTree = (git status --porcelain)
    $acceptedRemotes = @(
        $ExpectedRemote,
        "https://github.com/guyster323/OH-MY-ChatPCB.git"
    )

    if ($branch -ne "main") {
        throw "Expected branch main before replacing OH-MY-ChatPCB, but found '$branch'."
    }

    if ($acceptedRemotes -notcontains $remote) {
        throw "Origin remote must target guyster323/OH-MY-ChatPCB. Found: $remote"
    }

    if ($workingTree.Length -ne 0) {
        throw "Working tree must be clean before replacement readiness check."
    }

    foreach ($path in @($zipPath, $packageRoot, $releaseEvidencePath, $sha256Path, $firstReadmePath, $firstReadmeKoPath, $installerPath)) {
        if (-not (Test-Path $path)) {
            throw "Missing required preview package artifact: $path"
        }
    }

    $releaseEvidence = Get-Content -Raw -Path $releaseEvidencePath
    Assert-Contains $releaseEvidence "Git commit: $head" "RELEASE-EVIDENCE.txt does not match HEAD $head."
    Assert-Contains $releaseEvidence "Working tree: clean" "RELEASE-EVIDENCE.txt must record a clean working tree."
    Assert-Contains $releaseEvidence "ChatPCB KiCad Preview release evidence" "RELEASE-EVIDENCE.txt is not the expected package evidence."
    Assert-Contains $releaseEvidence "Start Here Start Menu shortcut" "Release evidence must include the start-here shortcut."
    Assert-Contains $releaseEvidence "First Chat Guide Start Menu shortcut" "Release evidence must include the first chat guide shortcut."
    Assert-Contains $releaseEvidence "Korean first chat guide for non-expert users" "Release evidence must include the Korean first chat guide."
    Assert-Contains $releaseEvidence "Korean first-screen chat cue" "Release evidence must include the Korean first-screen chat cue."
    Assert-Contains $releaseEvidence "Provider model selector is readiness-only for preview generation" "Release evidence must say provider selection is readiness-only."
    Assert-Contains $releaseEvidence "Preview generation uses the built-in local generator" "Release evidence must say preview generation is local."
    Assert-Contains $releaseEvidence "No provider CLI is invoked for preview generation" "Release evidence must say provider CLIs are not invoked for preview generation."
    Assert-Contains $releaseEvidence "Preview only; not order-ready KiCad output yet" "Release boundary must stay honest before GitHub replacement."

    $sha256 = Get-Content -Raw -Path $sha256Path
    Assert-Contains $sha256 "ChatPCB KiCad Preview.exe" "SHA256SUMS.txt must include the desktop executable."
    Assert-Contains $sha256 "chatpcb-core.exe" "SHA256SUMS.txt must include the Rust core executable."
    Assert-Contains $sha256 "README-FIRST.txt" "SHA256SUMS.txt must include the first chat guide."
    Assert-Contains $sha256 "README-FIRST-KO.txt" "SHA256SUMS.txt must include the Korean first chat guide."
    Assert-Contains $sha256 "install-from-package.ps1" "SHA256SUMS.txt must include the packaged installer."

    $firstReadme = Get-Content -Raw -Path $firstReadmePath
    Assert-Contains $firstReadme "First chat" "README-FIRST.txt must explain the first chat path."
    Assert-Contains $firstReadme "INSTALL-READY.txt" "README-FIRST.txt must mention the install-ready summary."
    Assert-Contains $firstReadme "Boundary: prototype-review, not order-ready" "README-FIRST.txt must preserve the preview boundary."
    Assert-Contains $firstReadme "provider/model selection is readiness-only" "README-FIRST.txt must explain selected providers are readiness-only."
    Assert-Contains $firstReadme "built-in local generator" "README-FIRST.txt must explain preview generation stays local."
    Assert-Contains $firstReadme "No provider CLI is invoked" "README-FIRST.txt must explain provider CLIs are not invoked for preview generation."

    $firstReadmeKo = Get-Content -Raw -Path $firstReadmeKoPath
    Assert-Contains $firstReadmeKo "ChatPCB KiCad Preview 빠른 시작" "README-FIRST-KO.txt must provide a Korean quick start title."
    Assert-Contains $firstReadmeKo "Chat prompt" "README-FIRST-KO.txt must tell a first-run user where to type."
    Assert-Contains $firstReadmeKo "prototype-review" "README-FIRST-KO.txt must preserve the preview boundary."
    Assert-Contains $firstReadmeKo "No provider CLI is invoked" "README-FIRST-KO.txt must explain provider CLIs are not invoked for preview generation."

    $installer = Get-Content -Raw -Path $installerPath
    Assert-Contains $installer "Start Here.lnk" "Packaged installer must create the Start Here Start Menu shortcut."
    Assert-Contains $installer "First Chat Guide.lnk" "Packaged installer must create the First Chat Guide Start Menu shortcut."
    Assert-Contains $installer "First Chat Guide Korean.lnk" "Packaged installer must create the Korean First Chat Guide Start Menu shortcut."
    Assert-Contains $installer "README-FIRST.txt" "Packaged installer must copy README-FIRST.txt beside the installed app."
    Assert-Contains $installer "README-FIRST-KO.txt" "Packaged installer must copy README-FIRST-KO.txt beside the installed app."
    Assert-Contains $installer "Open the Korean ChatPCB KiCad first chat guide" "Packaged installer must label the Korean first chat guide shortcut."
    Assert-Contains $installer "INSTALL-READY.txt" "Packaged installer must write the install-ready summary."
    Assert-Contains $installer "Type a board idea in Chat prompt, then press Enter." "Install-ready summary must tell a first-run user how to start."

    if ($CheckRemoteHead) {
        $remoteHead = (git ls-remote origin refs/heads/main).Trim()
        if ($remoteHead.Length -eq 0) {
            throw "Could not read remote main for guyster323/OH-MY-ChatPCB."
        }
        Write-Host "Remote main: $remoteHead"
    }

    Write-Host "GitHub replacement dry-run passed for guyster323/OH-MY-ChatPCB."
    Write-Host "Local HEAD: $head"
    Write-Host "Replacement asset: ChatPCB-KiCad-Preview-windows-x64.zip"
    Write-Host "Preview zip: $zipPath"
    Write-Host "NO_PUSH_PERFORMED"
    Write-Host "External replacement still requires explicit user approval at action time."
}
finally {
    Pop-Location
}
