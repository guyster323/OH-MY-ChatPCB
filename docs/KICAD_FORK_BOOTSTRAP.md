# KiCad Fork Bootstrap

## Target

Create a KiCad 10.0.x fork branch that embeds ChatPCB as a right-side panel.

## Steps

1. Clone KiCad upstream into a sibling checkout.
2. Create a branch named `chatpcb-panel`.
3. Copy `kicad-fork/chatpcb_panel` into the KiCad source tree.
4. Add the panel directory to KiCad CMake build files.
5. Instantiate `CHATPCB_PANEL` in the schematic editor frame first.
6. Package `apps/panel/index.html`, `apps/panel/styles.css`, and `apps/panel/panel.js` into `share/chatpcb/`.
7. Ensure the installed KiCad distribution can run `chatpcb daemon --host 127.0.0.1 --port 41317`.

## Acceptance Check

The first fork milestone is complete when:

- KiCad launches with a visible right-side ChatPCB panel.
- The panel connects to `chatpcb-agentd`.
- A prompt creates a project draft in a chosen workspace.
- The generated `.kicad_sch` opens in KiCad.
- `chatpcb validate --project <dir>` runs or returns a typed skip reason.

## Constraint

Do not introduce custom top-level `chatpcb_*` nodes into KiCad files. Store draft metadata in `.chatpcb.json` and only put human-reviewable notes into KiCad schematic text until real symbol placement is implemented.
