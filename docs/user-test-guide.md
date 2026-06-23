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
- `INSTALL-SELF-TEST.txt` is written into the same folder with the installed
  executable's PASS summary, including
  `PASS Open PCB/evidence wait for a saved preview`.
- `INSTALL-FIRST-CHAT-SMOKE.txt` is written into the same folder with the
  installed executable's chat-to-preview smoke summary.
- `INSTALL-READY.txt` is written into the same folder with
  `Type a board idea in Chat prompt, then press Enter.` and the
  `prototype-review` boundary.
- `README-FIRST.txt` is copied beside the installed app for the first chat
  steps.
- A desktop shortcut named `ChatPCB KiCad Preview` is created.
- A Start Menu folder named `ChatPCB KiCad Preview` is created.
- The Start Menu folder includes `Run ChatPCB Self Test`.
- The Start Menu folder includes `Run First Chat Smoke Test`.
- The Start Menu folder includes `First Chat Guide`.
- Running `Run ChatPCB Self Test` prints a short PASS summary with
  `PASS Provider Login shows local CLI login hints` and
  `PASS model selector falls back to built-in preview` and
  `PASS app launch focuses the prompt for immediate first chat` and
  `PASS prompt input has a visible label and empty cue` and
  `PASS pressing Enter sends the first design` and
  `PASS empty prompt visibly uses the built-in ESP32-S3 example` and
  `PASS Send design returns focus for follow-up chat` and
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
   - Chat prompt label
   - prompt input
   - Use example
   - Send design
   - Open PCB
   - Open evidence
   - Provider Login
   - model selector
   - pipeline status
   Confirm `Open PCB` and `Open evidence` are disabled before the first preview
   is saved. Confirm `Open PCB` and `Open evidence` become enabled after
   `Send design` saves a preview or after a previous preview is recovered.
9. Confirm the model selector says `built-in-preview` when no local provider is
   ready, or has already picked an available local provider if Codex, Claude
   Code, or Gemini CLI is installed.
10. Click `Provider Login`.
11. Confirm the chat transcript reports local CLI provider status for Codex,
   Claude Code, and Gemini CLI without erasing earlier chat turns. It should not
   ask for an API key.
   If a provider is missing, confirm the transcript shows that provider's local
   CLI install/login hint and says to click `Provider Login` again after local
   CLI login.
   If a provider is available, the model selector should move to that provider.
   Without clicking the prompt box again, type a short test request and confirm
   it appears in the prompt input.
12. Click `Use example` if the prompt input is empty.
13. Type, edit, or keep a board prompt in the prompt input. After clicking
    `Use example`, pressing Enter should work without clicking back into the
    prompt box.
14. Press Enter in the prompt input, or click `Send design`.
    If the prompt is empty, confirm the chat transcript says no prompt was
    typed and that the built-in ESP32-S3 example was used.
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
18. Without clicking back inside the prompt box, type another short follow-up
    request and confirm it appears in the prompt input.
19. Confirm the left project status and large left preview body now show
    `Preview workspace saved` instead of only the initial Schematic preview.
20. Confirm the chat transcript and large left preview body mention the
    `KiCad CLI check` and `kicad-pcb-check.txt`.
21. Confirm the chat transcript and large left preview body mention
    `KiCad ERC/DRC reports`, `erc-report.json`, `drc-report.json`, and
    `kicad-validation-summary.txt`.
22. Confirm the chat transcript or large left preview body mentions
    `BEGINNER-NEXT-STEPS.txt`, `jlcpcb-bom-preview.csv`,
    `jlcpcb-cpl-preview.csv`, and `manufacturing-readiness-preview.txt`.
23. Confirm the bottom pipeline status stays short and says
    `Validated: Open PCB/evidence, or type a follow-up. Still prototype-review.`
    when local ERC/DRC reports are clear.
24. Click `Open PCB`.
25. Confirm the bottom status says either `Opened preview PCB in KiCad PCB
    Editor.` or `Opened preview PCB file. Install KiCad 10 if PCB Editor did
    not open.`
26. If KiCad 10 is installed, confirm KiCad opens `chatpcb3-esp32s3.kicad_pcb`
    and the board preview contains a 50mm x 50mm `Edge.Cuts` outline.
27. Click `Open evidence`.
28. Confirm Windows opens the preview evidence folder with
    `BEGINNER-NEXT-STEPS.txt` selected.
    Confirm the bottom status says
    `Opened BEGINNER-NEXT-STEPS.txt in evidence folder.`
    Confirm it says to click Open PCB, click Open evidence, ask a follow-up in
    chat, and not order yet.
29. Confirm the same folder still contains `FIRST-RUN-SUMMARY.txt`. Open it and
    confirm the summary says to return to the focused prompt, type a follow-up,
    and not upload this preview to JLCPCB.
30. Close and reopen `ChatPCB KiCad Preview`, then click `Open evidence` before
    sending another prompt.
31. Confirm the left project status says `Previous preview workspace found`
    before you send another prompt.
32. Confirm the chat transcript also says `Previous preview workspace found`
    and points you to `Open evidence` and `Open PCB`.
33. Confirm Windows opens the same previous preview evidence folder with the
    first-run summary selected.
34. Confirm the preview evidence folder exists:

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
  `Chat prompt` label, the prompt input, `Use example`, `Send design`,
  `Open PCB`, `Provider Login`, `Open evidence`, the model selector, and the
  bottom pipeline status.
- Computer Use also captured an accessibility text tree for the same window,
  including the Schematic / PCB Layout / Validation / Manufacturing Preview
  tabs, `Chat prompt` label, focused `Chat prompt` edit control, and the
  Provider Login / Open evidence / Open PCB controls.
- Computer Use typed
  `USB-C ESP32-S3 sensor board with I2C sensor and JLCPCB package`, pressed
  Enter, and verified the installed app reached
  `Validated: Open PCB/evidence, or type a follow-up. Still prototype-review.`
  with the prompt refocused.
- Computer Use verified the fresh first-chat view lists
  `jlcpcb-bom-preview.csv`, `jlcpcb-cpl-preview.csv`, and
  `manufacturing-readiness-preview.txt` in the native left preview pane.
- The empty prompt fallback was not proven through Computer Use. The prompt box
  is proven by Rust tests and installed self-test output; the latest Computer
  Use run instead proved a typed first-chat request.
- No fresh Computer Use proof was captured for the empty prompt transcript note.
  The empty-prompt behavior is currently proven by Rust tests and the installed
  self-test summary, not by a successful end-to-end UI input capture.
- Code and installed-package checks still passed: full Cargo tests, package
  self-test summary, package first-chat smoke test, installed exe self-test
  summary, installed first-chat smoke test, and GitHub replacement dry run.
- Do not treat the empty prompt fallback as fresh GUI control proof. Treat the
  latest Computer Use run as fresh proof that the installed native app launches,
  exposes a targetable window, and renders the expected first-run workspace.

## Current Honest Boundary

This preview proves the native app shell and Rust runtime contract. It does not
yet prove final KiCad schematic quality, autorouted PCB quality, or JLCPCB
order readiness. The preview evidence folder is intentionally
`prototype-review`, not an order-ready manufacturing package.

The next implementation gate is to register the native workspace inside a real
KiCad latest-stable fork and connect `chatpcb-core.exe` to actual schematic,
layout, ERC/DRC, and manufacturing-package generation.
