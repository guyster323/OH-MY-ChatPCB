param(
    [string]$ExpectedRemote = "git@github.com:guyster323/OH-MY-ChatPCB.git",
    [switch]$ConfirmExternalReplacement
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$readyScript = Join-Path $PSScriptRoot "verify-github-replacement-ready.ps1"
$publishedScript = Join-Path $PSScriptRoot "verify-github-replacement-published.ps1"

Push-Location $repoRoot
try {
    if (-not $ConfirmExternalReplacement) {
        throw "This script performs an external GitHub push. Re-run only after explicit action-time approval with -ConfirmExternalReplacement."
    }

    $head = (git rev-parse HEAD).Trim()
    $shortHead = (git rev-parse --short HEAD).Trim()

    & $readyScript -ExpectedRemote $ExpectedRemote -CheckRemoteHead

    Write-Host "About to replace guyster323/OH-MY-ChatPCB main with local HEAD $shortHead."
    git push origin HEAD:main

    & $publishedScript -ExpectedRemote $ExpectedRemote -ExpectedHead $head

    Write-Host "EXTERNAL_GITHUB_PUSH_PERFORMED"
    Write-Host "Published replacement verified: guyster323/OH-MY-ChatPCB main now matches $shortHead."
}
finally {
    Pop-Location
}
