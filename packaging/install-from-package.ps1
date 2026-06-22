param(
    [string]$InstallRoot = "$env:LOCALAPPDATA\ChatPCB3\ChatPCB KiCad Preview",
    [switch]$Launch
)

$ErrorActionPreference = "Stop"

$packageRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$desktopExe = Join-Path $packageRoot "ChatPCB KiCad Preview.exe"
$coreExe = Join-Path $packageRoot "chatpcb-core.exe"

if (-not (Test-Path $desktopExe)) {
    throw "Missing ChatPCB KiCad Preview.exe in the package folder."
}

if (-not (Test-Path $coreExe)) {
    throw "Missing chatpcb-core.exe in the package folder."
}

New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
Copy-Item -Force -Path $desktopExe -Destination "$InstallRoot\ChatPCB KiCad Preview.exe"
Copy-Item -Force -Path $coreExe -Destination "$InstallRoot\chatpcb-core.exe"

$shell = New-Object -ComObject WScript.Shell
$desktopPath = $shell.SpecialFolders.Item('Desktop')
New-Item -ItemType Directory -Force -Path $desktopPath | Out-Null
$shortcutPath = Join-Path $desktopPath "ChatPCB KiCad Preview.lnk"
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = "$InstallRoot\ChatPCB KiCad Preview.exe"
$shortcut.WorkingDirectory = $InstallRoot
$shortcut.Description = "Native ChatPCB KiCad preview app"
$shortcut.Save()

Write-Host "Installed ChatPCB KiCad Preview to: $InstallRoot"
Write-Host "Desktop shortcut: $shortcutPath"

if ($Launch) {
    Start-Process -FilePath "$InstallRoot\ChatPCB KiCad Preview.exe" -WorkingDirectory $InstallRoot
}
