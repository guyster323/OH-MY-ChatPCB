# User Test Guide

This guide is written for a non-expert first run. The current app is a native
Windows preview of the planned ChatPCB KiCad experience. It is not the full
KiCad fork yet.

## Install

From the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-local.ps1
```

Expected result:

- `chatpcb-core.exe` is copied into `%LOCALAPPDATA%\ChatPCB3\ChatPCB KiCad Preview`.
- `ChatPCB KiCad Preview.exe` is copied into the same folder.
- A desktop shortcut named `ChatPCB KiCad Preview` is created.

## First Run

1. Open `ChatPCB KiCad Preview` from the desktop shortcut.
2. Confirm the window title is `ChatPCB KiCad Preview`.
3. Confirm the left side is larger than the right side.
4. Confirm the left side shows these tabs:
   - Schematic
   - PCB Layout
   - Validation
   - Manufacturing Preview
5. Confirm the right side shows:
   - Chat transcript
   - prompt input
   - Send design
   - Provider Login
   - model selector
   - pipeline status
6. Click `Provider Login`.
7. Confirm the chat transcript reports local CLI provider status for Codex,
   Claude Code, and Gemini CLI. It should not ask for an API key.
8. Type or keep a board prompt in the prompt input.
9. Click `Send design`.
10. Confirm the chat transcript reflects your prompt and updates with a preview pipeline:
   - ESP32-S3 target spec
   - JLCPCB package contract
   - schematic
   - placement
   - Freerouting autoroute
   - DRC
   - manufacturing package

## Current Honest Boundary

This preview proves the native app shell and Rust runtime contract. It does not
yet prove final KiCad schematic quality, autorouted PCB quality, or JLCPCB
order readiness.

The next implementation gate is to register the native workspace inside a real
KiCad 10.0.4 fork and connect `chatpcb-core.exe` to actual KiCad project files.
