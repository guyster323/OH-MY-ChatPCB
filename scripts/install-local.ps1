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
}
finally {
    Pop-Location
}
