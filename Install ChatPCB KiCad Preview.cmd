@echo off
setlocal

cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-local.ps1" -Launch
set EXITCODE=%ERRORLEVEL%

if not "%EXITCODE%"=="0" (
  echo.
  echo ChatPCB KiCad Preview installation failed.
  echo If ChatPCB KiCad Preview is open, close it and run this installer again.
  echo If this source install says Rust Cargo is missing, use the packaged zip installer instead.
  echo.
  pause
  exit /b %EXITCODE%
)

echo.
echo ChatPCB KiCad Preview is installed and starting now.
timeout /t 3 >nul
