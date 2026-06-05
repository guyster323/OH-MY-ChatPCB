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
- Reviewable KiCad project draft generation
- KiCad-compatible metadata using schematic `text`, not custom `chatpcb_*` nodes
- SPICE fixture generation for simple analog support circuits
- Local daemon and WebView websocket surface
- Windows KiCad CLI discovery including `C:/Program Files/KiCad/10.0` and `9.0`

Not implemented yet:

- Direct symbol placement for production schematics
- PCB layout generation
- KiCad source-tree integration build files
- Real Codex/Claude/Copilot prompt templates and tool-call enforcement
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
- KiCad validation passes when `kicad-cli` is available
- simulation returns success or the typed `NGSPICE_UNAVAILABLE` skip when `ngspice` is not installed
- panel verification starts `chatpcb-agentd`, sends the panel default prompt as a websocket `schematic.generate` tool call, and confirms generated artifact paths
- browser UI verification opens the panel, types a prompt, clicks `Generate`, and confirms artifact rows are rendered

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

It starts `chatpcb-agentd` on `127.0.0.1:41317`, serves `apps/panel/index.html`, opens the panel in a local Chromium-compatible browser, fills the project and prompt fields, clicks `Generate`, and verifies that generated artifacts appear in the UI.

## Computer Use verification status

Computer Use was attempted for direct UI verification, but the local automation bridge is not currently available in this session:

```text
Computer Use native pipe path is unavailable
```

Fallback browser automation was also checked. The in-app Browser backend returned `Browser is not available: iab`, and the Chrome automation backend returned `Browser is not available: extension`. Chrome itself is installed and running, and the Codex Chrome extension plus native host manifest checks passed locally.

Until the Computer Use or Chrome automation bridge is available, `npm run verify:ui` is the strongest repeatable user-flow proxy. It verifies real browser input, click behavior, websocket generation, and artifact rendering for the same panel contract that the right-side KiCad WebView uses.

## CLI

```powershell
node ./bin/chatpcb-cli.js generate --project ./workspaces/demo --prompt "STM32 board with USB-C power, 3.3V regulator, I2C sensor connector, UART debug header, reset button, and status LED."
node ./bin/chatpcb-cli.js validate --project ./workspaces/demo
node ./bin/chatpcb-cli.js simulate --project ./workspaces/demo
node ./bin/chatpcb-cli.js daemon --host 127.0.0.1 --port 41317
```

`validate` returns `skipped: true` when KiCad CLI is unavailable. `simulate` returns `skipped: true` when `ngspice` is unavailable.

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
- `validate.erc`
- `simulate.spice`

## KiCad Fork Integration

Use `kicad-fork/chatpcb_panel` as the first source drop-in. The actual KiCad frame integration should instantiate `CHATPCB_PANEL` in the schematic and PCB editor side area, then package `apps/panel/*` into the KiCad install tree at `share/chatpcb/`.

## License

GPL-3.0-or-later.
