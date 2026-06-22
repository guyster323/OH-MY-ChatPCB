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
3. Without clicking inside the app, type a short board request and press Enter.
   Confirm the text becomes a chat turn and the preview workspace is saved.
4. Reopen the app for the rest of the first-run checks if needed.
5. Confirm the left side is larger than the right side.
6. Confirm the left side shows these tabs:
   - Schematic
   - PCB Layout
   - Validation
   - Manufacturing Preview
7. Click each left tab and confirm the left project status and the large left
   preview body change for the schematic, PCB layout, validation, and
   manufacturing preview views.
8. Confirm the right side shows:
   - Chat transcript
   - prompt input
   - Use example
   - Send design
   - Open PCB
   - Open evidence
   - Provider Login
   - model selector
   - pipeline status
9. Confirm the model selector has already picked an available local provider if
   Codex, Claude Code, or Gemini CLI is installed.
10. Click `Provider Login`.
11. Confirm the chat transcript reports local CLI provider status for Codex,
   Claude Code, and Gemini CLI without erasing earlier chat turns. It should not
   ask for an API key.
   If a provider is available, the model selector should move to that provider.
   Without clicking the prompt box again, type a short test request and confirm
   it appears in the prompt input.
12. Click `Use example` if the prompt input is empty.
13. Type, edit, or keep a board prompt in the prompt input. After clicking
    `Use example`, pressing Enter should work without clicking back into the
    prompt box.
14. Press Enter in the prompt input, or click `Send design`.
15. Confirm the chat transcript still includes the earlier Provider Login
    status and also appends your prompt plus a preview pipeline:
   - ESP32-S3 target spec
   - JLCPCB package contract
   - schematic
   - placement
   - Freerouting autoroute
   - DRC
   - manufacturing package
16. Confirm the chat transcript says `Preview workspace saved`.
17. Confirm the chat transcript is positioned at the latest response after the
    send, so the new design result is visible without manually scrolling down.
18. Confirm the left project status and large left preview body now show
    `Preview workspace saved` instead of only the initial Schematic preview.
19. Confirm the chat transcript and large left preview body mention the
    `KiCad CLI check` and `kicad-pcb-check.txt`.
20. Confirm the chat transcript and large left preview body mention
    `KiCad ERC/DRC reports`, `erc-report.json`, `drc-report.json`, and
    `kicad-validation-summary.txt`.
21. Confirm the bottom pipeline status stays short and says
    `Validated: ERC/DRC clear. Next: Open PCB or Open evidence. Still prototype-review.`
    when local ERC/DRC reports are clear.
22. Click `Open PCB`.
23. Confirm KiCad opens `chatpcb3-esp32s3.kicad_pcb` and the board preview
    contains a 50mm x 50mm `Edge.Cuts` outline.
24. Click `Open evidence`.
25. Confirm Windows opens the preview evidence folder with
    `release-evidence-preview.md` selected.
26. Close and reopen `ChatPCB KiCad Preview`, then click `Open evidence` before
    sending another prompt.
27. Confirm the left project status says `Previous preview workspace found`
    before you send another prompt.
28. Confirm the chat transcript also says `Previous preview workspace found`
    and points you to `Open evidence` and `Open PCB`.
29. Confirm Windows opens the same previous preview evidence folder with the
    release evidence report selected.
30. Confirm the preview evidence folder exists:

```text
%LOCALAPPDATA%\ChatPCB3\Projects\chatpcb3-esp32s3-preview
```

Expected files:

- `prompt.txt`
- `artifact-manifest.json`
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

## Current Honest Boundary

This preview proves the native app shell and Rust runtime contract. It does not
yet prove final KiCad schematic quality, autorouted PCB quality, or JLCPCB
order readiness. The preview evidence folder is intentionally
`prototype-review`, not an order-ready manufacturing package.

The next implementation gate is to register the native workspace inside a real
KiCad latest-stable fork and connect `chatpcb-core.exe` to actual schematic,
layout, ERC/DRC, and manufacturing-package generation.
