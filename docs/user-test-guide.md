# User Test Guide

This guide is written for a non-expert first run. The current app is a native
Windows preview of the planned ChatPCB KiCad experience. It is not the full
KiCad fork yet.

## Install

For a packaged first run:

1. Unzip `ChatPCB-KiCad-Preview-windows-x64.zip`.
2. Double-click `Install ChatPCB KiCad Preview.cmd`.
   If ChatPCB KiCad Preview is already open, close it before running the installer again.

For a source-tree first run on a machine with Rust installed, double-click:

```text
Install ChatPCB KiCad Preview.cmd
```

The equivalent developer command is:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-local.ps1 -Launch
```

Expected result:

- `chatpcb-core.exe` is copied into `%LOCALAPPDATA%\ChatPCB3\ChatPCB KiCad Preview`.
- `ChatPCB KiCad Preview.exe` is copied into the same folder.
- `INSTALL-SELF-TEST.txt` is written into the same folder with the installed
  executable's PASS summary, including
  `PASS Open PCB/checklist wait for a saved preview`.
- `INSTALL-FIRST-CHAT-SMOKE.txt` is written into the same folder with the
  installed executable's chat-to-preview smoke summary.
- `INSTALL-READY.txt` is copied into the same folder with
  `만들 보드를 Chat prompt에 적고 Enter를 누릅니다.` and the
  `prototype-review` boundary.
- `README-FIRST.txt` is copied beside the installed app for the first chat
  steps.
- `README-FIRST-KO.txt` is copied beside the installed app for the Korean first
  chat steps.
- A desktop shortcut named `ChatPCB KiCad Preview` is created.
- A Start Menu folder named `ChatPCB KiCad Preview` is created.
- The Start Menu folder includes `Run ChatPCB Self Test`.
- The Start Menu folder includes `Run First Chat Smoke Test`.
- The Start Menu folder includes `Start Here`.
- The Start Menu folder includes `First Chat Guide`.
- The Start Menu folder includes `First Chat Guide Korean`.
- Running `Run ChatPCB Self Test` prints a short PASS summary with
  `PASS Provider Login shows local CLI login hints` and
  `PASS model selector falls back to built-in preview` and
  `PASS app launch focuses the prompt for immediate first chat` and
  `PASS prompt input has a visible label and empty cue` and
  `PASS pressing Enter sends the first design` and
  `PASS empty prompt visibly uses the built-in ESP32-S3 example` and
  `PASS Send design returns focus for follow-up chat` and
  `PASS provider/model selection is readiness-only for preview generation` and
  `PASS Use example selects prompt text for immediate overwrite` and
  `Boundary: prototype-review, not order-ready`.
- Running `Run First Chat Smoke Test` prints `ChatPCB First Chat Smoke Test`,
  `PASS preview workspace saved`,
  `PASS beginner next steps written`,
  `PASS KiCad compatibility report written`,
  `PASS ERC/DRC validation summary written`,
  `PASS JLCPCB manufacturing preview blockers written`, and
  `PASS first-run summary blocks JLCPCB upload`.
- The app starts automatically.

## First Run

1. Open `ChatPCB KiCad Preview` from the desktop shortcut.
2. Confirm the window title is `ChatPCB KiCad Preview`.
3. Confirm the first chat transcript says
   `바로 채팅: 만들 보드를 Chat prompt에 적고 Enter.` and the bottom status says
   `준비: 만들 보드 입력 후 Enter. 빈칸=ESP32-S3 예시.`
4. Without clicking inside the app, type a short board request and press Enter.
   Confirm the text becomes a chat turn and the preview workspace is saved.
5. Reopen the app for the rest of the first-run checks if needed.
6. Confirm the left side is larger than the right side.
7. Confirm the left side shows these tabs:
   - Schematic
   - PCB Layout
   - Validation
   - Manufacturing Preview
8. Click each left tab and confirm the left project status and the large left
   preview body change for the schematic, PCB layout, validation, and
   manufacturing preview views.
9. Confirm the right side shows:
   - Chat transcript
   - Chat prompt label
   - prompt input
   - 예시 사용
   - 설계 생성
   - PCB 열기
   - 검토 목록
   - Provider Login
   - model selector
   - pipeline status
   Confirm `PCB 열기` and `검토 목록` are disabled before the first preview is
   saved. Confirm `PCB 열기` and `검토 목록` become enabled after `설계 생성` saves
   a preview or after a previous preview is recovered.
10. Confirm the model selector says `built-in-preview` when no local provider is
   ready, or has already picked an available local provider if Codex, Claude
   Code, or Gemini CLI is installed.
11. Click `Provider Login`.
12. Confirm the chat transcript reports local CLI provider status for Codex,
   Claude Code, and Gemini CLI without erasing earlier chat turns. It should not
   ask for an API key.
   If a provider is missing, confirm the transcript shows that provider's local
   CLI install/login hint and says to click `Provider Login` again after local
   CLI login.
   If a provider is available, the model selector should move to that provider.
   Confirm the transcript says Provider/model 선택은 준비 상태 확인용:
   preview 생성은 built-in local generator를 사용하며 provider CLI는 호출하지 않습니다
   for this preview slice.
   Without clicking the prompt box again, type a short test request and confirm
   it appears in the prompt input.
13. Click `예시 사용` if the prompt input is empty.
14. Type, edit, or keep a board prompt in the prompt input. After clicking
    `예시 사용`, pressing Enter should work without clicking back into the
    prompt box.
15. Press Enter in the prompt input, or click `설계 생성`.
    If the prompt is empty, confirm the chat transcript says no prompt was
    typed and that the built-in ESP32-S3 example was used.
16. Confirm the chat transcript still includes the earlier Provider Login
    status and also appends your prompt plus a preview pipeline:
   - ESP32-S3 target spec
   - JLCPCB package contract
   - schematic
   - placement
   - Freerouting autoroute
   - DRC
   - manufacturing package
17. Confirm the chat transcript says `미리보기 저장 완료`.
18. Confirm the chat transcript is positioned at the latest response after the
    send, so the new design result is visible without manually scrolling down.
19. Without clicking back inside the prompt box, type another short follow-up
    request and confirm it appears in the prompt input.
20. Confirm the left project status and large left preview body now show
    `미리보기 저장 완료` and `order-ready 아님` instead of only the initial
    Schematic preview.
21. Confirm the chat transcript and large left preview body mention the
    `KiCad CLI check` and `kicad-pcb-check.txt`.
22. Confirm the chat transcript and large left preview body mention
    `KiCad ERC/DRC reports`, `erc-report.json`, `drc-report.json`, and
    `kicad-validation-summary.txt`.
23. Confirm the chat transcript or large left preview body mentions
    `BEGINNER-NEXT-STEPS.txt`, `jlcpcb-bom-preview.csv`,
    `jlcpcb-cpl-preview.csv`, and `manufacturing-readiness-preview.txt`.
24. Confirm the bottom pipeline status stays short and says
    `검증 완료: PCB 열기/검토 목록 또는 후속 입력. 아직 prototype-review.`
    when local ERC/DRC reports are clear.
25. Click `PCB 열기`.
26. Confirm the bottom status says either `KiCad PCB Editor에서 preview PCB를
    열었습니다.` or `preview PCB 파일을 열었습니다. PCB Editor가 열리지
    않았다면 KiCad 10을 설치하세요.`
27. If KiCad 10 is installed, confirm KiCad opens `chatpcb3-esp32s3.kicad_pcb`
    and the board preview contains a 50mm x 50mm `Edge.Cuts` outline.
28. Click `검토 목록`.
29. Confirm `검토 목록` opens the preview evidence folder with
    `BEGINNER-NEXT-STEPS.txt` selected.
    Confirm the bottom status says
    `검토 목록: BEGINNER-NEXT-STEPS.txt를 열었습니다.`
    Confirm it says to click PCB 열기, click 검토 목록, ask a follow-up in
    chat, and not order yet.
30. Confirm the same folder still contains `FIRST-RUN-SUMMARY.txt`. Open it and
    confirm the summary says to return to the focused prompt, type a follow-up,
    and not upload this preview to JLCPCB.
31. Close and reopen `ChatPCB KiCad Preview`, then click `검토 목록` before
    sending another prompt.
32. Confirm the left project status says `이전 미리보기 발견`
    before you send another prompt.
33. Confirm the chat transcript also says `이전 미리보기 발견`, keeps
    `order-ready 아님` visible, and points you to `검토 목록` and `PCB 열기`.
34. Confirm the short bottom status says
    `이전 미리보기: 이어서 입력 후 Enter. PCB 열기/검토 목록.`
    instead of a long local path.
35. Confirm Windows opens the same previous preview evidence folder with the
    first-run summary selected.
36. Confirm the preview evidence folder exists:

```text
%LOCALAPPDATA%\ChatPCB3\Projects\chatpcb3-esp32s3-preview
```

Expected files:

- `prompt.txt`
- `artifact-manifest.json`
- `FIRST-RUN-SUMMARY.txt`
- `BEGINNER-NEXT-STEPS.txt`
- `jlcpcb-bom-preview.csv`
- `jlcpcb-cpl-preview.csv`
- `manufacturing-readiness-preview.txt`
- `release-evidence-preview.md`
- `kicad-pcb-check.txt`
- `erc-report.json`
- `drc-report.json`
- `kicad-validation-summary.txt`
- `chatpcb3-esp32s3.kicad_pro`
- `chatpcb3-esp32s3.kicad_sch`
- `chatpcb3-esp32s3.kicad_pcb`
- `sym-lib-table`
- `fp-lib-table`

## Computer Use Verification Status

Latest run after installing the current preview package was checked on
2026-06-24.

- Computer Use found the installed `ChatPCB KiCad Preview` app entry.
- Computer Use launched the installed app from
  `%LOCALAPPDATA%\ChatPCB3\ChatPCB KiCad Preview\ChatPCB KiCad Preview.exe`.
- Computer Use listed one targetable `ChatPCB KiCad Preview` window with title
  `ChatPCB KiCad Preview`.
- Computer Use captured a screenshot of the native 70/30 workspace. The capture
  showed the left current-project preview pane, the right chat pane, the
  `Chat prompt` label, the prompt input, `예시 사용`, `설계 생성`,
  `PCB 열기`, `Provider Login`, `검토 목록`, the model selector, and the
  bottom pipeline status.
- Computer Use verified the first transcript now shows
  `바로 채팅: 만들 보드를 Chat prompt에 적고 Enter.` and the bottom status uses
  the short first-action cue
  `준비: 만들 보드 입력 후 Enter. 빈칸=ESP32-S3 예시.` when no recovered
  action has replaced it.
- Computer Use also captured an accessibility text tree for the same window,
  including the Schematic / PCB Layout / Validation / Manufacturing Preview
  tabs, `Chat prompt` label, focused `Chat prompt` edit control, and the
  Provider Login / 검토 목록 / PCB 열기 controls.
- Computer Use verified the recovered preview launch status. The bottom status
  showed
  `이전 미리보기: 이어서 입력 후 Enter. PCB 열기/검토 목록.`, not
  the long preview folder path, and it was not hidden by automatic provider detection.
- Computer Use rechecked the installed package after the recovered-status copy
  change and confirmed the same short Korean follow-up cue was visible in the
  bottom status with `Chat prompt` focused.
- Computer Use verified the selected launch prompt now starts with
  `USB-C ESP32-S3 온습도 센서 보드, I2C 센서, JLCPCB` in the native prompt input,
  keeping the manufacturing keywords while making the example Korean-first.
- Computer Use then clicked `Provider Login` and verified that provider status
  still appears after the explicit click, with focus returned to `Chat prompt`.
- Computer Use verified the Provider Login status now says
  `Provider 감지: claude:auto; preview 생성은 아직 로컬입니다.` and that the
  Provider Login transcript explains `Provider/model 선택은 준비 상태 확인용`,
  `built-in local generator`, and `provider CLI는 호출하지 않습니다`.
- Computer Use reinstalled the current package after the first-screen/provider copy localization
  and verified the recovered launch transcript starts with `ChatPCB KiCad Preview`,
  `바로 채팅: 만들 보드를 Chat prompt에 적고 Enter.`, and
  `Provider Login은 선택 사항입니다. built-in-preview로 prototype-review 증거를 만들며 JLCPCB order-ready 파일은 아닙니다.`.
- Computer Use clicked `Provider Login` in that installed app and verified the
  bottom status still says
  `Provider 감지: claude:auto; preview 생성은 아직 로컬입니다.`. The Provider
  Login transcript included `Provider/model 선택은 준비 상태 확인용`,
  `built-in local generator`, and `provider CLI는 호출하지 않습니다`, while the
  accessibility text did not include old English provider copy.
- Computer Use reinstalled the package after the Korean-first INSTALL-READY template change.
  The installed `%LOCALAPPDATA%\ChatPCB3\ChatPCB KiCad Preview\INSTALL-READY.txt`
  now starts with `ChatPCB KiCad Preview 설치 완료` and includes
  `만들 보드를 Chat prompt에 적고 Enter를 누릅니다.` with the
  `prototype-review, not order-ready` boundary.
- Computer Use relaunched the installed app and verified `Chat prompt` was focused,
  the recovered status still said
  `이전 미리보기: 이어서 입력 후 Enter. PCB 열기/검토 목록.`, and the native
  70/30 workspace still exposed `예시 사용`, `설계 생성`, `PCB 열기`,
  `Provider Login`, `검토 목록`, and the model selector.
- Computer Use reinstalled the package after the primary action button localization
  and verified the native buttons show `예시 사용`, `설계 생성`, `PCB 열기`, `Provider Login`, `검토 목록`.
  Later status-copy localization removed the old `Open PCB` and `Review checklist`
  strings from the next-action status text as well as the button labels.
- Computer Use typed `ESP32-S3 조도 센서 보드`, pressed Enter, and verified the
  installed app again reached
  `검증 완료: PCB 열기/검토 목록 또는 후속 입력. 아직 prototype-review.`
  with focus returned to `Chat prompt`.
- Computer Use reinstalled the current package, typed
  `ESP32-S3 가속도 센서 보드`, pressed Enter, and verified the latest visible
  chat result now ends with the Korean next-action summary:
  `결과: 미리보기 저장 완료`, `PCB 열기 또는 검토 목록으로 확인하세요.`,
  and `아직 JLCPCB 주문 금지: prototype-review 상태입니다.`
- Computer Use reinstalled the current package again, typed
  `ESP32-S3 자이로 센서 보드`, pressed Enter, and verified the bottom status now
  says `검증 완료: PCB 열기/검토 목록 또는 후속 입력. 아직 prototype-review.`
  with focus returned to `Chat prompt`.
- Computer Use verified the fresh first-chat view lists
  `jlcpcb-bom-preview.csv`, `jlcpcb-cpl-preview.csv`, and
  `manufacturing-readiness-preview.txt` in the native left preview pane.
- Computer Use also verified the empty prompt fallback. It selected the prompt,
  cleared it, pressed Enter, and the bottom pipeline status showed
  `내장 예시 사용.` before the validation status.
- Computer Use rechecked the empty prompt fallback after the Korean status
  update and verified the full bottom status:
  `내장 예시 사용. 검증 완료: PCB 열기/검토 목록. 아직 prototype-review.`
- Computer Use reinstalled the current package after the first-response localization
  and verified that the visible chat turn now uses `Assistant: 결과 요약`,
  `ESP32-S3 기본 보드 사양`, and `다음 행동`, with no old
  `Assistant: What happened` heading or `Full KiCad fork integration` sentence.
  This is the current proof of no old `Assistant: What happened` heading.
- Computer Use also typed `ESP32-S3 light sensor board`, waited briefly, pressed
  Enter, and verified the installed app cleared the prompt, returned focus to
  `Chat prompt`, and kept the bottom status at
  `검증 완료: PCB 열기/검토 목록 또는 후속 입력. 아직 prototype-review.`
- Computer Use reinstalled the current package after the saved/recovered copy localization
  and verified the recovered launch now shows `이전 미리보기 발견` and
  `order-ready 아님`, with no old `Previous preview workspace found` heading.
- Computer Use then sent `ESP32-S3 proximity sensor board` and verified the
  saved preview state shows `미리보기 저장 완료`, keeps `order-ready 아님`,
  clears the prompt, returns focus to `Chat prompt`, and has no old
  `Preview workspace saved` heading.
  This is the current proof of no old `Preview workspace saved` heading.
- Computer Use reinstalled and relaunched the package after the status-copy localization.
  The installed app opened with `Chat prompt` focused, exposed `예시 사용`,
  `설계 생성`, `PCB 열기`, `Provider Login`, and `검토 목록`, and showed
  `이전 미리보기: 이어서 입력 후 Enter. PCB 열기/검토 목록.` for the recovered
  preview state.
- Computer Use then typed `ESP32-S3 압력 센서 보드`, pressed Enter, and verified
  the bottom status reached
  `검증 완료: PCB 열기/검토 목록 또는 후속 입력. 아직 prototype-review.`
  with focus returned to `Chat prompt`; the accessibility text had no old `Open PCB/checklist`, `Open PCB/Review checklist`, `Recovered:`, or `Ready:` status text.
- Code and installed-package checks still passed: full Cargo tests, package
  self-test summary, package first-chat smoke test, installed exe self-test
  summary, installed first-chat smoke test, and GitHub replacement dry run.
- Treat the latest Computer Use run as fresh proof that the installed native app
  launches, exposes a targetable window, renders the expected first-run
  workspace, accepts a typed first-chat request, and handles an empty prompt
  through the visible built-in example fallback.

## Current Honest Boundary

This preview proves the native app shell and Rust runtime contract. It does not
yet prove final KiCad schematic quality, autorouted PCB quality, or JLCPCB
order readiness. The preview evidence folder is intentionally
`prototype-review`, not an order-ready manufacturing package.

The next implementation gate is to register the native workspace inside a real
KiCad latest-stable fork and connect `chatpcb-core.exe` to actual schematic,
layout, ERC/DRC, and manufacturing-package generation.
