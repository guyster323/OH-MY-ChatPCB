param(
    [string]$InstallRoot = "$env:LOCALAPPDATA\ChatPCB3\ChatPCB KiCad Preview",
    [switch]$Launch
)

$ErrorActionPreference = "Stop"

$packageRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$desktopExe = Join-Path $packageRoot "ChatPCB KiCad Preview.exe"
$coreExe = Join-Path $packageRoot "chatpcb-core.exe"
$uninstallScript = Join-Path $packageRoot "uninstall-preview.ps1"
$uninstallCommand = Join-Path $packageRoot "Uninstall ChatPCB KiCad Preview.cmd"
$selfTestCommand = Join-Path $packageRoot "Run ChatPCB Self Test.cmd"
$firstReadme = Join-Path $packageRoot "README-FIRST.txt"

if (-not (Test-Path $desktopExe)) {
    throw "Missing ChatPCB KiCad Preview.exe in the package folder."
}

if (-not (Test-Path $coreExe)) {
    throw "Missing chatpcb-core.exe in the package folder."
}

if (-not (Test-Path $uninstallScript)) {
    throw "Missing uninstall-preview.ps1 in the package folder."
}

if (-not (Test-Path $uninstallCommand)) {
    throw "Missing Uninstall ChatPCB KiCad Preview.cmd in the package folder."
}

if (-not (Test-Path $selfTestCommand)) {
    throw "Missing Run ChatPCB Self Test.cmd in the package folder."
}

if (-not (Test-Path $firstReadme)) {
    throw "Missing README-FIRST.txt in the package folder."
}

New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
Copy-Item -Force -Path $desktopExe -Destination "$InstallRoot\ChatPCB KiCad Preview.exe"
Copy-Item -Force -Path $coreExe -Destination "$InstallRoot\chatpcb-core.exe"
Copy-Item -Force -Path $uninstallScript -Destination "$InstallRoot\uninstall-preview.ps1"
Copy-Item -Force -Path $uninstallCommand -Destination "$InstallRoot\Uninstall ChatPCB KiCad Preview.cmd"
Copy-Item -Force -Path $selfTestCommand -Destination "$InstallRoot\Run ChatPCB Self Test.cmd"
Copy-Item -Force -Path $firstReadme -Destination "$InstallRoot\README-FIRST.txt"

$installSelfTestPath = Join-Path $InstallRoot "INSTALL-SELF-TEST.txt"
$selfTestSummary = & "$InstallRoot\ChatPCB KiCad Preview.exe" --self-test-summary
if ($LASTEXITCODE -ne 0) {
    throw "Installed ChatPCB KiCad Preview self-test failed with exit code $LASTEXITCODE."
}
if (-not ($selfTestSummary -match "ChatPCB KiCad Preview Self Test")) {
    throw "Installed ChatPCB KiCad Preview self-test did not return the expected summary header."
}
$selfTestSummary | Set-Content -Path $installSelfTestPath -Encoding ASCII

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

Write-Host "Installed ChatPCB KiCad Preview to: $InstallRoot"
Write-Host "Desktop shortcut: $shortcutPath"
Write-Host "Start menu shortcut: $startShortcutPath"
Write-Host "Self-test shortcut: $selfTestShortcutPath"
Write-Host "Install self-test: $installSelfTestPath"
Write-Host "First chat guide: $InstallRoot\README-FIRST.txt"

if ($Launch) {
    Start-Process -FilePath "$InstallRoot\ChatPCB KiCad Preview.exe" -WorkingDirectory $InstallRoot
}
