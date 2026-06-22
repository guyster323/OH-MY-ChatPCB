@echo off
setlocal

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall-preview.ps1"
set EXITCODE=%ERRORLEVEL%

if not "%EXITCODE%"=="0" (
  echo.
  echo ChatPCB KiCad Preview uninstall failed.
  echo.
  pause
  exit /b %EXITCODE%
)

echo.
echo ChatPCB KiCad Preview was removed.
timeout /t 3 >nul
