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
- KiCad fork source skeleton for a native `wxSplitterWindow` workspace with:
  - left 70 percent design pane
  - right 30 percent chat pane
  - Schematic, PCB Layout, Validation, and Manufacturing Preview tabs
  - Provider Login button and model selector
  - no `wxWebView`

Not implemented yet:

- Full KiCad fork rebased on KiCad 10.0.4 source.
- Real schematic and PCB canvas embedding in the new workspace.
- Actual KiCad file writing, DSN/SES import/export, Freerouting execution, or
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

For a packaged first run, unzip `ChatPCB-KiCad-Preview-windows-x64.zip` and
double-click:

```text
Install ChatPCB KiCad Preview.cmd
```

The packaged installer does not require Rust or Cargo. It copies the native app
into `%LOCALAPPDATA%\ChatPCB3\ChatPCB KiCad Preview`, creates a desktop
shortcut, and starts the app.

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
selector, prompt input, `Send design` action, and pipeline status. `Provider
Login` reports local CLI availability without storing provider credentials, and
`Send design` reflects the prompt text in the chat transcript. See
`docs/user-test-guide.md` for the user-facing check.

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
