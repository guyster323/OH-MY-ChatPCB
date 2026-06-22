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

    foreach ($path in @($zipPath, $packageRoot, $releaseEvidencePath, $sha256Path)) {
        if (-not (Test-Path $path)) {
            throw "Missing required preview package artifact: $path"
        }
    }

    $releaseEvidence = Get-Content -Raw -Path $releaseEvidencePath
    Assert-Contains $releaseEvidence "Git commit: $head" "RELEASE-EVIDENCE.txt does not match HEAD $head."
    Assert-Contains $releaseEvidence "Working tree: clean" "RELEASE-EVIDENCE.txt must record a clean working tree."
    Assert-Contains $releaseEvidence "ChatPCB KiCad Preview release evidence" "RELEASE-EVIDENCE.txt is not the expected package evidence."
    Assert-Contains $releaseEvidence "Preview only; not order-ready KiCad output yet" "Release boundary must stay honest before GitHub replacement."

    $sha256 = Get-Content -Raw -Path $sha256Path
    Assert-Contains $sha256 "ChatPCB KiCad Preview.exe" "SHA256SUMS.txt must include the desktop executable."
    Assert-Contains $sha256 "chatpcb-core.exe" "SHA256SUMS.txt must include the Rust core executable."

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
