ChatPCB KiCad Preview 빠른 시작
================================

이 파일은 설치 후 바로 첫 채팅을 보내기 위한 기본 안내입니다.

설치
----
1. 압축을 푼 폴더에서 "Install ChatPCB KiCad Preview.cmd"를 더블클릭합니다.
   ChatPCB KiCad Preview가 이미 열려 있으면 닫고 설치 파일을 다시 실행하세요.
2. 설치가 끝나면 ChatPCB KiCad Preview가 자동으로 열립니다.
3. 바탕화면과 시작 메뉴의 "ChatPCB KiCad Preview" 폴더에 바로가기가 만들어집니다.
4. 시작 메뉴에는 "Start Here", "First Chat Guide", "First Chat Guide Korean",
   "Run ChatPCB Self Test", "Run First Chat Smoke Test"도 함께 만들어집니다.
5. 설치 폴더에는 INSTALL-READY.txt, INSTALL-SELF-TEST.txt,
   INSTALL-FIRST-CHAT-SMOKE.txt가 작성됩니다.

첫 채팅 (First chat)
--------------------
1. 앱이 열리면 오른쪽 아래 채팅 입력칸이 이미 선택되어 있습니다.
2. 만들 보드를 채팅 입력칸에 적고 Enter를 누릅니다.
3. 예: USB-C ESP32-S3 온습도 센서 보드, I2C 센서, JLCPCB 조립
4. 입력칸을 비운 채 Enter를 누르면 내장 ESP32-S3 예시가 사용됩니다.
5. "예시 사용"을 누르면 예시 문구가 선택되어 있으므로 바로 타이핑하면 덮어씁니다.
6. "Provider Login"은 선택 사항입니다. 로컬 Codex, Claude Code, Gemini 로그인
   상태만 확인합니다.
7. Provider 선택은 로그인 상태 확인용입니다. 미리보기 생성은 앱 안의 기본 생성기를
   사용하며 Codex, Claude Code, Gemini 로컬 도구를 대신 실행하지 않습니다.
8. 모델 선택은 로컬 도구가 없으면 "내장 미리보기"를 보여주고, 로컬 도구가 있으면
   "Codex 자동", "Claude Code 자동", "Gemini 자동" 같은 표시명을 보여줍니다.
9. 결과가 나오면 "PCB 열기"로 KiCad 파일을 보거나 "검토 목록"으로 저장된 검토
   파일을 확인합니다.
10. 후속 변경은 다시 채팅 입력칸에 적고 Enter를 누릅니다.

첫 결과에서 확인할 것
---------------------
- 채팅에는 "미리보기 저장 완료"가 보여야 합니다.
- saved preview bottom status:
  "미리보기 저장 완료 | 검토 목록에서 저장 위치 확인 | prototype-review, order-ready 아님."
- 검증이 깨끗하면 하단 상태는
  "검증 완료: PCB 열기/검토 목록 또는 후속 입력. 아직 prototype-review." 입니다.
- 검토 목록은 BEGINNER-NEXT-STEPS.txt를 선택한 상태로 미리보기 폴더를 엽니다
  (with BEGINNER-NEXT-STEPS.txt selected).
- FIRST-RUN-SUMMARY.txt stays in the same folder.
- 미리보기 폴더에는 BEGINNER-NEXT-STEPS.txt, jlcpcb-bom-preview.csv,
  jlcpcb-cpl-preview.csv, manufacturing-readiness-preview.txt가 포함됩니다.
- 자세한 KiCad 확인 파일은 kicad-pcb-check.txt입니다.
- 자세한 ERC/DRC 보고서는 erc-report.json, drc-report.json,
  kicad-validation-summary.txt입니다.

다시 열었을 때
--------------
- 이전 미리보기가 있으면 "이전 미리보기 발견"이 보입니다.
- short bottom status:
  "이전 미리보기: 이어서 입력 후 Enter. PCB 열기/검토 목록."
- "검토 목록"을 먼저 눌러도 같은 이전 미리보기 폴더를 다시 열 수 있습니다.
- 기본 프로젝트 폴더는 다음 위치입니다:
  %LOCALAPPDATA%\ChatPCB3\Projects\chatpcb3-esp32s3-preview

자체 검증
---------
- 시작 메뉴에서 "Run ChatPCB Self Test"를 실행하면 설치된 실행 파일의 짧은 PASS
  요약을 확인할 수 있습니다.
- 주요 PASS 문구:
  - PASS Provider Login shows local CLI login hints
  - PASS model selector falls back to built-in preview
  - PASS app launch focuses the prompt for immediate first chat
  - PASS prompt input has a visible label and empty cue
  - PASS pressing Enter sends the first design
  - PASS empty prompt visibly uses the built-in ESP32-S3 example
  - PASS Send design returns focus for follow-up chat
  - PASS provider/model selection is readiness-only for preview generation
  - PASS first-run evidence blocks JLCPCB upload
- 시작 메뉴에서 "Run First Chat Smoke Test"를 실행하면 첫 채팅이 미리보기
  workspace로 저장되는 흐름을 확인할 수 있습니다.
- 주요 smoke PASS 문구:
  - PASS KiCad compatibility report written
  - PASS beginner next steps written
  - PASS JLCPCB manufacturing preview blockers written
  - PASS ERC/DRC validation summary written

현재 경계
---------
Boundary: prototype-review, not order-ready.
이 preview는 네이티브 앱 shell, 로컬 런타임, 첫 채팅 미리보기 저장 흐름을 검증합니다.
아직 JLCPCB에 올리거나 주문할 수 있는 order-ready KiCad PCB 패키지가 아닙니다.
Gerber, Drill, 사람이 검토한 BOM/CPL 생성 전까지는 주문하지 마세요.

증거 파일
---------
- INSTALL-READY.txt: 설치 후 어디서 시작할지 알려주는 짧은 한국어 안내입니다.
- INSTALL-SELF-TEST.txt: 설치된 실행 파일의 self-test 결과입니다.
- INSTALL-FIRST-CHAT-SMOKE.txt: 첫 채팅 smoke test 결과입니다.
- RELEASE-EVIDENCE.txt: 패키지 source commit과 포함 파일을 기록합니다.
- SHA256SUMS.txt: 패키지 파일 hash를 기록합니다.

제거
----
시작 메뉴의 "Uninstall ChatPCB KiCad Preview"를 누르거나 설치 폴더의
"Uninstall ChatPCB KiCad Preview.cmd"를 실행합니다.
