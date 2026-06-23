@echo off
setlocal
cd /d "%~dp0"
echo Running ChatPCB KiCad Preview self-test...
echo.
"%~dp0ChatPCB KiCad Preview.exe" --self-test-summary
if errorlevel 1 (
    echo.
    echo Self-test failed. Reinstall ChatPCB KiCad Preview from the package folder.
    pause
    exit /b 1
)
echo.
echo Self-test finished. This preview is prototype-review only, not order-ready.
pause
