# Evidence-Gated Runtime Rebuild Design

## Product Position

OH-MY-ChatPCB is a local-first, evidence-gated KiCad agent runtime. It is not a prompt-to-PCB black box and it does not replace KiCad as the authoritative editable design. It connects user-owned local agent sessions to KiCad, makes proposed changes reviewable, verifies saved artifacts with deterministic tools, and keeps a human approval boundary before writes and release decisions.

## Problem

The current project already has a KiCad panel, local provider adapters, approval-gated patches, rollback, ERC/DRC workflows, supported profiles, and explicit release-readiness gates. The missing architectural layer is a deterministic reconstruction of facts from the saved KiCad project.

Today, generation-time `CircuitSpec` and `.chatpcb.json` metadata can describe intent, but they can drift from `.kicad_sch` and `.kicad_pcb` after a user edits the project in KiCad. The current routing work also demonstrates that a growing collection of coordinate heuristics should not become the product's long-term placement and routing engine.

## Design Principles

1. KiCad files are the authoritative editable design artifacts.
2. `.chatpcb.json` is a versioned intent and evidence manifest, not a substitute for the KiCad files.
3. Facts are extracted deterministically; the model performs judgment over those facts.
4. Writer and reviewer capabilities are separated.
5. Every approval is bound to exact input and output artifact hashes.
6. Placement and routing are delegated through solver adapters and always return candidate patches.
7. ERC, DRC, simulation, sourcing, datasheet review, and manufacturing evidence remain separate gates.
8. External analyzers, solvers, and converters are optional, pinned, checksummed adapters.
9. Unsupported conversions fail closed and return fidelity diagnostics.
10. Existing file-based workflows remain available while KiCad IPC is introduced incrementally.

## Target Architecture

```text
User / KiCad panel
        |
        v
Agent planner ------------------------------+
        |                                   |
        v                                   v
Versioned Design Intent              Read-only reviewer
        |                                   ^
        v                                   |
Writer capability -> candidate patch        |
        |                                   |
        v                                   |
Approval hash gate                          |
        |                                   |
        v                                   |
KiCad files <-> IPC/file adapter -> deterministic analyzer
        |                                   |
        +-> ERC / DRC / SPICE / solver ------+
        |
        v
Evidence manifest -> human approval -> release decision
```

## Canonical Data Boundaries

### KiCad Project

Saved `.kicad_pro`, `.kicad_sch`, `.kicad_pcb`, symbol, footprint, and manufacturing files remain authoritative for editable EDA state.

### Design Intent

The normalized user request remains versioned and small. It describes requested function, electrical constraints, preferred profiles, excluded behavior, and safety assumptions. It does not claim that the saved board satisfies those requirements.

### Evidence Manifest

`.chatpcb.json` evolves to schema version 2 with these top-level fields:

```json
{
  "schemaVersion": 2,
  "intent": {},
  "constraints": [],
  "artifacts": [],
  "toolchain": {},
  "facts": [],
  "findings": [],
  "approvals": [],
  "releaseGates": []
}
```

Each artifact contains `path`, `kind`, `sha256`, `size`, and `capturedAt`. Each fact contains `id`, `category`, `value`, `sourceArtifact`, `extractor`, and `confidence`. Findings reference fact IDs rather than restating unverifiable data. Approval records bind the actor and decision to a candidate patch hash and exact before/after artifact hashes.

## Deterministic Project Inspection

`project.inspect` reads only saved project files and produces a stable inspection result. The first increment inventories artifacts, hashes them, records KiCad tool versions, runs the existing ERC/DRC adapters, and reports whether `.chatpcb.json` is fresh or stale relative to the saved project.

Later analyzer adapters may add schematic connectivity, PCB geometry, DFM, datasheet, thermal, EMC, and manufacturing facts. Adapter output is namespaced and cannot overwrite the built-in baseline.

## Capability Separation

Provider sessions receive an explicit capability profile:

