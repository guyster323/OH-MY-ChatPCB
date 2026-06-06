# Handoff: OH-MY-ChatPCB

## Current State

`chatpcb2` now contains a runnable scaffold for the proposed KiCad ChatPCB plan, including real-symbol MCU schematic generation, safe patch review, provider status checks, provider chat invocation plumbing, provider Stop cancellation, and the first local provider adapter contracts.

Working surfaces:

- `npm test`
- `node ./bin/chatpcb-cli.js generate --project <dir> --prompt <text>`
- `node ./bin/chatpcb-cli.js validate --project <dir>`
- `node ./bin/chatpcb-cli.js simulate --project <dir>`
- `node ./bin/chatpcb-cli.js daemon --host 127.0.0.1 --port 41317`
- `apps/panel/index.html`
- `kicad-fork/chatpcb_panel`
- provider registry/status checks for Codex, Claude, and Copilot
- fake-provider verified panel chat invocation and provider Stop cancellation through `npm run verify:ui`
- real Codex CLI provider smoke from panel chat without test injection
- direct Computer Use verification of the built KiCad fork panel: visible ChatPCB side panel, `Connected`, `codex: available`, in-KiCad `Generate`, artifact rendering, and generated schematic open in the fork editor

## Important Constraints

- The repo is the companion/runtime scaffold; the full KiCad fork checkout is at `C:\Users\windo\kicad-source-mirror-chatpcb` on `chatpcb-panel-scaffold`.
- Generated schematics now use project-local ChatPCB fixture symbols, labels, wire stubs, no-connect markers, footprint mappings, and `.chatpcb.json` explanations.
- KiCad 9 is installed on this machine at `C:/Program Files/KiCad/9.0/bin/kicad-cli.exe`; KiCad 10 was not found during this run.
- `ngspice` was not found on PATH during this run.
- Provider CLI availability is status-checked locally; provider credentials must never be stored in repo files.
- The KiCad fork checkout has source-level schematic editor panel integration. Visual Studio CMake plus vcpkg can configure and build the local `eeschema/eeschema.exe` target, including ChatPCB runtime assets.

## Next Work

1. Continue toward PCB/layout, DRC, and manufacturing workflows after the real KiCad fork panel is visible and connected.
2. Install or document `ngspice` on Windows so simulation checks can run instead of returning `NGSPICE_UNAVAILABLE`.
3. Keep Computer Use GUI verification on the checklist with a fresh unlocked sample project.
