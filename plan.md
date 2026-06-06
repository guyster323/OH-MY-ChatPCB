# OH-MY-ChatPCB Development Plan

## Completed Implementation Checklist

- [x] Created the `OH-MY-ChatPCB` repository scaffold in `C:\Users\windo\chatpcb2`.
- [x] Initialized local git repository and pushed `main` to `https://github.com/guyster323/OH-MY-ChatPCB`.
- [x] Forked KiCad source mirror to `https://github.com/guyster323/kicad-source-mirror`.
- [x] Added KiCad fork branch `chatpcb-panel-scaffold` with ChatPCB panel scaffold.
- [x] Added local `chatpcb` CLI entrypoint: `bin/chatpcb-cli.js`.
- [x] Added `generate`, `validate`, `simulate`, and `daemon` CLI commands.
- [x] Added `chatpcb-agentd` local daemon with `/health`, `/tool`, and `/ws`.
- [x] Added WebSocket envelope contract for `chat.message`, `agent.delta`, `tool.call`, `tool.result`, `project.diff`, and `system.status`.
- [x] Added provider process bridge skeleton for local CLI agents.
- [x] Added MCU peripheral prompt normalization into a bounded `CircuitSpec`.
- [x] Added reviewable KiCad project draft generation.
- [x] Added KiCad-compatible schematic metadata using normal schematic `text`, not custom `chatpcb_*` nodes.
- [x] Added SPICE fixture generation for simple analog support circuits.
- [x] Added KiCad CLI lookup order: explicit path, `KICAD_CLI_PATH`, Windows KiCad install paths, then `kicad-cli` from `PATH`.
- [x] Verified generated sample with local KiCad 9.0.7 ERC: `0` violations.
- [x] Added typed skip behavior for unavailable `ngspice`.
- [x] Added WebView-ready right panel bundle in `apps/panel`.
- [x] Added KiCad `wxWebView` panel C++ skeleton in `kicad-fork/chatpcb_panel`.
- [x] Added project docs: `README.md`, `docs/ARCHITECTURE.md`, `docs/KICAD_FORK_BOOTSTRAP.md`, `docs/ROADMAP.md`, `docs/handoff-next-session.md`.
- [x] Added `CONTRIBUTING.md` with TDD, credential, and KiCad fork workflow rules.
- [x] Replaced placeholder license pointer with the full GPL-3.0 license text.
- [x] Added `npm run verify:sample` for one-command sample generation, ERC validation, and SPICE hook verification.
- [x] Added README user-test guide and Codex CLI verification instructions.
- [x] Added `npm run verify:panel` for panel default prompt to daemon websocket verification.
- [x] Added `npm run verify:ui` for browser-based prompt input, Generate click, and artifact rendering verification.
- [x] Attempted Computer Use UI verification and documented the local bridge blocker.
- [x] Retried Computer Use after Codex update; current blocker is `windows sandbox failed: spawn setup refresh`.
- [x] Added automated tests covering runtime envelopes, daemon dispatch, CLI generation, provider bridge, KiCad CLI resolution, validation paths, simulation paths, and panel assets.

## Current Baseline

**Root repo:** `C:\Users\windo\chatpcb2`

**GitHub repo:** `https://github.com/guyster323/OH-MY-ChatPCB`

**Current root commit:** run `git log --oneline -1` in `C:\Users\windo\chatpcb2`.

**KiCad fork checkout:** `C:\Users\windo\kicad-source-mirror-chatpcb`

**KiCad fork branch:** `chatpcb-panel-scaffold`

**KiCad fork commit:** `80bde26 feat: add ChatPCB panel scaffold`

**Known local tools:**

- Node.js is available.
- KiCad 9.0.7 CLI is available at `C:/Program Files/KiCad/9.0/bin/kicad-cli.exe`.
- KiCad 10 CLI was not found locally.
- `ngspice` was not found on `PATH`.

## Product Goal

Build an open-source KiCad-based ChatPCB distribution where a user can attach their own local agent subscription or logged-in CLI session, open a right-side chat panel in KiCad, and perform core KiCad workflows through chat.

The implementation strategy is:

1. Keep the KiCad fork UI changes small and focused.
2. Host the ChatPCB UI in a `wxWebView` side panel.
3. Run `chatpcb-agentd` locally on `127.0.0.1`.
4. Bridge the panel to local CLI agents through strict tool-call envelopes.
5. Apply generated KiCad file changes only after user-visible review and validation.

## Architecture Contract

The runtime is split into four parts:

- **KiCad fork panel:** C++ `wxWebView` panel that loads the local ChatPCB UI and starts or connects to `chatpcb-agentd`.
- **Panel UI:** static HTML/CSS/JS bundle in `apps/panel` for chat, project context, generation, artifacts, and future diff approval.
- **Agent daemon:** local Node.js daemon exposing `/health`, `/tool`, and `/ws`.
- **KiCad automation:** project generation, schematic authoring, ERC/DRC, SPICE, export, and future patch application.

