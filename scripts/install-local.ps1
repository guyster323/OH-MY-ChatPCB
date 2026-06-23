param(
    [string]$InstallRoot = "$env:LOCALAPPDATA\ChatPCB3\ChatPCB KiCad Preview",
    [switch]$Launch
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot
try {
    if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
        throw "Rust Cargo was not found. Install Rust first, or use the packaged ChatPCB KiCad Preview zip."
    }

    cargo build --release -p chatpcb-core -p chatpcb-desktop

    New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null

    Copy-Item -Force -Path "$repoRoot\target\release\chatpcb-core.exe" -Destination "$InstallRoot\chatpcb-core.exe"
    Copy-Item -Force -Path "$repoRoot\target\release\chatpcb-desktop.exe" -Destination "$InstallRoot\ChatPCB KiCad Preview.exe"
    Copy-Item -Force -Path "$repoRoot\packaging\uninstall-preview.ps1" -Destination "$InstallRoot\uninstall-preview.ps1"
    Copy-Item -Force -Path "$repoRoot\packaging\Uninstall ChatPCB KiCad Preview.cmd" -Destination "$InstallRoot\Uninstall ChatPCB KiCad Preview.cmd"
    Copy-Item -Force -Path "$repoRoot\packaging\Run ChatPCB Self Test.cmd" -Destination "$InstallRoot\Run ChatPCB Self Test.cmd"
    Copy-Item -Force -Path "$repoRoot\packaging\Run First Chat Smoke Test.cmd" -Destination "$InstallRoot\Run First Chat Smoke Test.cmd"
    Copy-Item -Force -Path "$repoRoot\packaging\README-FIRST.txt" -Destination "$InstallRoot\README-FIRST.txt"

    $installSelfTestPath = Join-Path $InstallRoot "INSTALL-SELF-TEST.txt"
    $selfTestSummary = & "$InstallRoot\ChatPCB KiCad Preview.exe" --self-test-summary
    if ($LASTEXITCODE -ne 0) {
        throw "Installed ChatPCB KiCad Preview self-test failed with exit code $LASTEXITCODE."
    }
    if (-not ($selfTestSummary -match "ChatPCB KiCad Preview Self Test")) {
        throw "Installed ChatPCB KiCad Preview self-test did not return the expected summary header."
    }
    $selfTestSummary | Set-Content -Path $installSelfTestPath -Encoding ASCII
    $installFirstChatSmokePath = Join-Path $InstallRoot "INSTALL-FIRST-CHAT-SMOKE.txt"
    $firstChatSmokeSummary = & "$InstallRoot\ChatPCB KiCad Preview.exe" --first-chat-smoke
    if ($LASTEXITCODE -ne 0) {
        throw "Installed ChatPCB KiCad Preview first chat smoke test failed with exit code $LASTEXITCODE."
    }
    if (-not ($firstChatSmokeSummary -match "ChatPCB First Chat Smoke Test")) {
        throw "Installed ChatPCB KiCad Preview first chat smoke test did not return the expected summary header."
    }
    $firstChatSmokeSummary | Set-Content -Path $installFirstChatSmokePath -Encoding ASCII
    $installReadyPath = Join-Path $InstallRoot "INSTALL-READY.txt"
    $installReady = @(
        "ChatPCB KiCad Preview is installed.",
        "",
        "Start here:",
        "1. Open ChatPCB KiCad Preview.",
        "2. Type a board idea in Chat prompt, then press Enter.",
        "3. Click Open evidence after the preview is saved.",
        "",
        "Verification written during install:",
        "- INSTALL-SELF-TEST.txt",
        "- INSTALL-FIRST-CHAT-SMOKE.txt",
        "",
        "Boundary: prototype-review, not order-ready."
    )
    $installReady | Set-Content -Path $installReadyPath -Encoding ASCII

    $shell = New-Object -ComObject WScript.Shell
    $desktopPath = $shell.SpecialFolders.Item('Desktop')
    New-Item -ItemType Directory -Force -Path $desktopPath | Out-Null
    $shortcutPath = Join-Path $desktopPath "ChatPCB KiCad Preview.lnk"
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = "$InstallRoot\ChatPCB KiCad Preview.exe"
    $shortcut.WorkingDirectory = $InstallRoot
    $shortcut.Description = "Native ChatPCB KiCad preview app"
    $shortcut.Save()

    $programsPath = $shell.SpecialFolders.Item('Programs')
    $startMenuPath = Join-Path $programsPath "ChatPCB KiCad Preview"
    New-Item -ItemType Directory -Force -Path $startMenuPath | Out-Null
    $startShortcutPath = Join-Path $startMenuPath "ChatPCB KiCad Preview.lnk"
    $startShortcut = $shell.CreateShortcut($startShortcutPath)
    $startShortcut.TargetPath = "$InstallRoot\ChatPCB KiCad Preview.exe"
    $startShortcut.WorkingDirectory = $InstallRoot
    $startShortcut.Description = "Native ChatPCB KiCad preview app"
    $startShortcut.Save()
    $uninstallShortcutPath = Join-Path $startMenuPath "Uninstall ChatPCB KiCad Preview.lnk"
    $uninstallShortcut = $shell.CreateShortcut($uninstallShortcutPath)
    $uninstallShortcut.TargetPath = "$InstallRoot\Uninstall ChatPCB KiCad Preview.cmd"
    $uninstallShortcut.WorkingDirectory = $InstallRoot
    $uninstallShortcut.Description = "Remove ChatPCB KiCad Preview"
    $uninstallShortcut.Save()
    $selfTestShortcutPath = Join-Path $startMenuPath "Run ChatPCB Self Test.lnk"
    $selfTestShortcut = $shell.CreateShortcut($selfTestShortcutPath)
    $selfTestShortcut.TargetPath = "$InstallRoot\Run ChatPCB Self Test.cmd"
    $selfTestShortcut.WorkingDirectory = $InstallRoot
    $selfTestShortcut.Description = "Verify the ChatPCB KiCad Preview installation"
    $selfTestShortcut.Save()
    $firstChatSmokeShortcutPath = Join-Path $startMenuPath "Run First Chat Smoke Test.lnk"
    $firstChatSmokeShortcut = $shell.CreateShortcut($firstChatSmokeShortcutPath)
    $firstChatSmokeShortcut.TargetPath = "$InstallRoot\Run First Chat Smoke Test.cmd"
    $firstChatSmokeShortcut.WorkingDirectory = $InstallRoot
    $firstChatSmokeShortcut.Description = "Verify the first ChatPCB chat-to-preview path"
    $firstChatSmokeShortcut.Save()
    $firstGuideShortcutPath = Join-Path $startMenuPath "First Chat Guide.lnk"
    $firstGuideShortcut = $shell.CreateShortcut($firstGuideShortcutPath)
    $firstGuideShortcut.TargetPath = "$InstallRoot\README-FIRST.txt"
    $firstGuideShortcut.WorkingDirectory = $InstallRoot
    $firstGuideShortcut.Description = "Open the ChatPCB KiCad first chat guide"
    $firstGuideShortcut.Save()

    Write-Host "Installed ChatPCB KiCad Preview to: $InstallRoot"
    Write-Host "Desktop shortcut: $shortcutPath"
    Write-Host "Start menu shortcut: $startShortcutPath"
    Write-Host "Self-test shortcut: $selfTestShortcutPath"
    Write-Host "First chat smoke test shortcut: $firstChatSmokeShortcutPath"
    Write-Host "First chat guide shortcut: $firstGuideShortcutPath"
    Write-Host "Install self-test: $installSelfTestPath"
    Write-Host "First chat smoke test: $installFirstChatSmokePath"
    Write-Host "Install ready summary: $installReadyPath"
    Write-Host "First chat guide: $InstallRoot\README-FIRST.txt"

    if ($Launch) {
        Start-Process -FilePath "$InstallRoot\ChatPCB KiCad Preview.exe" -WorkingDirectory $InstallRoot
    }
}
finally {
    Pop-Location
}
