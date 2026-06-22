# ChatPCB3

ChatPCB3 is the new native, installable ChatPCB direction. It targets a Windows
`ChatPCB KiCad` distribution built from a KiCad fork, a native wxWidgets
workspace, and a Rust core runtime.

This repository intentionally avoids browser, WebView, Electron, Tauri, HTTP,
and WebSocket UI surfaces for the v1 product shell.

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
  writes the prompt, artifact manifest, and prototype-review evidence report
  under `%LOCALAPPDATA%\ChatPCB3\Projects\chatpcb3-esp32s3-preview`.
- The left project status updates after `Send design`, so the design side and
  chat side both reflect the saved preview workspace.
- Clicking the left Schematic, PCB Layout, Validation, and Manufacturing
  Preview tabs updates the project status with that view's current preview
  state.
- The left design pane shows a native read-only preview body for each tab, so a
  first-run user sees schematic, layout, validation, and manufacturing context
  instead of a blank canvas.
- `Open evidence` opens the saved preview workspace folder from inside the app,
  including after relaunch when a previous preview workspace already exists.
- Pressing Enter in the prompt input sends the design through the same native
  path as the `Send design` button.
- On app launch, the starter prompt is focused and selected so a first-run user
  can type immediately, then press Enter.
- On app launch, the model selector checks local CLI availability and selects
  the first available provider model when one is found.
- KiCad fork source skeleton for a native `wxSplitterWindow` workspace with:
  - left 70 percent design pane
  - right 30 percent chat pane
  - Schematic, PCB Layout, Validation, and Manufacturing Preview tabs
  - Provider Login button and model selector
  - no `wxWebView`

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

The packaged installer does not require Rust or Cargo. It copies the native app
into `%LOCALAPPDATA%\ChatPCB3\ChatPCB KiCad Preview`, creates a desktop
shortcut plus Start Menu shortcuts, and starts the app.

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
selector, prompt input, `Use example`, `Send design` action, and pipeline status.
The left tabs also show a native preview body, not an empty placeholder. `Provider
Login` reports local CLI availability without storing provider credentials, and
it appends that status without erasing earlier chat turns. The model selector
also picks the first available local provider on launch, so a first-run user sees
a realistic model choice before pressing anything. `Use example` refills the
starter prompt after a send. On launch, the starter prompt is already selected,
so typing replaces it immediately. Pressing Enter in the prompt input or clicking
`Send design` appends the prompt and assistant response to the existing chat
transcript, so Provider Login context and earlier messages stay visible. The
transcript also moves to the latest response after updates. It also saves a local
preview workspace under:

```text
%LOCALAPPDATA%\ChatPCB3\Projects\chatpcb3-esp32s3-preview
```

That folder contains the prompt, artifact manifest, and a prototype-review
release evidence report. The left project status and preview body also change
to the saved workspace state. It is still not an order-ready KiCad board. Click
`Open evidence` in the app to open that folder without finding `%LOCALAPPDATA%`
by hand. After closing and reopening the app, `Open evidence` recovers the same
preview folder if it already exists, and the left project pane marks that
previous preview workspace before another send. See `docs/user-test-guide.md`
for the user-facing check.

Build a shareable preview package:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\package-preview.ps1
```

The zip is written under `dist\` and intentionally ignored by git.
It includes `README-FIRST.txt`, `RELEASE-EVIDENCE.txt`, and `SHA256SUMS.txt`
beside the two executables and installer scripts.

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
