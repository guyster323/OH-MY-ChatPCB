# OH-MY-ChatPCB

OH-MY-ChatPCB is an open-source ChatPCB prototype for making KiCad agent-native.

The current implementation is the first runnable foundation of the proposed plan:

- local `chatpcb` CLI for MCU peripheral project generation, ERC validation, and SPICE simulation hooks
- `chatpcb-agentd` local daemon with `/health`, `/tool`, and `/ws`
- WebView-ready right panel bundle under `apps/panel`
- KiCad fork C++ skeleton for a `wxWebView` side panel under `kicad-fork/chatpcb_panel`
- provider process bridge for local CLI agents such as Codex, Claude Code, and Copilot CLI

## Status

This is not a full KiCad fork yet. It is the implementation scaffold that lets the fork work proceed without guessing about runtime contracts.

Implemented now:

- Natural-language MCU peripheral prompt normalization
- Reviewable KiCad project draft generation with embedded ChatPCB fixture symbols, wire stubs, net labels, and footprint mappings
- Project-local `ChatPCB` symbol library generation through `chatpcb.kicad_sym` and `sym-lib-table`
- KiCad-compatible metadata using normal schematic objects and `.chatpcb.json`, not custom top-level `chatpcb_*` nodes
- ERC report parsing that fails validation on KiCad `error` severity while surfacing warning-only reports
- Daemon startup now reports the actual bound port and rejects port collisions, so UI verification can reuse an already-running `chatpcb-agentd`
- Approval-gated `schematic.patch` preview/apply workflow with diff output, cancel handling, validation, and rollback
- Provider registry and status checks for Codex CLI, Claude Code, and GitHub Copilot CLI
- Strict local provider transcript parsing that accepts provider `tool.call` JSON only, redacts stderr secrets, and can write redacted trace files
- Panel provider selector connected to daemon `provider.status`
- Provider chat invocation from the panel, verified with an injected fake provider in `npm run verify:ui`
- Process-level provider cancellation through `AbortSignal`, daemon-level `provider.cancel`, and the panel Stop button
- Real Codex CLI provider smoke from panel chat without test injection
- Source-level KiCad fork schematic editor integration for `CHATPCB_PANEL`
- SPICE fixture generation for simple analog support circuits
- Local daemon and WebView websocket surface
- Windows KiCad CLI discovery including `C:/Program Files/KiCad/10.0` and `9.0`

Not implemented yet:

- Production-grade schematic symbols beyond the constrained MCU peripheral fixture set
- PCB layout generation
- Built KiCad fork binary with visible ChatPCB side panel
- Full SPICE model selection for MCU vendor parts

## Quick Start

```powershell
npm install
npm test
npm run verify:sample
npm run verify:panel
npm run verify:ui
npm run daemon
```

Open `apps/panel/index.html` in a WebView or browser while `npm run daemon` is running.

## User Test Guide

Use this flow to create a named KiCad project from a Korean or English request.

1. Start in the repository root:

```powershell
cd C:\path\to\OH-MY-ChatPCB
```

2. Install dependencies and run the full local verification:

```powershell
npm install
npm test
npm run verify:sample
npm run verify:panel
npm run verify:ui
```

Expected result:

- all Node tests pass
- sample generation writes files under `workspaces/sample-mcu`
- KiCad validation passes cleanly when `kicad-cli` is available; the generated project includes its own `ChatPCB` symbol library, so the sample ERC has `0` errors and `0` warnings
- KiCad SVG export can render the generated sample schematic for visual review
- simulation returns success or the typed `NGSPICE_UNAVAILABLE` skip when `ngspice` is not installed
- panel verification starts `chatpcb-agentd`, creates a Korean-named project over WebSocket, sends a Korean `project.request`, and verifies the generated `.kicad_pro`, ERC, readiness review, and dirty-editor conflict contract
- browser UI verification opens the real panel, creates a named project, presses **Send**, checks the independent request/ERC/review/KiCad-link cards, and confirms that a dirty host blocks the request without asking KiCad to reload

3. Start the local daemon:

```powershell
npm run daemon
```

Keep this terminal running. The daemon owns the local websocket endpoint used by the panel.

4. In another browser window, open:

```text
C:\path\to\OH-MY-ChatPCB\apps\panel\index.html
```

You can also use the same panel from a ChatPCB-enabled KiCad fork. An official KiCad build does not provide the host bridge, so the standalone panel reports the project path for you to open manually.

5. Enter a project name such as `가스 센서 보드 01` and click **New project**. The panel creates a safe project directory under the selected workspace root and shows it as the active project.

6. Enter a Korean or English circuit request, then press **Send**. For example:

```text
ESP32-S3와 가스 센서를 연결하고 3.3V 전원을 사용하는 회로를 만들어줘.
```

