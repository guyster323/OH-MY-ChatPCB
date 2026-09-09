# ChatPCB Architecture

OH-MY-ChatPCB is a local-first, evidence-gated KiCad agent runtime that connects user-owned AI providers to native KiCad workflows with deterministic inspection, reviewable patches, validation, rollback, and human release gates.

## Runtime Boundaries

ChatPCB is split into three local-only layers:

- KiCad fork UI: a `wxWebView` side panel and a small launcher for `chatpcb-agentd`
- Agent daemon: websocket and HTTP tool-call bridge on `127.0.0.1`
- KiCad automation: project generation, `kicad-cli` validation, and `ngspice` simulation hooks

The daemon does not store provider API keys. Provider-specific adapters call already-authenticated local CLI tools through the process bridge, accept provider-emitted `tool.call` JSON only, redact secrets from stderr transcripts and optional local trace files, and support process-level cancellation with `AbortSignal`.

## Natural-Language Project Flow

The panel owns one active named project at a time:

1. `project.create { workspaceRoot, projectName }` validates the Unicode display name, creates a safe slugged directory inside the selected workspace, and returns its normal filesystem path.
2. The user writes a Korean or English circuit request and presses **Send**.
3. Before dispatch, the panel asks the KiCad host for `project.status`. A dirty editor produces `linkState: "conflict"`; the panel does not send `project.request` or request a reload until the unsaved edits are resolved.
4. `project.request { projectDir, prompt, provider }` invokes the selected local provider, confines emitted tool calls to the active project, and falls back to bounded local generation or an approval-gated patch preview when the provider returns no call.
5. The daemon validates ERC, restores the previous artifacts when an existing-project update fails validation, recomputes the readiness review, and returns `{ operation, files, validation, review, providerEvents }`.
6. The panel renders request status, ERC, readiness review, artifacts, and KiCad link state independently. A clean host may receive `project.reload`; standalone browser mode instead shows the `.kicad_pro` path for manual opening. Official standalone KiCad opens that project path through `kicad.exe`; a direct `eeschema.exe` launch must receive the matching `.kicad_sch`, never the `.kicad_pro`.

The host bridge accepts `project.open`, `project.status`, and `project.reload` messages. It validates absolute `.kicad_pro` paths, correlates responses with the containing active-project directory, uses the current schematic editor APIs, and refuses open/reload while the editor has unsaved content.

## Message Envelope

All panel/daemon messages use this shape:

```json
{
  "version": 1,
  "id": "evt_<uuid>",
  "type": "tool.call",
  "createdAt": "2026-06-05T00:00:00.000Z",
  "payload": {}
}
```

Supported types:

- `chat.message`
- `agent.delta`
- `tool.call`
- `tool.result`
- `project.diff`
- `system.status`

## Generation Contract

The v1 generator produces review drafts for MCU peripheral circuits. It writes:

- `.kicad_pro`
- `.kicad_sch`
- `chatpcb.kicad_sym`
- `sym-lib-table`
- `.chatpcb.json`
- `_simulation.cir`
- `.kicad_pcb` for supported board profiles

The schematic uses project-local ChatPCB fixture symbols, wire stubs, net labels, no-connect markers for intentionally unused optional pins, and review notes. KiCad files are the authoritative editable state. `.chatpcb.json` is an intent/evidence manifest that records ChatPCB context but never replaces saved KiCad state; custom top-level `chatpcb_*` schematic nodes are not allowed.

## Inspection, evidence, and approval

`project.inspect { projectDir, analyzerAdapters? }` inventories saved project artifacts, computes deterministic hashes, runs validation against a checked copy, records toolchain evidence, and reports manifest freshness. The daemon ignores request-supplied `kicadCliPath` and takes the executable only from trusted dispatch configuration or operator-owned discovery settings. Provider-emitted path overrides are stripped; recursive inspection, ERC/DRC and patch validation preserve the server configuration. The local CLI's `--kicad-cli` is a trusted operator option.

