param(
    [string]$InstallRoot = "$env:LOCALAPPDATA\ChatPCB3\ChatPCB KiCad Preview",
    [switch]$Launch
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot

function Assert-ChatPCBPreviewNotRunning {
    $runningPreview = Get-Process -Name "ChatPCB KiCad Preview" -ErrorAction SilentlyContinue
    if ($runningPreview) {
        Write-Host "ChatPCB KiCad Preview가 실행 중입니다."
        Write-Host "앱을 닫고 설치 파일을 다시 실행하세요."
        exit 1
    }
}

Assert-ChatPCBPreviewNotRunning

Push-Location $repoRoot
try {
    if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
        throw "Rust Cargo를 찾을 수 없습니다. Rust를 설치하거나 packaged ChatPCB KiCad Preview zip을 사용하세요."
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
    Copy-Item -Force -Path "$repoRoot\packaging\README-FIRST-KO.txt" -Destination "$InstallRoot\README-FIRST-KO.txt"
    Copy-Item -Force -Path "$repoRoot\packaging\INSTALL-READY.txt" -Destination "$InstallRoot\INSTALL-READY.txt"

    $installSelfTestPath = Join-Path $InstallRoot "INSTALL-SELF-TEST.txt"
    $selfTestSummary = & "$InstallRoot\ChatPCB KiCad Preview.exe" --self-test-summary
    if ($LASTEXITCODE -ne 0) {
        throw "설치된 ChatPCB KiCad Preview 자체 검증 실패. 종료 코드: $LASTEXITCODE"
    }
    if (-not ($selfTestSummary -match "ChatPCB KiCad Preview Self Test")) {
        throw "설치된 ChatPCB KiCad Preview 자체 검증에서 예상한 summary header가 나오지 않았습니다."
    }
    $selfTestSummary | Set-Content -Path $installSelfTestPath -Encoding ASCII
    $installFirstChatSmokePath = Join-Path $InstallRoot "INSTALL-FIRST-CHAT-SMOKE.txt"
    $firstChatSmokeSummary = & "$InstallRoot\ChatPCB KiCad Preview.exe" --first-chat-smoke
    if ($LASTEXITCODE -ne 0) {
        throw "설치된 ChatPCB KiCad Preview 첫 채팅 smoke test 실패. 종료 코드: $LASTEXITCODE"
    }
    if (-not ($firstChatSmokeSummary -match "ChatPCB First Chat Smoke Test")) {
        throw "설치된 ChatPCB KiCad Preview 첫 채팅 smoke test에서 예상한 summary header가 나오지 않았습니다."
    }
    $firstChatSmokeSummary | Set-Content -Path $installFirstChatSmokePath -Encoding ASCII
    $installReadyPath = Join-Path $InstallRoot "INSTALL-READY.txt"

    $shell = New-Object -ComObject WScript.Shell
    $desktopPath = $shell.SpecialFolders.Item('Desktop')
    New-Item -ItemType Directory -Force -Path $desktopPath | Out-Null
    $shortcutPath = Join-Path $desktopPath "ChatPCB KiCad Preview.lnk"
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = "$InstallRoot\ChatPCB KiCad Preview.exe"
    $shortcut.WorkingDirectory = $InstallRoot
    $shortcut.Description = "ChatPCB KiCad 네이티브 미리보기 앱"
    $shortcut.Save()

    $programsPath = $shell.SpecialFolders.Item('Programs')
    $startMenuPath = Join-Path $programsPath "ChatPCB KiCad Preview"
    New-Item -ItemType Directory -Force -Path $startMenuPath | Out-Null
    $startShortcutPath = Join-Path $startMenuPath "ChatPCB KiCad Preview.lnk"
    $startShortcut = $shell.CreateShortcut($startShortcutPath)
    $startShortcut.TargetPath = "$InstallRoot\ChatPCB KiCad Preview.exe"
    $startShortcut.WorkingDirectory = $InstallRoot
    $startShortcut.Description = "ChatPCB KiCad 네이티브 미리보기 앱"
    $startShortcut.Save()
    $uninstallShortcutPath = Join-Path $startMenuPath "Uninstall ChatPCB KiCad Preview.lnk"
    $uninstallShortcut = $shell.CreateShortcut($uninstallShortcutPath)
    $uninstallShortcut.TargetPath = "$InstallRoot\Uninstall ChatPCB KiCad Preview.cmd"
    $uninstallShortcut.WorkingDirectory = $InstallRoot
    $uninstallShortcut.Description = "ChatPCB KiCad Preview 제거"
    $uninstallShortcut.Save()
    $selfTestShortcutPath = Join-Path $startMenuPath "Run ChatPCB Self Test.lnk"
    $selfTestShortcut = $shell.CreateShortcut($selfTestShortcutPath)
    $selfTestShortcut.TargetPath = "$InstallRoot\Run ChatPCB Self Test.cmd"
    $selfTestShortcut.WorkingDirectory = $InstallRoot
    $selfTestShortcut.Description = "설치 상태를 검증합니다"
    $selfTestShortcut.Save()
    $firstChatSmokeShortcutPath = Join-Path $startMenuPath "Run First Chat Smoke Test.lnk"
    $firstChatSmokeShortcut = $shell.CreateShortcut($firstChatSmokeShortcutPath)
    $firstChatSmokeShortcut.TargetPath = "$InstallRoot\Run First Chat Smoke Test.cmd"
    $firstChatSmokeShortcut.WorkingDirectory = $InstallRoot
    $firstChatSmokeShortcut.Description = "첫 채팅부터 미리보기 생성까지 검증합니다"
    $firstChatSmokeShortcut.Save()
    $startHereShortcutPath = Join-Path $startMenuPath "Start Here.lnk"
    $startHereShortcut = $shell.CreateShortcut($startHereShortcutPath)
    $startHereShortcut.TargetPath = "$InstallRoot\INSTALL-READY.txt"
    $startHereShortcut.WorkingDirectory = $InstallRoot
    $startHereShortcut.Description = "설치 직후 시작 안내를 엽니다"
    $startHereShortcut.Save()
    $firstGuideShortcutPath = Join-Path $startMenuPath "First Chat Guide.lnk"
    $firstGuideShortcut = $shell.CreateShortcut($firstGuideShortcutPath)
    $firstGuideShortcut.TargetPath = "$InstallRoot\README-FIRST.txt"
    $firstGuideShortcut.WorkingDirectory = $InstallRoot
    $firstGuideShortcut.Description = "첫 채팅 안내를 엽니다"
    $firstGuideShortcut.Save()
    $firstGuideKoShortcutPath = Join-Path $startMenuPath "First Chat Guide Korean.lnk"
    $firstGuideKoShortcut = $shell.CreateShortcut($firstGuideKoShortcutPath)
    $firstGuideKoShortcut.TargetPath = "$InstallRoot\README-FIRST-KO.txt"
    $firstGuideKoShortcut.WorkingDirectory = $InstallRoot
    $firstGuideKoShortcut.Description = "한국어 첫 채팅 안내를 엽니다"
    $firstGuideKoShortcut.Save()

    Write-Host "설치 완료: $InstallRoot"
    Write-Host "바탕화면 바로가기: $shortcutPath"
    Write-Host "시작 메뉴 바로가기: $startShortcutPath"
    Write-Host "자체 검증 바로가기: $selfTestShortcutPath"
    Write-Host "첫 채팅 smoke test 바로가기: $firstChatSmokeShortcutPath"
    Write-Host "시작 안내 바로가기: $startHereShortcutPath"
    Write-Host "첫 채팅 안내 바로가기: $firstGuideShortcutPath"
    Write-Host "한국어 첫 채팅 안내 바로가기: $firstGuideKoShortcutPath"
    Write-Host "자체 검증 결과: $installSelfTestPath"
    Write-Host "첫 채팅 smoke test 결과: $installFirstChatSmokePath"
    Write-Host "시작 안내: $installReadyPath"
    Write-Host "첫 채팅 안내: $InstallRoot\README-FIRST.txt"
    Write-Host "한국어 첫 채팅 안내: $InstallRoot\README-FIRST-KO.txt"

    if ($Launch) {
        Start-Process -FilePath "$InstallRoot\ChatPCB KiCad Preview.exe" -WorkingDirectory $InstallRoot
    }
}
finally {
    Pop-Location
}
