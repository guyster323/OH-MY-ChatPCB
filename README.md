# ChatPCB3

ChatPCB3 is the new native, installable ChatPCB direction. It targets a Windows
`ChatPCB KiCad` distribution built from a KiCad fork, a native wxWidgets
workspace, and a Rust core runtime.

This repository intentionally avoids browser, WebView, Electron, Tauri, HTTP,
and WebSocket UI surfaces for the v1 product shell.

## Start Here

For a non-expert first run from GitHub:

1. Download `ChatPCB-KiCad-Preview-windows-x64.zip` from the latest release or
   workflow artifact.
2. Unzip it. Double-click `Install ChatPCB KiCad Preview.cmd`.
   If ChatPCB KiCad Preview is already open, close it before running the installer again.
3. Open `ChatPCB KiCad Preview`.
4. 만들 보드를 `채팅 입력칸`에 적고 Enter를 누릅니다.
5. 저장되면 `검토 목록`을 눌러 확인합니다.

The first chat transcript also shows
`바로 채팅: 만들 보드를 채팅 입력칸에 적고 Enter.`, and the bottom status says
`준비: 만들 보드 입력 후 Enter. 빈칸=ESP32-S3 예시.`

Boundary: `prototype-review`, not order-ready. Do not upload this preview to JLCPCB.
Korean first-run users can open `README-FIRST-KO.txt` from the unzipped package
or installed app folder for the same first-chat path.

## Current Status

Implemented in this first vertical slice:

- Rust `chatpcb-core` library with the v1 public contracts:
  - provider CLI status catalog for Codex, Claude Code, and Gemini CLI
  - fixed ESP32-S3 USB-C sensor board specification
  - JLCPCB-oriented manufacturing package contract
  - KiCad ERC/DRC JSON report parsing
  - approval-gated patch proposal application
  - release gate evaluation for `blocked`, `prototype-review`, and
    `order-ready-evidence`
- `chatpcb-core.exe` stdio JSONL runtime entrypoint for KiCad child-process
  integration.
- First-run preview workspace creation when `Send design` is clicked. The app
  writes the prompt, artifact manifest, first-run summary, and prototype-review
  evidence report under
  `%LOCALAPPDATA%\ChatPCB3\Projects\chatpcb3-esp32s3-preview`.
- The left project status updates after `Send design`, so the design side and
  chat side both reflect the saved preview workspace without filling the status
  line with a local path. The saved preview bottom status says
  `미리보기 저장 완료 | 검토 목록에서 저장 위치 확인 | prototype-review, order-ready 아님.`.
- Clicking the left `회로도`, `PCB 레이아웃`, `검증`, and `제조 미리보기`
  tabs updates the project status with that view's current preview state while
  keeping saved file paths in `검토 목록` and the chat transcript.
- The left design pane shows a native read-only preview body for each tab, so a
  first-run user sees schematic, layout, validation, and manufacturing context
  instead of a blank canvas.
- `검토 목록` opens the saved preview workspace folder from inside the app
  with `BEGINNER-NEXT-STEPS.txt` selected for first-run users. The same folder
  still contains `FIRST-RUN-SUMMARY.txt` and the release evidence report,
  including after relaunch when a previous preview workspace already exists.
- `PCB 열기` opens the generated `chatpcb3-esp32s3.kicad_pcb` preview with KiCad
  10's PCB Editor when it is installed; otherwise it falls back to the Windows
  file association and tells the user to install KiCad 10 if PCB Editor did not
  open.
- After `Send design`, the app runs a local KiCad CLI compatibility check when
  KiCad 10 is installed and writes `kicad-pcb-check.txt` beside the preview
  files.
- The same `Send design` path now asks KiCad CLI to run schematic ERC and PCB
  DRC in JSON mode when available, then writes `erc-report.json`,
  `drc-report.json`, and `kicad-validation-summary.txt` beside the preview
  files.
- The first-run preview workspace also writes JLCPCB review-only manufacturing
  preview files: `jlcpcb-bom-preview.csv`, `jlcpcb-cpl-preview.csv`, and
  `manufacturing-readiness-preview.txt`. The readiness report blocks upload and
  keeps the package at `prototype-review`, not order-ready.