Before inspect, ERC, or DRC starts, filesystem checks reject root/ancestor links, junctions, child links and special files, and inspect also checks canonical workspace containment when configured. Callers must supply a canonical project path; user-supplied project or ancestor links are not followed. Copying does not dereference links. The internally created inspection temp root is canonicalized with `realpath` before the copy is validated, so OS temp aliases do not reject the private tree; the destination is checked again before use. Version queries run within that disposable tree. All validators settle before cleanup, including when a sibling fails. Absolute PATH lookup excludes the process working directory and the original project tree, including when inspect or patch-candidate validation has changed cwd to a copy. Trusted `explicitPath` and `KICAD_CLI_PATH` remain operator overrides. These controls do not sandbox a malicious installed KiCad binary or an adversary with concurrent control of the server account.

Inspection returns `inspection.facts`, `inspection.analyzers`, and top-level `findings`. Built-in extractors produce deterministic saved-artifact facts for schematic structure (components, labels, wires, junctions, no-connects, nets) and PCB structure (nets, footprints, pads, segments, vias, summary); unrouted-net candidates are heuristic. Confidence is always `deterministic`, `heuristic`, or `datasheet-backed`: structural facts are review evidence, never proof of electrical correctness or release readiness. Analyzer status is `complete`, `partial`, `skipped`, or `failed`, with typed diagnostics.

Schema v1 `.chatpcb.json` files remain readable but unverified and inspect as `legacy-unverified`, because they have no artifact-bound evidence. Schema v2 is artifact-bound and uses canonical top-level `constraints`, `artifacts`, `toolchain`, `facts`, `findings`, `approvals`, and `releaseGates`; inspection derives the project digest from sorted artifact records. Any tracked artifact change makes prior evidence stale.

Every artifact-bound approval contains the exact candidate patch identity, before/after bytes, and whole-project digests. Candidate generation and KiCad validation run in the retained disposable copy, so the preview contains KiCad-normalized bytes. The internally created patch temp root is canonicalized with `realpath` before candidate ERC, which passes `excludeProjectDir` as the original project so automatic PATH discovery cannot select a project-tree binary after cwd changes to the copy. User-supplied project and ancestor links remain rejected; only that internal temp root is normalized. Applying it requires the same single-use, unexpired approval, recomputes the complete current project digest immediately before a write, writes the approved bytes exactly, and verifies final hashes. A stale input writes nothing; a final-byte mismatch restores the snapshot. Provider-emitted validation is routed through the same disposable inspection path. All generated artifacts participate in preview and rollback, including `.kicad_pcb` drafts.

Circuit JSON, kicad-happy, KiCad IPC, and placement/routing solver integrations remain optional integrations. External analyzer process execution is currently disabled in both JSON and project-copy modes. Explicit definitions return `ANALYZER_SANDBOX_UNAVAILABLE` with no executable reads, payload staging, or process launch. There is no caller-controlled override. A future launcher must enforce complete payload integrity and filesystem isolation before execution can be restored. Built-in facts remain available.

## Validation Contract

KiCad CLI lookup order:

1. explicit command flag
2. `KICAD_CLI_PATH`
3. Windows install directories for KiCad 10, 9, 8, then 7
4. absolute directories on `PATH` that are outside the process working directory and outside the original project tree (`excludeProjectDir`); relative entries, the working directory, and original-project descendants are ignored even when inspect or patch-candidate validation uses a disposable copy as cwd. Trusted `explicitPath` and `KICAD_CLI_PATH` are not subject to that PATH exclusion. If none exist, the tool is unavailable.

If KiCad CLI or ngspice is missing, commands return `ok: true` with `skipped: true` and a typed reason.

ERC and readiness are deliberately separate. ERC reports schematic electrical-rule errors and warnings. It does not run PCB DRC and cannot establish manufacturing readiness. The readiness review also accounts for unresolved parts, sourcing, datasheet checks, simulations, layout/DRC evidence, and other release gates; therefore `validation.erc.errorCount === 0` may coexist with warnings or a blocked review.

Board validation is exposed separately as `validate.drc` and `chatpcb drc`. It runs `pcb drc --refill-zones --format json`, parses both `violations` and `unconnected_items`, and reports `ok: true` only when the KiCad command succeeds with zero entries in both arrays. A missing KiCad CLI or board returns typed `skipped` output; a malformed report or a real DRC finding returns `ok: false`.

The ADBMS6830 path is intentionally schematic-only. It creates a named 16S Li-ion example with cell-tap filters, passive-balance branches, NTC inputs, an example VREG pass stage, and isoSPI connectors, while keeping the PCB artifact absent until the exact device variant, high-voltage safety architecture, placement, isolation, and manufacturing evidence are reviewed.
