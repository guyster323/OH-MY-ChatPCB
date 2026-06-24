ChatPCB KiCad Preview 빠른 시작
================================

설치
----

1. 압축을 푼 폴더에서 "Install ChatPCB KiCad Preview.cmd"를 더블클릭합니다.
2. 설치가 끝나면 ChatPCB KiCad Preview가 자동으로 열립니다.
3. 나중에는 시작 메뉴의 "ChatPCB KiCad Preview" 폴더에서 다시 열 수 있습니다.

첫 채팅
-------

1. 앱이 열리면 오른쪽 아래의 채팅 입력칸에 만들고 싶은 보드를 적고 Enter를 누릅니다.
2. 예: USB-C ESP32-S3 온습도 센서 보드, I2C 센서, JLCPCB 조립
3. 비워 둔 채 Enter를 누르면 내장 ESP32-S3 예제가 사용됩니다.
4. Provider Login은 선택 사항입니다. 로컬 Codex, Claude Code, Gemini CLI 로그인 상태를 확인하지만 Provider/model 선택은 준비 상태 확인용입니다. preview 생성은 built-in local generator를 사용하며 provider CLI는 호출하지 않습니다.
5. 결과가 나오면 PCB 열기로 KiCad 파일을 열거나 검토 목록으로 저장된 검토 파일을 확인합니다.

현재 경계
---------

- 상태는 prototype-review 입니다.
- 아직 JLCPCB에 올리거나 주문할 수 있는 order-ready 패키지가 아닙니다.
- Gerber, Drill, 사람이 검토한 BOM/CPL 생성 전까지는 주문하지 마세요.
- 원하는 변경은 다시 채팅 입력칸에 적어 후속 채팅으로 이어가세요.
