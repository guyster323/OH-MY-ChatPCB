param(
    [string]$ExpectedRemote = "git@github.com:guyster323/OH-MY-ChatPCB.git",
    [string]$ExpectedHead = ""
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$packageName = "ChatPCB-KiCad-Preview-windows-x64"
$packageRoot = Join-Path $repoRoot "dist\$packageName"
$zipPath = Join-Path $repoRoot "dist\$packageName.zip"
$releaseEvidencePath = Join-Path $packageRoot "RELEASE-EVIDENCE.txt"

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
    $head = (git rev-parse HEAD).Trim()
    $shortHead = (git rev-parse --short HEAD).Trim()
    $branch = (git branch --show-current).Trim()
    $remote = (git remote get-url origin).Trim()
    $workingTree = (git status --porcelain)
    $acceptedRemotes = @(
        $ExpectedRemote,
        "https://github.com/guyster323/OH-MY-ChatPCB.git"
    )
    $headToVerify = $ExpectedHead

    if ($headToVerify.Length -eq 0) {
        $headToVerify = $head
    }

    if ($branch -ne "main") {
        throw "Expected branch main while verifying the published replacement, but found '$branch'."
    }

    if ($acceptedRemotes -notcontains $remote) {
        throw "Origin remote must target guyster323/OH-MY-ChatPCB. Found: $remote"
    }

    if (-not $head.StartsWith($headToVerify)) {
        throw "Expected local HEAD to match $headToVerify, but found $head."
    }

    if ($workingTree.Length -ne 0) {
        throw "Working tree must be clean before published replacement verification."
    }

    foreach ($path in @($zipPath, $packageRoot, $releaseEvidencePath)) {
        if (-not (Test-Path $path)) {
            throw "Missing required published verification artifact: $path"
        }
    }

    $releaseEvidence = Get-Content -Raw -Path $releaseEvidencePath
    Assert-Contains $releaseEvidence "Git commit: $shortHead" "RELEASE-EVIDENCE.txt does not match HEAD $shortHead."
    Assert-Contains $releaseEvidence "Working tree: clean" "RELEASE-EVIDENCE.txt must record a clean working tree."
    Assert-Contains $releaseEvidence "Provider model selector is readiness-only for preview generation" "Release evidence must say provider selection is readiness-only."
    Assert-Contains $releaseEvidence "No provider CLI is invoked for preview generation" "Release evidence must say provider CLIs are not invoked for preview generation."
    Assert-Contains $releaseEvidence "Preview only; not order-ready KiCad output yet" "Release boundary must stay honest after publication."

    $remoteHeadLine = (git ls-remote origin refs/heads/main).Trim()
    if ($remoteHeadLine.Length -eq 0) {
        throw "Could not read remote main for guyster323/OH-MY-ChatPCB."
    }

    $remoteHead = ($remoteHeadLine -split "\s+")[0]
    if ($remoteHead -ne $head) {
        throw "Remote main does not match local HEAD. Remote: $remoteHead Local: $head"
    }

    Write-Host "Remote main matches local HEAD: $shortHead"
    Write-Host "GitHub replacement published verification passed for guyster323/OH-MY-ChatPCB."
}
finally {
    Pop-Location
}