All panel-to-daemon messages must use this envelope shape:

```json
{
  "version": 1,
  "id": "evt_<uuid>",
  "type": "tool.call",
  "createdAt": "2026-06-05T00:00:00.000Z",
  "payload": {}
}
```

Current supported tool names:

- `schematic.generate`
- `project.create`
- `validate.erc`
- `simulate.spice`

Future tool names should stay action-oriented and explicit:

- `schematic.patch`
- `project.diff`
- `validate.drc`
- `export.bom`
- `export.gerber`
- `export.pdf`
- `board.place`
- `board.route.suggest`

## Phase 1: Scaffold and Validation Baseline

Status: complete for the scaffold and validation baseline.

Remaining work:

- [x] Push the new `plan.md` after review if it should become the public development source of truth.
- [x] Add `npm run verify:sample` that runs sample generation, ERC validation, and SPICE hook in one command.
- [x] Add `npm run verify:panel` that validates the panel default prompt through the daemon websocket `schematic.generate` flow.
- [x] Add `npm run verify:ui` that validates browser prompt input, Generate click behavior, and artifact rendering.
- [x] Add a short `CONTRIBUTING.md` explaining test-first development, local-only credential policy, and KiCad fork workflow.
- [x] Replace the placeholder SPDX license file with the full GPL-3.0-or-later license text.

Acceptance criteria:

- `npm test` passes.
- `node ./bin/chatpcb-cli.js generate --project ./workspaces/sample-mcu --prompt "<sample prompt>"` writes KiCad artifacts.
- `node ./bin/chatpcb-cli.js validate --project ./workspaces/sample-mcu` passes against local KiCad CLI.
- `node ./bin/chatpcb-cli.js simulate --project ./workspaces/sample-mcu` returns success or a typed `NGSPICE_UNAVAILABLE` skip.

## Phase 2: Real KiCad Schematic Authoring

Goal: move from review-note schematics to actual KiCad symbols, wires, labels, and footprints for a constrained MCU peripheral board.

Work items:

- [ ] Add a tiny fixture symbol library for generated tests.
- [ ] Define a minimal internal schematic AST for MCU peripheral circuits.
- [ ] Implement symbol placement for power input, regulator, MCU placeholder, reset button, boot button, status LED, I2C connector, UART header, and sensor connector.
- [ ] Implement net labels for `VBUS`, `+3V3`, `GND`, `SCL`, `SDA`, `TX`, `RX`, `RESET`, and `BOOT`.
- [ ] Implement footprint mapping for generated symbols.
- [ ] Keep `.chatpcb.json` as the authoritative ChatPCB metadata store.
- [ ] Keep generated `.kicad_sch` free of custom top-level `chatpcb_*` nodes.
- [ ] Add golden tests for generated schematic structure.
- [ ] Add live KiCad ERC smoke tests for every generated fixture.

Acceptance criteria:

- Generated `.kicad_sch` contains real symbols and nets, not only text notes.
- KiCad CLI can load every fixture.
- ERC result is either clean or contains only documented, intentional warnings.
- The generator can explain every generated symbol and net in `.chatpcb.json`.

## Phase 3: Diff Preview and Safe Apply

Goal: make all agent-generated file changes reviewable before they modify a user project.

Work items:

- [ ] Add `schematic.patch` tool-call support.
- [ ] Add a file snapshot model for before/after comparison.
- [ ] Add unified diff generation for `.kicad_sch`, `.kicad_pcb`, `.kicad_pro`, and `.chatpcb.json`.
- [ ] Add panel UI for diff preview, approve, cancel, and rerun validation.
- [ ] Add daemon-side apply lock to prevent concurrent writes to the same project.
- [ ] Add rollback behavior using pre-apply snapshots.
- [ ] Add tests for approve, cancel, failed validation, and rollback paths.

Acceptance criteria:

- No generated change is applied without an explicit approval step.
- Cancel leaves the project unchanged.
- Failed validation keeps the previous project files intact.
- Approved patch writes files and returns artifact paths plus validation result.

## Phase 4: Local Agent Provider Adapters

Goal: connect user-owned local CLI agent sessions to ChatPCB without storing provider keys.

Work items:

- [ ] Add provider registry for `codex`, `claude`, and `copilot`.
- [ ] Add provider availability checks using `Get-Command` on Windows and equivalent checks on Unix.
- [ ] Add strict tool-call prompting for each provider.
- [ ] Add transcript parser that accepts only `tool.call` JSON plus normal assistant deltas.
- [ ] Add timeout, cancellation, and stderr redaction.
- [ ] Add local trace files with secrets redacted.
- [ ] Add panel provider selector state connected to daemon configuration.
- [ ] Add tests using fake CLI providers.

