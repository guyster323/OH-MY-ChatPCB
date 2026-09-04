# Roadmap

Status is against `main` in this repository. Historical session notes live in `docs/handoff-next-session.md` and `plan.md`.

OH-MY-ChatPCB is an evidence-gated KiCad agent runtime. This rebuild roadmap is the active source of architectural direction: saved KiCad artifacts remain authoritative, every write requires artifact-bound preview and approval, and no clean ERC/DRC result alone permits release-ready status.

## Phase 1: Project Inspection and Evidence Foundation

Status: complete.

- Schema-versioned `.chatpcb.json` intent/evidence manifest
- Deterministic `project.inspect` inventory and digest
- Artifact-bound, expiring, single-use patch approval and rollback
- Panel freshness state for current, stale, missing, and `legacy-unverified` evidence

Schema v1 remains readable but unverified. Schema v2 is artifact-bound. Circuit JSON, kicad-happy, KiCad IPC, and solver integrations remain optional pinned adapters for later phases, not sources of editable truth.

### Deterministic analyzer increment

Status: complete for structural inspection only.

- Built-in saved-artifact facts and explicit confidence labels
- Analyzer status/diagnostics in CLI and daemon inspection output
- Pinned, checksum-verified programmatic adapters in disposable isolation with typed skips

This increment does not establish electrical correctness, manufacturability, or release readiness. A pinned configuration-file UX remains future work; no adapter is selected or installed implicitly.

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
