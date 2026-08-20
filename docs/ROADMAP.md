# Roadmap

Status is against `main` in this repository. Historical session notes live in `docs/handoff-next-session.md` and `plan.md`.

## Phase 1: Runnable Scaffold

Status: complete.

- Local CLI and daemon
- WebView panel bundle
- KiCad fork C++ skeleton
- MCU peripheral draft generation
- ERC and SPICE command hooks

## Phase 2: Real Schematic Authoring

Status: complete for the constrained MCU fixture and two supported profiles.

- Symbol library resolver
- Footprint resolver
- Net label generator
- ERC fixture suite
- Diff preview before applying edits

## Phase 3: Provider Adapters

Status: complete for local CLI adapters.

- Codex CLI adapter
- Claude Code adapter
- Copilot CLI adapter
- Tool-call schema enforcement
- Redacted local traces

## Phase 4: KiCad Fork Productization

Status: source-level panel integration exists; packaging and rebase are open.

- [x] Schematic-editor `CHATPCB_PANEL` skeleton
- [ ] CMake/installer packaging in this repo
- [ ] Windows/macOS/Linux smoke tests in CI
- [ ] KiCad upstream rebase workflow

## Phase 5: PCB and Manufacturing

Status: supported-profile drafts exist; manufacturing exports do not.

- [x] Initial board outline
- [x] Embedded footprint placement and conservative trace scaffold
- [x] Supported-profile power-path routing
- [ ] DRC-clean routed boards (zero violations and zero unconnected items)
- [ ] Gerber, drill, BOM, PDF, and SVG manufacturing export from ChatPCB
- [ ] Live JLCPCB/LCSC sourcing evidence
