# Evidence-Gated Runtime Rebuild Roadmap

> This roadmap decomposes the rebuild into independently reviewable implementation plans. Do not execute it as one change set.

**Design:** `docs/superpowers/specs/2026-09-03-evidence-gated-runtime-rebuild-design.md`

## Baseline

- Root `main`: `723eb1d`, PR #1 merged.
- Main verification at planning time: `npm test`, 112 passing.
- The unmerged `guyster323/route-reset-boot` worktree contains a safe partial routing experiment.
- Its measured live KiCad 10 results are STM32 `0 violations / 20 unconnected` and ESP32-S3 `0 violations / 23 unconnected` because two F.Cu signal paths split the ESP32 GND zone into connected clusters.
- Do not merge, delete, or extend that experiment until the solver phase decides how it should be retained.

## Program Gates

Every phase must satisfy all of these gates:

- TDD for every behavior change.
- Full `npm test` passes before commit and integration.
- No provider credential, transcript secret, downloaded binary, or datasheet is committed.
- KiCad files remain authoritative for editable design state.
- No write happens without a preview bound to artifact hashes.
- No release-ready promotion occurs from ERC or DRC alone.
- External adapters are optional, pinned, checksummed, and fail closed.
- Existing CLI, daemon, and panel flows remain compatible unless a migration step explicitly replaces them.

## Phase 1: Project Inspection and Evidence Foundation

**Detailed plan:** `docs/superpowers/plans/2026-09-03-project-inspection-evidence-foundation.md`

Deliver:

- schema-versioned evidence manifest
- deterministic artifact inventory and SHA-256 hashing
- `project.inspect` CLI and daemon tool
- freshness/staleness calculation
- artifact-bound patch approval
- panel freshness and evidence summary

Exit gate:

- Repeated inspection is stable.
- A one-byte KiCad file edit invalidates prior evidence and patch approval.
- Legacy `.chatpcb.json` remains readable.

## Phase 2: Deterministic KiCad Analyzer Adapter

Create a separate implementation plan after Phase 1 interfaces land.

Deliver:

- built-in schematic/PCB inventory facts
- pinned optional kicad-happy adapter
- adapter provenance, hash verification, timeout, and redaction
- namespaced analyzer output that cannot overwrite built-in facts
- fact IDs referenced by findings

Exit gate:

- Analyzer output is deterministic for fixed inputs.
- Adapter absence produces a typed skip.
- A corrupt or checksum-mismatched adapter is never executed.
- Findings distinguish deterministic, heuristic, and datasheet-backed confidence.

## Phase 3: Agent Capability and Review Separation

Create a separate implementation plan after Phase 2 establishes the fact contract.

Deliver:

- `planner`, `writer`, `reviewer`, and `operator` capability profiles
- daemon-side enforcement independent of prompt wording
- read-only reviewer workflow over inspection and evidence
- separate writer and reviewer transcript records
- panel attribution for proposed, verified, reviewed, and approved states

Exit gate:

- Reviewer calls to write tools fail with `CAPABILITY_DENIED`.
- Writer output cannot mark itself approved or release-ready.
- Release findings cite fact IDs and artifact hashes.

## Phase 4: KiCad IPC Context Adapter

Create a separate implementation plan against the exact installed KiCad IPC schema and supported version.

Deliver:

- connection discovery using `KICAD_API_SOCKET` and `KICAD_API_TOKEN`
- active project/document and selection inspection
- dirty-state and reload coordination
- typed IPC capability discovery
- existing file bridge fallback
- API logging and troubleshooting documentation

Exit gate:

- IPC connect/disconnect does not lose project state.
- Multiple KiCad instances are disambiguated.
- Unsupported operations fall back or return a typed error.
- No IPC mutation bypasses patch preview and approval.

## Phase 5: Placement and Routing Solver Interface

Create a separate implementation plan after Phase 1 approval hashes and Phase 2 inspection facts are stable.

Deliver:

- normalized placement/routing constraint schema
- provider-neutral preview/apply/clear operations
- built-in bounded router adapter
- optional external local solver adapter
- candidate board storage outside the user project
- DRC, unconnected-by-net, runtime, and fidelity diagnostics

Exit gate:

- Solver preview never mutates the user project.
- Apply requires matching artifact hashes and explicit approval.
- Cross-layer segments, vias, zones, and locked items are represented.
- The RESET/BOOT experiment is either reproduced at `0 violations / <=22` and `0 / <=20`, or formally retired with measured evidence.

## Phase 6: Circuit JSON Interoperability

Create a separate preview-only interoperability plan.

Deliver:

- `export.circuit-json`
- `import.circuit-json.preview`
- converter version and provenance
- unsupported-object and approximation report
- KiCad → Circuit JSON → KiCad comparison fixture corpus

Exit gate:

- Import never auto-applies.
- Partial net labels, power symbols, pad shapes, and hierarchy support are visible as diagnostics.
- Round-trip differences are bounded and fixture-tested before apply is considered.

## Phase 7: Manufacturing Evidence Bundle

Create a separate plan after inspection, capability separation, and solver interfaces are complete.

Deliver:

- BOM, Gerber, drill, position, PDF/SVG, and optional 3D exports
- artifact hashes and KiCad version for every output
- source-board hash binding
- stale export detection
- sourcing and datasheet evidence attachment
- release bundle manifest and panel card

Exit gate:

- Manufacturing files cannot be marked current after the board changes.
- Export requires zero DRC violations and zero unconnected items.
- Release-ready still requires sourcing, datasheet, simulation/calculation, layout, and approval evidence.

## Documentation and Positioning

After Phase 1 lands, update `README.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, and `plan.md` to use this product statement:

> OH-MY-ChatPCB is a local-first, evidence-gated KiCad agent runtime that connects user-owned AI providers to native KiCad workflows with deterministic inspection, reviewable patches, validation, rollback, and human release gates.

Document Circuit JSON, kicad-happy, KiCad IPC, and solver integrations as optional adapters rather than core sources of truth.

## Recommended Execution Order

1. Execute Phase 1 completely.
2. Review its public schemas before starting another phase.
3. Execute Phase 2 and Phase 3 before adding more write tools.
4. Run Phase 4 and Phase 5 in either order only after Phase 1; prefer IPC first if active-editor context is blocking UX, otherwise prefer solver first if PCB completion is blocking milestones.
5. Treat Phase 6 as an isolated experiment.
6. Execute Phase 7 only after the board flow can produce zero-unconnected candidates.