- After local ERC/DRC reports are clear, the bottom pipeline status stays short
  and points the user to `PCB 열기` or `검토 목록` instead of truncating the
  full report summary.
- Pressing Enter in the prompt input sends the design through the same native
  path as the `Send design` button.
- After `Send design`, the prompt is cleared and focus returns to the prompt so
  a follow-up chat can be typed immediately.
- On app launch, the starter prompt is focused and selected so a first-run user
  can type immediately, then press Enter.
- On app launch, the model selector shows `built-in-preview` when no local CLI
  provider is ready, then selects the first available provider model when one is
  found.
- KiCad fork source skeleton for a native `wxSplitterWindow` workspace with:
  - left 70 percent design pane
  - right 30 percent chat pane
  - `회로도`, `PCB 레이아웃`, `검증`, and `제조 미리보기` tabs
  - Provider Login button and model selector
  - no `wxWebView`
- KiCad fork drop-in source now includes a `chatpcb_native_workspace` CMake drop-in target
  and a stdio `chatpcb-core.exe` bridge skeleton. This is the next integration
  unit for a real KiCad source tree, not the full KiCad fork.

Not implemented yet:

- Full KiCad fork rebased on KiCad 10.0.4 source.
- Real schematic and PCB canvas embedding in the new workspace.
- Order-ready KiCad file writing, DSN/SES import/export, Freerouting execution, or
  Gerber generation.
- Signed MSI/NSIS-style installer packaging. The current preview has a
  double-click zip installer.
- Live provider invocation. The first slice only detects local CLI availability
  and defines the transport contract.

## Verified External Baseline

Checked on 2026-06-22:

- KiCad Windows stable release: `10.0.4`.
- Freerouting latest release observed: `v2.2.4`.
- JLCPCB assembly package requires Gerber, BOM, and CPL / pick-and-place files.
- JLCPCB KiCad 10 guide describes production output containing Gerber zip,
  `bom.csv`, and `positions.csv`.

## Development

```powershell
cargo test
cargo build
```

## Non-Expert Preview Install

For the easiest first run after GitHub is published, open the latest GitHub
Release and download:

```text
ChatPCB-KiCad-Preview-windows-x64.zip
```

Unzip it and double-click:

```text
Install ChatPCB KiCad Preview.cmd
```

If ChatPCB KiCad Preview is already open, close it before running the installer again.

The packaged installer does not require Rust or Cargo. It copies the native app
into `%LOCALAPPDATA%\ChatPCB3\ChatPCB KiCad Preview`, creates a desktop
shortcut plus Start Menu shortcuts, adds a `First Chat Guide` Start Menu
shortcut, adds a `First Chat Guide Korean` Start Menu shortcut for
`README-FIRST-KO.txt`, adds a `Start Here` shortcut to the install-ready note,
adds a `Run First Chat Smoke Test` shortcut, writes
`INSTALL-SELF-TEST.txt` with the installed executable's PASS summary, writes
`INSTALL-FIRST-CHAT-SMOKE.txt` with the chat-to-preview smoke result, copies
`INSTALL-READY.txt` with `만들 보드를 채팅 입력칸에 적고 Enter를 누릅니다.`,
copies `README-FIRST.txt` and `README-FIRST-KO.txt` beside the installed app,
and starts the app.
For this preview, Provider 선택은 로그인 상태 확인용입니다. 미리보기 생성은
앱 안의 기본 생성기를 사용하며 Codex, Claude Code, Gemini 로컬 도구를 대신
실행하지 않습니다.

For a source-tree first run on a machine with Rust installed, double-click:

```text
Install ChatPCB KiCad Preview.cmd
```

