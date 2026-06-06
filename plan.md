# OH-MY-ChatPCB Development Plan

## Completed Implementation Checklist

- [x] Created the `OH-MY-ChatPCB` repository scaffold in `C:\Users\windo\chatpcb2`.
- [x] Initialized local git repository and pushed `main` to `https://github.com/guyster323/OH-MY-ChatPCB`.
- [x] Forked KiCad source mirror to `https://github.com/guyster323/kicad-source-mirror`.
- [x] Added KiCad fork branch `chatpcb-panel-scaffold` with ChatPCB panel scaffold.
- [x] Added source-level KiCad fork integration that instantiates `CHATPCB_PANEL` in the schematic editor AUI pane and packages `share/chatpcb_panel`.
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
- [x] Verified generated sample with local KiCad 9.0.7 ERC: `0` errors and `0` warnings.
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
- [x] Attempted Computer Use UI verification and documented the bridge/policy blockers encountered in this environment.
- [x] Rechecked direct Computer Use after the bridge recovered; Windows UI automation can list and launch apps, but Chrome panel verification was stopped by browser URL policy before the `Generate` flow completed.
- [x] Added the first Phase 2 real-symbol schematic fixture with embedded ChatPCB symbols, wire stubs, net labels, footprint mappings, and `.chatpcb.json` explanations.
- [x] Added project-local `ChatPCB` symbol library packaging through `chatpcb.kicad_sym` and `sym-lib-table`.
- [x] Added ERC report parsing so validation fails on KiCad `error` severity and surfaces warning-only reports.
- [x] Fixed daemon port-collision handling so `verify:ui` can reuse an already-running `chatpcb-agentd` instead of hanging.
- [x] Verified KiCad CLI SVG export renders the generated sample schematic with symbols, notes, wires, and net labels.
- [x] Added approval-gated `schematic.patch` preview/apply workflow with diff output, cancel handling, validation, and rollback.
- [x] Added panel UI for patch diff preview, approve, cancel, validation-result display, and rollback messaging.
- [x] Fixed large WebSocket tool-result framing so approval results with large diffs reach the panel.
- [x] Added Phase 4 provider registry entries for Codex, Claude, and Copilot with local status probing.
- [x] Added strict provider transcript parsing, fake CLI provider tests, stderr redaction, and redacted local trace files.
- [x] Connected the panel provider selector to daemon `provider.status`.
- [x] Added provider invocation from panel chat through a selected local provider, with fake-provider browser verification.
- [x] Added process-level provider cancellation through `AbortSignal`.
- [x] Added panel Stop UI and daemon-level cancellation for in-flight provider calls.
- [x] Smoke-tested an installed Codex provider from panel chat without test injection.
- [x] Added automated tests covering runtime envelopes, daemon dispatch, CLI generation, provider bridge, KiCad CLI resolution, validation paths, simulation paths, and panel assets.

## Current Baseline

**Root repo:** `C:\Users\windo\chatpcb2`

**GitHub repo:** `https://github.com/guyster323/OH-MY-ChatPCB`

**Current root commit:** run `git log --oneline -1` in `C:\Users\windo\chatpcb2`.

**KiCad fork checkout:** `C:\Users\windo\kicad-source-mirror-chatpcb`

**KiCad fork branch:** `chatpcb-panel-scaffold`

**KiCad fork commit:** `80bde26 feat: add ChatPCB panel scaffold` plus uncommitted source-level panel integration in `C:\Users\windo\kicad-source-mirror-chatpcb`.

**Known local tools:**

- Node.js is available.
- KiCad 9.0.7 CLI is available at `C:/Program Files/KiCad/9.0/bin/kicad-cli.exe`.
- KiCad 10 CLI was not found locally.
- `ngspice` was not found on `PATH`.
- `cmake` was not found on `PATH`, but Visual Studio CMake is available at `C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe`.
- The KiCad fork Ninja configure/build path works after loading `vcvars64.bat` and using the local vcpkg toolchain; `eeschema/eeschema.exe` launches with the ChatPCB panel connected.

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
- `schematic.patch`
- `validate.erc`
- `simulate.spice`
- `provider.status`
- `provider.list`
- `provider.invoke`
- `provider.cancel`

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

- [x] Add a tiny fixture symbol library for generated tests.
- [x] Define a minimal internal schematic AST for MCU peripheral circuits.
- [x] Implement symbol placement for power input, regulator, MCU placeholder, reset button, boot button, status LED, I2C connector, UART header, and sensor connector.
- [x] Implement net labels for `VBUS`, `+3V3`, `GND`, `SCL`, `SDA`, `TX`, `RX`, `RESET`, and `BOOT`.
- [x] Implement footprint mapping for generated symbols.
- [x] Keep `.chatpcb.json` as the authoritative ChatPCB metadata store.
- [x] Keep generated `.kicad_sch` free of custom top-level `chatpcb_*` nodes.
- [x] Add golden tests for generated schematic structure.
- [x] Add live KiCad ERC smoke tests for every generated fixture.