Acceptance criteria:

- A fake provider can stream text and emit `schematic.generate`.
- Unknown or malformed tool calls are rejected before execution.
- Provider credentials are never written to repo files or daemon logs.
- User can select provider in the panel and receive a typed status result.

## Phase 5: KiCad Fork Integration

Goal: wire the ChatPCB panel into the real KiCad source tree instead of keeping it as a standalone skeleton.

Work items:

- [ ] Open `C:\Users\windo\kicad-source-mirror-chatpcb` on branch `chatpcb-panel-scaffold`.
- [ ] Identify the schematic editor frame and side/dock panel integration point.
- [ ] Add `plugins/chatpcb_panel` or the final chosen source directory to KiCad CMake.
- [ ] Instantiate `CHATPCB_PANEL` in the schematic editor first.
- [ ] Package `share/chatpcb_panel` assets into the KiCad install tree.
- [ ] Ensure the panel resolves the correct local asset URL in installed builds.
- [ ] Ensure the panel can start `chatpcb daemon` or connect to an already running daemon.
- [ ] Add a Windows smoke build note with exact CMake command once the local KiCad build environment is prepared.

Acceptance criteria:

- KiCad fork launches with a visible ChatPCB side panel.
- The panel connects to `chatpcb-agentd`.
- A prompt from inside KiCad generates a project draft.
- Generated schematic opens in KiCad.
- Local branch `chatpcb-panel-scaffold` remains rebaseable against KiCad upstream mirror.

## Phase 6: Simulation Support

Goal: make SPICE simulation useful for the supported analog parts of MCU peripheral circuits.

Work items:

- [ ] Install or document `ngspice` setup for Windows.
- [ ] Add `ngspice` discovery with explicit path and common Windows install paths.
- [ ] Add reusable SPICE model snippets for LED current limiting, button RC debounce, regulator approximation, and divider checks.
- [ ] Connect generated schematic subcircuits to SPICE netlist export where possible.
- [ ] Add result parsing for `.op` and transient checks.
- [ ] Show simulation pass/fail summaries in panel artifacts.

Acceptance criteria:

- If `ngspice` is installed, sample simulation runs without manual edits.
- If `ngspice` is absent, the system returns typed skip behavior.
- Simulation results state what was verified and what was not verified.

## Phase 7: PCB and Manufacturing Workflows

Goal: expand from schematic generation to board/manufacturing workflows.

Work items:

- [ ] Add `.kicad_pcb` draft generation with board outline.
- [ ] Add component placement suggestions.
- [ ] Add DRC validation through `kicad-cli pcb drc`.
- [ ] Add BOM export.
- [ ] Add Gerber and drill export.
- [ ] Add PDF/SVG export for review.
- [ ] Add artifact cards in the panel for generated manufacturing files.

Acceptance criteria:

- A generated board draft can be opened in KiCad PCB editor.
- DRC command runs or returns a typed skip/error reason.
- Manufacturing exports are generated into an ignored workspace directory.
- Panel shows artifact paths and validation status.

## Development Rules

- Use tests before implementation for behavior changes.
- Run `npm test` before commit.
- For KiCad file generation changes, run a live KiCad CLI smoke check when KiCad is installed.
- Do not store user API keys or provider tokens.
- Do not add custom top-level `chatpcb_*` nodes to KiCad files.
- Keep ChatPCB metadata in `.chatpcb.json`.
- Keep generated project/workspace files under ignored directories such as `workspaces/`.
- Commit small, reviewable milestones.

## Verification Commands

Run from `C:\Users\windo\chatpcb2`:

```powershell
npm install
npm test
npm run verify:sample
npm run verify:panel
npm run verify:ui
node ./bin/chatpcb-cli.js generate --project ./workspaces/sample-mcu --prompt "STM32 board with USB-C power, 3.3V regulator, I2C sensor connector, UART debug header, reset button, and status LED."
node ./bin/chatpcb-cli.js validate --project ./workspaces/sample-mcu
node ./bin/chatpcb-cli.js simulate --project ./workspaces/sample-mcu
git status --short --branch
```

Run from `C:\Users\windo\kicad-source-mirror-chatpcb`:

```powershell
git checkout chatpcb-panel-scaffold
git status --short --branch
git log --oneline -1
```

## Next Immediate Task

Start Phase 2 with a tiny real-symbol schematic fixture:

1. Add the first fixture-based real schematic authoring test.
2. Implement the smallest real KiCad symbol output that passes that test and live KiCad ERC.
3. Add diff-preview tests for the first generated schematic patch.
4. Begin Codex/Claude/Copilot fake provider adapter tests.
5. Re-run Computer Use verification when the native pipe is available in the session.
