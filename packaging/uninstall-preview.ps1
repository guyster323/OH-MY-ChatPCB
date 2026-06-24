param(
    [string]$InstallRoot = "$env:LOCALAPPDATA\ChatPCB3\ChatPCB KiCad Preview"
)

$ErrorActionPreference = "Stop"

Get-Process |
    Where-Object { $_.MainWindowTitle -eq "ChatPCB KiCad Preview" -or $_.ProcessName -eq "ChatPCB KiCad Preview" } |
    Stop-Process -Force -ErrorAction SilentlyContinue

$shell = New-Object -ComObject WScript.Shell
$desktopPath = $shell.SpecialFolders.Item('Desktop')
$desktopShortcut = Join-Path $desktopPath "ChatPCB KiCad Preview.lnk"

if (Test-Path $desktopShortcut) {
    Remove-Item -Force $desktopShortcut
}

$programsPath = $shell.SpecialFolders.Item('Programs')
$startMenuPath = Join-Path $programsPath "ChatPCB KiCad Preview"

if (Test-Path $startMenuPath) {
    Remove-Item -Recurse -Force $startMenuPath
}

if (Test-Path $InstallRoot) {
    Remove-Item -Recurse -Force $InstallRoot
}

Write-Host "제거 완료: $InstallRoot"