Acceptance criteria:

- Generated `.kicad_sch` contains real symbols and nets, not only text notes.
- KiCad CLI can load every fixture.
- KiCad CLI SVG export can render the generated sample for visual review.
- ERC result is clean for the generated MCU fixture. Validation still fails on any KiCad `error` severity and surfaces warning-only reports for future fixtures.
- The generator can explain every generated symbol and net in `.chatpcb.json`.

## Phase 3: Diff Preview and Safe Apply

Goal: make all agent-generated file changes reviewable before they modify a user project.

Work items:

- [x] Add `schematic.patch` tool-call support.
- [x] Add a file snapshot model for before/after comparison.
- [x] Add unified diff generation for currently generated project files: `.kicad_sch`, `.kicad_pro`, `.chatpcb.json`, `sym-lib-table`, `chatpcb.kicad_sym`, and SPICE fixture.
- [ ] Extend patch diff handling to `.kicad_pcb` once PCB drafts exist.
- [x] Add panel UI for diff preview, approve, cancel, and rerun validation.
- [x] Add daemon-side apply lock to prevent concurrent writes to the same project.
- [x] Add rollback behavior using pre-apply snapshots.
- [x] Add tests for approve, cancel, failed validation, and rollback paths.

Acceptance criteria:

- No generated change is applied without an explicit approval step.
- Cancel leaves the project unchanged.
- Failed validation keeps the previous project files intact.
- Approved patch writes files and returns artifact paths plus validation result.

## Phase 4: Local Agent Provider Adapters

Goal: connect user-owned local CLI agent sessions to ChatPCB without storing provider keys.

Work items:

- [x] Add provider registry for `codex`, `claude`, and `copilot`.
- [x] Add provider availability checks using `Get-Command` on Windows and equivalent checks on Unix.
- [x] Add strict tool-call prompting for each provider.
- [x] Add transcript parser that accepts only `tool.call` JSON plus normal assistant deltas.
- [x] Add timeout and stderr redaction.
- [x] Add provider process cancellation.
- [x] Add panel Stop UI and daemon-level cancellation for in-flight provider calls.
- [x] Add local trace files with secrets redacted.
- [x] Add panel provider selector state connected to daemon configuration.
- [x] Add tests using fake CLI providers.

Acceptance criteria:

- [x] A fake provider can stream text and emit `schematic.generate`.
- [x] Unknown or malformed tool calls are rejected before execution.
- [x] Provider credentials are redacted from stderr transcripts and optional local trace files.
- [x] User can select provider in the panel and receive a typed status result.
- [x] A selected provider can be invoked from panel chat to produce a tool call, proven with a fake provider in `npm run verify:ui`.
- [x] A real installed provider can be smoke-tested from panel chat without test injection. Verified with Codex CLI returning `PANEL_REAL_PROVIDER_ASSISTANT_OK` through the panel.

## Phase 5: KiCad Fork Integration

Goal: wire the ChatPCB panel into the real KiCad source tree instead of keeping it as a standalone skeleton.

Work items:

- [x] Open `C:\Users\windo\kicad-source-mirror-chatpcb` on branch `chatpcb-panel-scaffold`.
- [x] Identify the schematic editor frame and side/dock panel integration point.
- [x] Add `plugins/chatpcb_panel` or the final chosen source directory to KiCad CMake.
- [x] Instantiate `CHATPCB_PANEL` in the schematic editor first.
- [x] Package `share/chatpcb_panel` assets into the KiCad install tree.
- [x] Ensure the panel resolves the correct local asset URL in installed builds.
- [x] Ensure the panel can start `chatpcb daemon` or connect to an already running daemon.
- [x] Add a Windows smoke build note with exact CMake command once the local KiCad build environment is prepared.

Acceptance criteria:

- [x] KiCad fork launches with a visible ChatPCB side panel.
- [x] The panel connects to `chatpcb-agentd`.
- [x] A prompt from inside KiCad generates a project draft.
- [x] Generated schematic opens in KiCad.
- [x] Local branch `chatpcb-panel-scaffold` remains rebaseable against KiCad upstream mirror.

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

Continue Phase 4 and Phase 5 while hardening direct GUI verification:

1. Wire the panel into the real KiCad fork source tree and installed asset path.
2. Keep direct Computer Use verification in the release checklist, using a fresh unlocked sample project so KiCad GUI does not show duplicate-open or stale-loading GUI states.
3. Continue toward PCB/layout, DRC, and manufacturing workflows once KiCad fork integration is visible in the real application.