Or run the same install path manually:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-local.ps1 -Launch
```

Then open `ChatPCB KiCad Preview` from the desktop shortcut. The preview is a
native Windows app with the target 70/30 workspace, Provider Login button, model
selector, prompt input, `예시 사용`, `설계 생성`, `PCB 열기`, and pipeline status.
`PCB 열기` and `검토 목록` stay disabled until a preview workspace exists,
then become enabled after `설계 생성` saves the preview or after a previous
preview is recovered. The left tabs also show a native preview body, not an
empty placeholder. `Provider
Login` reports local CLI availability without storing provider credentials, and
it appends that status without erasing earlier chat turns. If no local provider
is ready yet, the model selector stays on `built-in-preview` and Provider Login
says the built-in preview can still be created, so a first-run user is not
blocked before pressing `설계 생성`. It also shows the local CLI install/login
hint for each missing provider and tells the user to click `Provider Login`
again after completing local CLI login. The model selector also picks the first
available local provider on launch, so a first-run user sees a realistic model
choice before pressing anything when a CLI is available. That provider/model
selection is readiness-only for this slice; Provider 선택은 로그인 상태 확인용이고
`설계 생성`의 미리보기 생성은 앱 안의 기본 생성기를 사용하며 Codex, Claude Code,
Gemini 로컬 도구를 대신 실행하지 않습니다. `예시 사용` refills the starter prompt after a send. Both
`Provider Login` and `예시 사용` return focus to the prompt, so the next typed request or Enter key works
without another click. On launch, the starter prompt is already selected, so
typing replaces it immediately. Pressing Enter in the prompt input or clicking
`설계 생성` appends the prompt and assistant response to the existing chat
transcript, so Provider Login context and earlier messages stay visible. The
transcript also moves to the latest response after updates, clears the prompt,
and returns focus to the prompt so a follow-up chat can be typed immediately.
It also saves a local preview workspace under:

```text
%LOCALAPPDATA%\ChatPCB3\Projects\chatpcb3-esp32s3-preview
```

That folder contains the prompt, artifact manifest, `FIRST-RUN-SUMMARY.txt`,
`BEGINNER-NEXT-STEPS.txt`, `jlcpcb-bom-preview.csv`,
`jlcpcb-cpl-preview.csv`, `manufacturing-readiness-preview.txt`, and a
prototype-review release evidence report. The first-run summary points a
non-expert back to the focused prompt for follow-up chat and says not to upload
the preview to JLCPCB. The beginner next-steps file spells out the first
clicks: PCB 열기, 검토 목록, then ask a follow-up in chat while Gerber,
drill, and placement-reviewed JLCPCB files remain blocked. The BOM/CPL preview
files are for review only. It also contains the generated KiCad preview
scaffold:
`chatpcb3-esp32s3.kicad_pro`, `chatpcb3-esp32s3.kicad_sch`,
`chatpcb3-esp32s3.kicad_pcb`, `sym-lib-table`, and `fp-lib-table`. The left
project status and preview body also change to the saved workspace state. When
KiCad 10 is installed locally, `설계 생성` also runs `kicad-cli.exe pcb
upgrade` as a compatibility check and saves `kicad-pcb-check.txt` in the same
folder. It also runs KiCad CLI ERC/DRC JSON checks and saves
`erc-report.json`, `drc-report.json`, and `kicad-validation-summary.txt`. When
those local reports are clear, the bottom pipeline status says
`검증 완료: PCB 열기/검토 목록 또는 후속 입력. 아직 prototype-review.`
The JLCPCB preview blocker report is saved as
`manufacturing-readiness-preview.txt` and says not to upload this preview to
JLCPCB.
It is still not an order-ready KiCad board. Click
`PCB 열기` to inspect `chatpcb3-esp32s3.kicad_pcb` in KiCad 10's PCB Editor and
see the 50mm x 50mm `Edge.Cuts` preview outline. If KiCad 10 is not installed,
the app opens the PCB file through Windows and says to install KiCad 10 if PCB
Editor did not open. Click `검토 목록` in the app to open that
folder without finding `%LOCALAPPDATA%` by hand; when the beginner checklist
exists, Windows opens the folder with `BEGINNER-NEXT-STEPS.txt` selected. The
same folder still contains `FIRST-RUN-SUMMARY.txt` for the prototype-review
boundary and `release-evidence-preview.md` for saved evidence. The bottom status
says `검토 목록을 열었습니다.` so a first-run user gets a short confirmation
without another file-name dump.
After closing and reopening the app,
`검토 목록` recovers the same preview folder if it already exists, and the
left project pane marks that previous preview workspace before another send. The
chat transcript also
mentions that recovered workspace, so a returning user can continue from the
right pane without guessing what happened. The short bottom status says
`이전 미리보기: 이어서 입력 후 Enter. PCB 열기/검토 목록.` instead
of filling the status line with a long local path. See `docs/user-test-guide.md`
for the user-facing check.

Build a shareable preview package:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\package-preview.ps1
```

