@echo off
chcp 65001 >nul
setlocal

cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-local.ps1" -Launch
set EXITCODE=%ERRORLEVEL%

if not "%EXITCODE%"=="0" (
  echo.
  echo ChatPCB KiCad Preview 설치 실패.
  echo 앱이 열려 있다면 닫고 다시 실행하세요.
  echo source 설치에서 Rust Cargo가 없다고 나오면 packaged zip installer를 사용하세요.
  echo.
  pause
  exit /b %EXITCODE%
)

echo.
echo 설치가 끝났습니다. 앱을 시작합니다.
timeout /t 3 >nul
