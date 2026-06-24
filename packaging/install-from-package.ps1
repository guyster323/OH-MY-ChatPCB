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
$firstChatSmokeCommand = Join-Path $packageRoot "Run First Chat Smoke Test.cmd"
$firstReadme = Join-Path $packageRoot "README-FIRST.txt"
$firstReadmeKo = Join-Path $packageRoot "README-FIRST-KO.txt"
$installReadyTemplate = Join-Path $packageRoot "INSTALL-READY.txt"

if (-not (Test-Path $desktopExe)) {
    throw "패키지 폴더에서 ChatPCB KiCad Preview.exe를 찾을 수 없습니다."
}

if (-not (Test-Path $coreExe)) {
    throw "패키지 폴더에서 chatpcb-core.exe를 찾을 수 없습니다."
}

if (-not (Test-Path $uninstallScript)) {
    throw "패키지 폴더에서 uninstall-preview.ps1을 찾을 수 없습니다."
}

if (-not (Test-Path $uninstallCommand)) {
    throw "패키지 폴더에서 Uninstall ChatPCB KiCad Preview.cmd를 찾을 수 없습니다."
}

if (-not (Test-Path $selfTestCommand)) {
    throw "패키지 폴더에서 Run ChatPCB Self Test.cmd를 찾을 수 없습니다."
}

if (-not (Test-Path $firstChatSmokeCommand)) {
    throw "패키지 폴더에서 Run First Chat Smoke Test.cmd를 찾을 수 없습니다."
}

if (-not (Test-Path $firstReadme)) {
    throw "패키지 폴더에서 README-FIRST.txt를 찾을 수 없습니다."
}

if (-not (Test-Path $firstReadmeKo)) {
    throw "패키지 폴더에서 README-FIRST-KO.txt를 찾을 수 없습니다."
}

if (-not (Test-Path $installReadyTemplate)) {
    throw "패키지 폴더에서 INSTALL-READY.txt를 찾을 수 없습니다."
}

function Assert-ChatPCBPreviewNotRunning {
    $runningPreview = Get-Process -Name "ChatPCB KiCad Preview" -ErrorAction SilentlyContinue
    if ($runningPreview) {
        Write-Host "ChatPCB KiCad Preview가 실행 중입니다."
        Write-Host "앱을 닫고 설치 파일을 다시 실행하세요."
        exit 1
    }
}

Assert-ChatPCBPreviewNotRunning

New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
Copy-Item -Force -Path $desktopExe -Destination "$InstallRoot\ChatPCB KiCad Preview.exe"
Copy-Item -Force -Path $coreExe -Destination "$InstallRoot\chatpcb-core.exe"
Copy-Item -Force -Path $uninstallScript -Destination "$InstallRoot\uninstall-preview.ps1"
Copy-Item -Force -Path $uninstallCommand -Destination "$InstallRoot\Uninstall ChatPCB KiCad Preview.cmd"
Copy-Item -Force -Path $selfTestCommand -Destination "$InstallRoot\Run ChatPCB Self Test.cmd"
Copy-Item -Force -Path $firstChatSmokeCommand -Destination "$InstallRoot\Run First Chat Smoke Test.cmd"
Copy-Item -Force -Path $firstReadme -Destination "$InstallRoot\README-FIRST.txt"
Copy-Item -Force -Path $firstReadmeKo -Destination "$InstallRoot\README-FIRST-KO.txt"
Copy-Item -Force -Path $installReadyTemplate -Destination "$InstallRoot\INSTALL-READY.txt"

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
    Start-Process -FilePath "$InstallRoot\ChatPCB KiCad Preview.exe" -WorkingDirectory $InstallRoot -ArgumentList "--fresh-start"
}