The zip is written under `dist\` and intentionally ignored by git.
It includes `README-FIRST.txt`, `README-FIRST-KO.txt`, `RELEASE-EVIDENCE.txt`,
`SHA256SUMS.txt`, and `Run ChatPCB Self Test.cmd` beside the two executables and
installer scripts.
Both the packaged installer and source-tree installer add Start Menu shortcuts
for the app, `Start Here`, `First Chat Guide`, self-test, and
`First Chat Guide Korean`, and `Run First Chat Smoke Test`. A
first-run user can verify the installed executable contract with a short PASS
summary. That summary also
verifies the first-run evidence points back to follow-up chat, blocks JLCPCB
upload for this preview, keeps the model selector on `built-in-preview` when no
provider is ready, and prints these first-chat PASS lines:

```text
PASS app launch focuses the prompt for immediate first chat
PASS prompt input has a visible label and empty cue
PASS pressing Enter sends the first design
PASS empty prompt visibly uses the built-in ESP32-S3 example
PASS Send design returns focus for follow-up chat
PASS provider/model selection is readiness-only for preview generation
PASS Use example selects prompt text for immediate overwrite
```

The installers also write the same first-run confidence check to
`%LOCALAPPDATA%\ChatPCB3\ChatPCB KiCad Preview\INSTALL-SELF-TEST.txt`.
They also run `ChatPCB KiCad Preview.exe --first-chat-smoke` and write
`%LOCALAPPDATA%\ChatPCB3\ChatPCB KiCad Preview\INSTALL-FIRST-CHAT-SMOKE.txt`,
which proves the installed app can turn the starter chat prompt into a saved
prototype-review preview workspace without provider login. The smoke summary
also prints `PASS beginner next steps written`,
`PASS JLCPCB manufacturing preview blockers written`,
`PASS KiCad compatibility report written`, and
`PASS ERC/DRC validation summary written`, so a non-expert has local validation
evidence and a next-action checklist before opening the full app. The saved
preview workspace includes `BEGINNER-NEXT-STEPS.txt`,
`jlcpcb-bom-preview.csv`, `jlcpcb-cpl-preview.csv`, and
`manufacturing-readiness-preview.txt`.
The installed folder also includes `INSTALL-READY.txt`, a Korean-first one-screen
start summary that says `만들 보드를 채팅 입력칸에 적고 Enter를 누릅니다.` and points
back to the install self-test and first-chat smoke files.

After this repository is pushed to GitHub, the `Build ChatPCB KiCad Preview`
workflow also uploads the same zip as an Actions artifact named
`ChatPCB-KiCad-Preview-windows-x64`.
For a direct public download page, create a tag such as `preview-0.1.0`; the
`Release ChatPCB KiCad Preview` workflow publishes the zip to GitHub Releases.
Before replacing the failed `guyster323/OH-MY-ChatPCB` remote history, run
`scripts\verify-github-replacement-ready.ps1` and follow
`docs\github-replacement-runbook.md`. The script is a dry run and never pushes;
the actual GitHub replacement still requires explicit action-time approval.

Run the core manually:

```powershell
cargo run -p chatpcb-core --bin chatpcb-core
```

Then send one JSON line:

```json
{"id":"route-1","method":"layout.autoroute","params":{}}
```

The binary answers with one JSON line suitable for a KiCad child-process bridge.

## KiCad Fork Drop-In

The native workspace skeleton lives in:

```text
kicad-fork/plugins/chatpcb_native_workspace/
```

The intended KiCad integration is to add this panel to the forked KiCad
workspace frame, then bind its chat actions to `chatpcb-core.exe` over stdio.
The source is deliberately wxWidgets-only and should stay free of WebView or
browser dependencies.
