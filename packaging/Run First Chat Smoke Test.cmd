@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
echo 첫 채팅 smoke test를 실행합니다...
echo.
"%~dp0ChatPCB KiCad Preview.exe" --first-chat-smoke
if errorlevel 1 (
    echo.
    echo 첫 채팅 smoke test 실패. 패키지 폴더에서 ChatPCB KiCad Preview를 다시 설치하세요.
    pause
    exit /b 1
)
echo.
echo 첫 채팅 smoke test가 끝났습니다. 현재 단계는 prototype-review, 주문 준비 전입니다.
pause
