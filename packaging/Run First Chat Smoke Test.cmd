@echo off
setlocal
cd /d "%~dp0"
echo Running ChatPCB first chat smoke test...
echo.
"%~dp0ChatPCB KiCad Preview.exe" --first-chat-smoke
if errorlevel 1 (
    echo.
    echo First chat smoke test failed. Reinstall ChatPCB KiCad Preview from the package folder.
    pause
    exit /b 1
)
echo.
echo First chat smoke test finished. This preview is prototype-review only, not order-ready.
pause
