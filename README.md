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

Use this flow when you want to try the current scaffold from a user perspective.

1. Start in the repository root:

```powershell
cd C:\Users\windo\chatpcb2
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
- panel verification starts `chatpcb-agentd`, sends the panel default prompt as a websocket `schematic.generate` tool call, and confirms generated artifact paths
- browser UI verification opens the panel, types prompts, clicks `Generate`, previews/cancels/applies a patch, exercises provider Stop cancellation with a fake provider, and confirms artifact rows are rendered

3. Start the local daemon:

```powershell
npm run daemon
```

Keep this terminal running. The daemon owns the local websocket endpoint used by the panel.

4. In another browser window, open:

```text
C:\Users\windo\chatpcb2\apps\panel\index.html
```

You can also open `apps/panel/index.html` from a KiCad WebView host.

5. Use the default prompt or enter a prompt like:

```text
STM32 board with USB-C power, 3.3V regulator, I2C sensor connector, UART debug header, reset button, and status LED.
```

Expected result:

- the panel connects to `chatpcb-agentd`
- pressing `Generate` sends a `schematic.generate` tool call
- generated artifact paths appear in the panel
- the generated `.kicad_sch` can be validated with `npm run validate:sample`

## Codex CLI verification

Codex CLI is used as a local validation surface, not as a stored credential source. The command below bypasses approvals and sandboxing, so use it only in this local checkout after reviewing the prompt.

```powershell
codex exec -C C:\Users\windo\chatpcb2 --dangerously-bypass-approvals-and-sandbox "Run exactly these commands: npm run verify:sample and npm run verify:ui. Then read README.md and answer whether the documented User Test Guide is enough for a user to test the current scaffold. Do not edit files."
```

The expected Codex CLI result is a concise report that confirms the sample and browser UI verifications ran and identifies any user-facing gaps in the README. Do not commit provider credentials or Codex session data.

## Browser UI verification

Run this command for the closest repeatable check to a user operating the current panel:

```powershell
npm run verify:ui
```

It starts `chatpcb-agentd` on `127.0.0.1:41317`, serves `apps/panel/index.html`, opens the panel in a local Chromium-compatible browser, fills the project and prompt fields, clicks `Generate`, previews/cancels/applies a patch, exercises provider Stop cancellation, and verifies that generated artifacts appear in the UI.

## Computer Use verification status

Computer Use is available in the current Codex desktop session and can list, activate, inspect, and operate Windows apps. It was used to launch the local KiCad fork build at `C:\Users\windo\kicad-source-mirror-chatpcb\build\chatpcb-vcpkg\eeschema\eeschema.exe`, verify the visible right-side ChatPCB panel, confirm the panel auto-starts `chatpcb-agentd`, and click `Generate` from inside KiCad. The generated `chatpcb_mcu_peripheral.kicad_sch` also opens in the forked schematic editor.

`npm run verify:ui` remains the strongest repeatable non-interactive user-flow check. It starts or reuses `chatpcb-agentd`, serves `apps/panel/index.html`, performs real browser input and click behavior, and verifies websocket generation plus artifact rendering for the same panel contract that the right-side KiCad WebView uses.

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
4. The WebView sends `tool.call` envelopes over websocket.
5. The daemon creates KiCad artifacts, runs CLI validation/simulation, and returns `tool.result`.

The current tool-call names are:

- `schematic.generate`
- `project.create`
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
