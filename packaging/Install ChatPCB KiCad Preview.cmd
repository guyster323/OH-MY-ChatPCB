@echo off
setlocal

cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-from-package.ps1" -Launch
set EXITCODE=%ERRORLEVEL%

if not "%EXITCODE%"=="0" (
  echo.
  echo ChatPCB KiCad Preview installation failed.
  echo Make sure this file is still next to ChatPCB KiCad Preview.exe and chatpcb-core.exe.
  echo.
  pause
  exit /b %EXITCODE%
)

echo.
echo ChatPCB KiCad Preview is installed and starting now.
timeout /t 3 >nul
