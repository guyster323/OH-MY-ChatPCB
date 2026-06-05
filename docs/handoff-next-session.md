# Handoff: OH-MY-ChatPCB

## Current State

`chatpcb2` now contains the first runnable scaffold for the proposed KiCad ChatPCB plan.

Working surfaces:

- `npm test`
- `node ./bin/chatpcb-cli.js generate --project <dir> --prompt <text>`
- `node ./bin/chatpcb-cli.js validate --project <dir>`
- `node ./bin/chatpcb-cli.js simulate --project <dir>`
- `node ./bin/chatpcb-cli.js daemon --host 127.0.0.1 --port 41317`
- `apps/panel/index.html`
- `kicad-fork/chatpcb_panel`

## Important Constraints

- The repo is a scaffold, not a full KiCad fork checkout.
- Generated schematics use KiCad `text` notes only; real symbols/footprints are next.
- KiCad 9 is installed on this machine at `C:/Program Files/KiCad/9.0/bin/kicad-cli.exe`; KiCad 10 was not found during this run.
- `ngspice` was not found on PATH during this run.

## Next Work

1. Add real KiCad symbol placement tests using a tiny fixture library.
2. Implement `schematic.patch` and file diff preview.
3. Add provider adapters for Codex/Claude/Copilot CLI with strict JSON tool-call prompts.
4. Clone/fork KiCad source and wire `kicad-fork/chatpcb_panel` into the schematic editor frame.
5. Add live KiCad ERC smoke checks against generated fixtures.
