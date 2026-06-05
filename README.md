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
npm test
npm run generate:sample
npm run validate:sample
npm run simulate:sample
npm run daemon
```

Open `apps/panel/index.html` in a WebView or browser while `npm run daemon` is running.

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