- `planner`: read project facts and propose actions; cannot write.
- `writer`: create candidate patches; cannot approve or declare release readiness.
- `reviewer`: read artifacts, facts, validation, and datasheets; cannot call write tools.
- `operator`: execute an already approved patch or export job.

The daemon enforces these profiles. Prompt text is not a security boundary.

## Patch and Approval Contract

Patch preview returns:

```json
{
  "patchId": "sha256:...",
  "beforeArtifacts": [],
  "afterArtifacts": [],
  "changedFiles": [],
  "diff": "...",
  "expiresAt": "..."
}
```

Apply requires the same `patchId`. The daemon recalculates current before hashes immediately before writing. A changed or missing artifact returns `PATCH_STALE` and writes nothing. Validation failure restores the exact before snapshot.

## KiCad IPC Strategy

The existing fork panel remains the primary integrated UX. A new adapter uses official KiCad IPC for active project identity, selection, editor state, and supported live operations. Disk writes continue through the daemon transaction layer until each IPC mutation has equivalent preview and rollback semantics.

If IPC is unavailable, the panel and daemon use the existing file bridge. IPC is an enhancement, not a hard dependency for generation, inspection, or CI.

## Solver Strategy

Placement and routing use a provider-neutral interface:

```text
placement.preview
placement.apply
route.preview
route.apply
route.clear
```

The built-in router remains a bounded fallback for supported fixtures. External solver adapters receive normalized board constraints and return a candidate `.kicad_pcb` plus diagnostics. They never write the user's board directly. Acceptance requires artifact diff review and fresh KiCad DRC.

The current RESET/BOOT experiment is preserved as diagnostic evidence but is not merged until the solver boundary or an equivalent layer-aware strategy can meet the cross-profile DRC gate.

## Circuit JSON Interoperability

Circuit JSON is introduced only as an exchange format. The first adapter supports export and preview-only import with a fidelity report. Unsupported KiCad constructs, dropped fields, approximated geometry, and converter warnings are first-class output. Round-trip import is never auto-applied.

## External Adapter Supply Chain

Each external adapter definition records:

- immutable version or commit
- source URL
- archive SHA-256
- license
- supported KiCad versions
- executable and runtime requirements
- allowed filesystem and network behavior
- output schema version

Automatic `latest` downloads are prohibited. Cache contents are verified before execution.

## User Experience

The panel shows separate cards for:

1. intent and constraints
2. current project freshness
3. deterministic facts
4. candidate diff
5. ERC/DRC/simulation results
6. evidence-backed review findings
7. release gates and residual risks

Stale analysis or a hash mismatch disables approval. `ready-for-release` remains unavailable while any required evidence is missing, stale, warning, blocker, or failed.

## Migration

Schema version 1 metadata remains readable. On inspection, it is represented as legacy intent with no artifact-hash evidence. Migration to version 2 occurs only through an explicit preview and approval; existing KiCad files are not regenerated merely to upgrade metadata.

The old provider tool names remain supported during migration. New high-level tools are added without exposing large sets of coordinate-level primitives to providers.

## Non-Goals

- Replacing KiCad with a TSX or custom EDA editor
- Building a general-purpose autorouter inside the agent daemon
- Treating Circuit JSON conversion as lossless
- Letting an LLM approve its own writes
- Declaring release readiness from ERC or DRC alone
- Automatically installing unpinned external tools

## Success Criteria

- Repeated inspection of unchanged files produces identical artifact hashes and facts.
- Editing any tracked KiCad artifact marks prior evidence and approvals stale.
- A reviewer session cannot invoke any write tool.
- An approved patch cannot apply after the source project changes.
- IPC loss falls back to the file workflow without data loss.
- Solver output never reaches the user project before diff approval and DRC.
- Circuit JSON import reports unsupported or lossy conversions before approval.
- Release status is derived from fresh, artifact-linked evidence.
