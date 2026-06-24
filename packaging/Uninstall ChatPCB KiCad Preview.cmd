@echo off
chcp 65001 >nul
setlocal

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall-preview.ps1"
set EXITCODE=%ERRORLEVEL%

if not "%EXITCODE%"=="0" (
  echo.
  echo ChatPCB KiCad Preview 제거 실패.
  echo.
  pause
  exit /b %EXITCODE%
)

echo.
echo 제거가 끝났습니다.
timeout /t 3 >nul