Expected result:

- the panel connects to `chatpcb-agentd`
- pressing **Send** runs one `project.request` against the active project and reports whether it generated or updated the project
- request status, ERC results, readiness review, generated artifacts, and KiCad link state appear in independent cards
- the artifacts include a normal `.kicad_pro` file; use **Open in KiCad** in the fork panel, or open that path manually from standalone browser mode
- if the active KiCad editor has unsaved changes, the panel shows a conflict and refuses the automatic request/reload path until you save or discard those edits

ERC and readiness are different gates. A clean schematic ERC only means that the checked electrical-rule set found no schematic errors; it does **not** prove that PCB DRC is clean or that sourcing, datasheet review, simulation evidence, layout review, and other release checks are complete. Always inspect both the ERC card and the readiness review card, then run PCB DRC and the remaining release checks in KiCad before manufacturing.

## Codex CLI verification

Codex CLI is used as a local validation surface, not as a stored credential source. The command below bypasses approvals and sandboxing, so use it only in this local checkout after reviewing the prompt.

```powershell
codex exec -C C:\path\to\OH-MY-ChatPCB --dangerously-bypass-approvals-and-sandbox "Run exactly these commands: npm run verify:sample and npm run verify:ui. Then read README.md and answer whether the documented User Test Guide is enough for a user to test the current scaffold. Do not edit files."
```

The expected Codex CLI result is a concise report that confirms the sample and browser UI verifications ran and identifies any user-facing gaps in the README. Do not commit provider credentials or Codex session data.

## Browser UI verification

Run this command for the closest repeatable check to a user operating the current panel:

```powershell
npm run verify:ui
```

It starts an isolated `chatpcb-agentd`, serves `apps/panel/index.html`, opens the panel in a local Chromium-compatible browser, creates a Korean-named project, enters a request, presses **Send**, and verifies the request, ERC, review, artifact, KiCad-link, dirty-conflict, reload-acknowledgement, rollback, and safe-error states.

## Computer Use verification status

For an interactive end-to-end check, use the ChatPCB-enabled KiCad fork when it is available; otherwise use the standalone browser panel for project creation and open the returned `.kicad_pro` manually in KiCad. Create a temporary named project, send the request above, and confirm that the success, review, ERC, and KiCad-link cards are all visible.

After opening the `.kicad_pro`, run **Inspect → Electrical Rules Checker** and record the visible error and warning counts. Make an unsaved edit before another request and confirm the panel shows `conflict` without reloading. Save or discard the edit before continuing. Run PCB DRC separately; ERC alone is not a release decision.

`npm run verify:ui` is the repeatable automated counterpart. It operates the same panel contract with a local browser and a mock KiCad host, including the dirty-editor guard.

## CLI

```powershell
node ./bin/chatpcb-cli.js generate --project ./workspaces/demo --prompt "STM32 board with USB-C power, 3.3V regulator, I2C sensor connector, UART debug header, reset button, and status LED."
node ./bin/chatpcb-cli.js validate --project ./workspaces/demo
node ./bin/chatpcb-cli.js simulate --project ./workspaces/demo
node ./bin/chatpcb-cli.js daemon --host 127.0.0.1 --port 41317
```

`validate` returns `skipped: true` when KiCad CLI is unavailable and `ok: false` when the ERC JSON report contains `error` severity violations. Warning-only reports stay `ok: true` and include `erc.warningCount` plus `erc.byType`; the current generated MCU fixture is expected to validate with `0` warnings. `simulate` returns `skipped: true` when `ngspice` is unavailable.

## Architecture

The intended KiCad fork keeps KiCad UI changes small:

1. KiCad creates a right dock panel.
2. The panel hosts `apps/panel` in `wxWebView`.
3. The panel starts `chatpcb-agentd` on `127.0.0.1:41317`.
4. The WebView sends `project.create` and `project.request` as `tool.call` envelopes over websocket.
5. The daemon creates or updates normal KiCad artifacts, runs ERC validation, computes a separate readiness review, and returns one structured `tool.result`.
6. The host bridge opens or reloads the `.kicad_pro` only when the active KiCad editor is clean; unsaved edits produce a conflict instead.

The current tool-call names are:

- `schematic.generate`
- `project.create`
- `project.request`
- `schematic.patch`
- `validate.erc`
- `simulate.spice`
- `provider.status`
- `provider.list`
- `provider.invoke`
- `provider.cancel`

## KiCad Fork Integration

Use `kicad-fork/chatpcb_panel` as the first source drop-in. The KiCad fork branch now instantiates `CHATPCB_PANEL` in the schematic editor side area, packages `share/chatpcb_panel/`, prepares development runtime assets, and can launch the panel-backed schematic editor locally with the ChatPCB daemon connected.

## License

GPL-3.0-or-later.
