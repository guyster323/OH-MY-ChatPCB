@echo off
setlocal
cd /d "%~dp0"
echo Running ChatPCB KiCad Preview self-test...
echo.
"%~dp0ChatPCB KiCad Preview.exe" --self-test
if errorlevel 1 (
    echo.
    echo Self-test failed. Reinstall ChatPCB KiCad Preview from the package folder.
    pause
    exit /b 1
)
echo.
echo Self-test finished. Look for provider_login_shows_local_cli_login_hints: true and prototype-review boundaries in the JSON above.
pause
