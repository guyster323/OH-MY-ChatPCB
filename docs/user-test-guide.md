# User Test Guide

This guide is written for a non-expert first run. The current app is a native
Windows preview of the planned ChatPCB KiCad experience. It is not the full
KiCad fork yet.

## Install

For a packaged first run:

1. Unzip `ChatPCB-KiCad-Preview-windows-x64.zip`.
2. Double-click `Install ChatPCB KiCad Preview.cmd`.

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
- A desktop shortcut named `ChatPCB KiCad Preview` is created.
- A Start Menu folder named `ChatPCB KiCad Preview` is created.
- The app starts automatically.

## First Run

1. Open `ChatPCB KiCad Preview` from the desktop shortcut.
2. Confirm the window title is `ChatPCB KiCad Preview`.
3. Confirm the left side is larger than the right side.
4. Confirm the left side shows these tabs:
   - Schematic
   - PCB Layout
   - Validation
   - Manufacturing Preview
5. Click each left tab and confirm the left project status changes for the
   schematic, PCB layout, validation, and manufacturing preview views.
6. Confirm the right side shows:
   - Chat transcript
   - prompt input
   - Use example
   - Send design
   - Open evidence
   - Provider Login
   - model selector
   - pipeline status
7. Click `Provider Login`.
8. Confirm the chat transcript reports local CLI provider status for Codex,
   Claude Code, and Gemini CLI. It should not ask for an API key.
   If a provider is available, the model selector should move to that provider.
9. Click `Use example` if the prompt input is empty.
10. Type, edit, or keep a board prompt in the prompt input.
11. Click `Send design`.
12. Confirm the chat transcript reflects your prompt and updates with a preview pipeline:
   - ESP32-S3 target spec
   - JLCPCB package contract
   - schematic
   - placement
   - Freerouting autoroute
   - DRC
   - manufacturing package
13. Confirm the chat transcript says `Preview workspace saved`.
14. Confirm the left project area now shows `Preview workspace saved` instead
    of only the initial Schematic preview status.
15. Click `Open evidence`.
16. Confirm Windows opens the preview evidence folder.
17. Confirm the preview evidence folder exists:

```text
%LOCALAPPDATA%\ChatPCB3\Projects\chatpcb3-esp32s3-preview
```

Expected files:

- `prompt.txt`
- `artifact-manifest.json`
- `release-evidence-preview.md`

## Current Honest Boundary

This preview proves the native app shell and Rust runtime contract. It does not
yet prove final KiCad schematic quality, autorouted PCB quality, or JLCPCB
order readiness. The preview evidence folder is intentionally
`prototype-review`, not an order-ready manufacturing package.

The next implementation gate is to register the native workspace inside a real
KiCad 10.0.4 fork and connect `chatpcb-core.exe` to actual KiCad project files.
