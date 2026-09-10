# KiCad-Native Workbench Core First-Slice Design

## Status

This document specifies the next implementation increment. The new transaction journal, selection context, structured proposal, diff review, and manual rollback described here are not implemented at the time this document is committed.

The design is based on OH-MY-ChatPCB `main` at `c47cd2b51160a7b6807355c6d28ff7601a003dbd` and Copperhead `0.10.0` at `ef5a129f13b35e67b98216ea2f09aa7739ce6798`, inspected on 2026-09-10.

## Product Decision

OH-MY-ChatPCB becomes a KiCad-native AI Hardware Workbench. It owns context, evidence, proposals, review, approval, verification, and rollback inside KiCad. Interchangeable engines may produce candidate project states, but no engine may mutate the live KiCad project directly.

This specification implements the safety and interaction substrate before adding a mutating Copperhead adapter. Copperhead remains the first planned external ProposalSource, integrated as an isolated CLI subprocess in the immediately following increment. Its experimental MCP surface is not an integration dependency.

The existing Node/WebView/daemon architecture remains the implementation base. The unrelated Rust/wxWidgets ChatPCB3 branch stays preserved as a separate prototype and is not merged.

## Why the Work Is Split

The initially approved architecture contained three dependent increments:

1. a single journaled workbench mutation path;
2. KiCad selection context plus structured proposal/diff UX;
3. an isolated Copperhead ProposalSource.

Implementing all three at once would replace the current write path, add a C++ host protocol, add a process integration, and rewrite the panel in one review unit. This specification covers increments 1 and 2. Increment 3 starts after this specification's acceptance criteria pass, using the follow-up constraints recorded below. This is sequencing, not a reversal of the Copperhead decision.

## Current Baseline

The repository already provides:

- a schematic-editor `wxWebView` source drop-in with project open, status, reload, and dirty-editor protection;
- a static panel connected to `chatpcb-agentd` over versioned WebSocket envelopes;
- local CLI providers for Codex, Claude Code, and GitHub Copilot CLI;
- deterministic KiCad artifact inspection and evidence hashing;
- an expiring, single-use patch approval registry;
- KiCad ERC and DRC execution with hardened Windows discovery;
- an ngspice batch hook;
- readiness review that does not equate clean ERC/DRC with release readiness.

The current write path is not a durable transaction:

- `schematic.patch` creates a disposable full-regeneration candidate, but approval writes candidate files sequentially into the live project;
- write exceptions are not caught by an all-files restore block;
- snapshots exist only in memory and disappear on process exit;
- the approval token is consumed before the project lock and final checks;
- the stale-project digest excludes `.chatpcb.json`;
- `project.request` has a separate whole-directory delete-and-copy restore path;
- direct daemon ERC runs `sch upgrade --force` and direct DRC runs `--refill-zones` in the live project;
- required validation treats tool-unavailable skips as `ok: true`;
- post-success user rollback does not exist.

The current interaction layer also has no selected-object bridge and does not render the diff already returned by a patch preview.

## Goals

The first slice shall:

1. make `ProjectTransaction` the sole live-project mutation implementation used by daemon/workbench operations;
2. persist a before-image journal before the first live write;
3. restore every affected artifact on a write, hash, or required-verification failure;
4. run required ERC/DRC against disposable copies and treat skips as unavailable, not passed;
5. retain backward-compatible `schematic.patch` preview/approve/cancel requests through a facade;
6. capture supported schematic selection anchors from KiCad;
7. join those anchors to the smallest useful set of deterministic saved-project facts without inventing connectivity;
8. show selected context, WHY, WHAT, FILES, COMPONENTS, NETS, RISKS, verification plan, and per-file textual diff in the existing patch card;
9. recheck dirty editor state and artifact digests before approval;
10. provide an explicit, digest-safe rollback action after successful apply;
11. preserve the current standalone browser generation path while labeling selection as unavailable;
12. leave a small `ProposalSource` boundary that the next Copperhead increment can implement without changing panel or transaction contracts.

## Non-Goals

- No Copperhead process execution in this implementation plan.
- No Copperhead MCP integration.
- No PCB-editor selection integration.
- No full conversation-history redesign.
- No new Simulate button or before/after simulation comparison.
- No generic autonomous PCB creation pipeline.
- No new autorouter or completion of RESET/BOOT/VBUS/USB routing.
- No BOM, Gerber, drill, firmware, or project-document synchronization.
- No provider-matrix expansion.
- No schema v1-to-v2 evidence migration.
- No KiCad installer or packaged-fork work in this repository.
- No claim that source-string C++ tests prove a compiled KiCad selection bridge.

## Target Boundaries

```text
KiCad schematic host adapter
  -> existing ChatPCB panel
  -> chatpcb-agentd workbench facade
       -> Selection Context Bridge
       -> ProposalSource
            -> NativeProposalSource (this slice)
            -> CopperheadProposalSource (next slice)
       -> existing approval registry, extended
       -> ProjectTransaction
       -> disposable-copy ERC / DRC
       -> durable TransactionJournal
  -> existing panel result / rollback controls
```

### KiCad host adapter

Owns active editor kind, active project identity, dirty state, current sheet, and selected item anchors. It does not infer electrical connectivity and cannot mutate project files.

### Selection Context Bridge

Joins host anchors with deterministic saved-artifact facts. It always reports the limits of the current analyzer. In this slice, selected symbols are not assigned connected nets unless a selected label provides the net name directly.

### ProposalSource

Produces a candidate project state without live writes. The first implementation adapts the current full-regeneration patch candidate and labels it honestly. External engines implement the same small boundary later.

### ProjectTransaction

Owns apply and restore for daemon/workbench mutations. It serializes operations by canonical project path, journals before bytes, writes candidate bytes, verifies a disposable copy of the resulting state, and commits or restores the transaction.

The trusted CLI commands remain explicit operator surfaces. This specification does not change `chatpcb generate`, `chatpcb validate`, or `chatpcb drc`; the sole-writer rule applies to daemon/workbench mutations.

## Selection Host Protocol

Every host request carries a correlation ID. Existing host messages gain an optional `requestId`; old responses without it remain accepted only when there is no correlated request in flight.

Selection request:

```json
{
  "type": "selection.get",
  "requestId": "selection_<uuid>",
  "projectPath": "C:/absolute/project-directory"
}
```

Schematic-host response:

```json
{
  "type": "selection.context",
  "requestId": "selection_<uuid>",
  "projectPath": "C:/absolute/project-directory",
  "editor": "schematic",
  "dirty": false,
  "sheet": "/Power",
  "items": [
    {
      "kind": "symbol",
      "kiid": "stable-kicad-uuid",
      "reference": "U1",
      "position": { "x": 101.6, "y": 76.2 }
    },
    {
      "kind": "global_label",
      "kiid": "stable-kicad-uuid-if-available",
      "text": "+3V3",
      "position": { "x": 111.76, "y": 76.2 }
    }
  ],
  "diagnostics": []
}
```

Rules:

- The first slice accepts `symbol`, `label`, `global_label`, and `hierarchical_label` anchors.
- Unsupported selected objects are omitted and reported in `diagnostics`.
- Symbol identity prefers KiCad KIID, then reference plus converted schematic position.
- Coordinates are emitted in schematic millimetres using KiCad conversion helpers, not raw internal units.
- A response is applied only when `requestId` and `projectPath` match the active request and project.
- Dirty selection/status responses clear active previews and block approval.
- Every `project.status`, `project.reload`, and new selection response echoes `requestId` when supplied.
- Host JavaScript is constructed without using selection JSON as a `wxString::Format` format string; a percent character in values cannot corrupt the script.

Host availability has three distinct states:

| State | Behavior |
| --- | --- |
| No `chatpcbHost` handler | Standalone browser mode; requests remain available, selection is visibly unavailable. |
| Handler exists but times out | Embedded host failure; mutation requests are blocked until the host responds. |
| Explicit test mock | Allowed only in automated verification and visibly identified in diagnostics. |

The documented KiCad fork checkout is absent on the inspected machine. Mock host tests may verify the panel contract, but compiled-host acceptance remains open until a real KiCad 10 fork build and interactive selection check run.

## Selection Context Contract

```js
{
  schemaVersion: 1,
  project: {
    canonicalPath,
    evidenceDigest,
    transactionDigest,
    manifestFreshness
  },
  editor: {
    kind: 'schematic',
    sheet,
    dirty: false,
    hostState: 'embedded' | 'standalone' | 'mock'
  },
  selection: {
    mode: 'explicit' | 'project',
    items: SelectionAnchor[]
  },
  facts: Fact[],
  findings: Finding[],
  verification: { erc, drc },
  coverage: {
    status: 'partial',
    diagnostics: [
      { code: 'SELECTION_CONNECTIVITY_UNPROVEN', message: 'Pin-to-net connectivity is not proven by the current saved-artifact analyzer.' }
    ]
  }
}
```

Context rules:

1. Include project identity, both digests, host state, sheet, and selection anchors.
2. Include component facts whose UUID or reference matches a selected symbol.
3. Include label/net facts whose text matches a selected local, global, or hierarchical label.
4. Include findings that reference retained facts.
5. Include ERC/DRC summaries, not raw reports.
6. Do not include unrelated source text, `.env`, credentials, provider transcripts, or arbitrary project files.
7. Always report `partial` in this slice because pin-to-net and KiCad connection-graph facts are not implemented.
8. Absence of a matching analyzer fact is a diagnostic, not permission to fabricate one.

The analyzer extension in this slice adds deterministic global-label and hierarchical-label facts with the same structural validation discipline as local labels. It does not implement pin-to-net analysis.

## Transaction Inventory

Evidence freshness and transaction staleness use different digests.

`collectArtifactInventory` remains the evidence inventory and continues excluding `.chatpcb.json` to avoid a self-referential evidence manifest.

A new transaction inventory covers every text artifact the daemon may apply or must protect from concurrent edits:

- `.kicad_pro`
- `.kicad_sch`
- `.kicad_pcb`
- `.kicad_sym`
- `.kicad_mod`
- `.kicad_dru`
- `.chatpcb.json`
- `.cir`
- `sym-lib-table`
- `fp-lib-table`

It returns sorted project-relative POSIX paths, byte hashes, sizes, and a `transactionDigest`. Transient ERC/DRC reports and `.kicad_prl` are excluded. Symlinks, junctions, and special files are rejected before inventory or mutation.

Proposal apply and rollback compare `transactionDigest`, not the evidence digest. Every changed path also receives an exact `beforeHash` check under the project lock.

## ProposalSource Contract

The interface is intentionally smaller than a general engine framework:

```js
{
  id: 'native',
  async createCandidate({ projectDir, request, context, signal }) {},
  async disposeCandidate(candidate) {}
}
```

It returns:

```js
{
  source: { id, version },
  candidateRoot,
  why,
  what,
  risks,
  components,
  nets,
  verificationPlan,
  candidateVerification,
  artifactChanges
}
```

An artifact change is:

```js
{
  path,
  operation: 'create' | 'modify' | 'delete',
  beforeHash,
  afterHash,
  beforeBytes,
  afterBytes,
  unifiedDiff
}
```

This is the private candidate-plan shape retained by the approval registry. The panel-facing proposal omits `beforeBytes` and `afterBytes`; it receives paths, operations, hashes, and diffs only.

Rules:

- Paths use the same relative path at plan, write, final-hash, and rollback stages; `path.basename` is not used for nested artifacts.
- This slice accepts UTF-8 transaction-inventory artifacts only. Invalid UTF-8 or an unrecognized candidate file is a proposal blocker.
- Candidate validation runs before registration. KiCad-normalized candidate bytes are hashed only after normalization completes.
- The native source wraps the current generator candidate and labels `what` and `risks` as full project regeneration.
- Native candidates that include a board must execute candidate DRC as well as ERC.
- The live project remains byte-identical while the candidate is produced.
- A combined proposal diff larger than 5 MiB is blocked with `PROPOSAL_DIFF_TOO_LARGE`; it is not silently truncated into an approval that the user cannot fully inspect.

## Change Proposal Contract

```js
{
  schemaVersion: 1,
  proposalId,
  expiresAt,
  baseTransactionDigest,
  source: { id, version },
  why,
  what,
  files,
  components,
  nets,
  risks,
  verificationPlan,
  candidateVerification,
  artifactChanges: [{ path, operation, beforeHash, afterHash, unifiedDiff }],
  contextSummary
}
```

The existing approval registry is extended or renamed rather than duplicated. It retains TTL, single-use behavior, expired tombstones, and candidate disposal.

Proposal rules:

- `proposalId` is content-addressed from base transaction digest, proposal source, normalized context, and after hashes.
- Default TTL remains 15 minutes.
- Reject disposes the candidate immediately.
- Revise cancels the prior proposal and creates a new preview; no separate public revise tool is required.
- `PROJECT_BUSY` and a wrong project do not consume or delete an otherwise valid proposal.
- Engine/provider output cannot set approve, cancel, proposal ID, transaction ID, or rollback controls.
- Skipped candidate verification is `unverified`, never passed.
- A proposal remains reviewable when required candidate verification is unavailable or fails, but Approve is disabled until a fresh candidate passes every required validator.

## Daemon Surface

Avoid nine new public tools. The first slice uses:

- `project.inspect` with an optional trusted panel selection payload;
- existing `schematic.patch` for preview, approve, and cancel;
- new `project.transaction.status`;
- new `project.transaction.rollback`;
- existing `provider.cancel` for active provider work.

`schematic.patch` remains backward compatible at the envelope level. Preview results gain structured proposal fields. Approval results gain transaction and rollback fields. Existing fields remain during the transition.

Provider-emitted `schematic.patch` calls can request a preview only. Existing normalization continues stripping approval/cancel/proposal identifiers. `project.transaction.rollback` and status are not added to `PROVIDER_ALLOWED_TOOLS`.

Additional daemon safety changes in this slice:

- `simulate.spice` ignores request-supplied `ngspicePath` and uses operator-owned configuration;
- direct daemon `validate.erc` and `validate.drc` execute against an inspection copy while preserving their public result shapes;
- direct daemon `schematic.generate` and every `project.request`, including initial generation, return an approval preview instead of writing immediately;
- direct CLI commands retain their current explicit operator behavior;
- provider-emitted nested selection/context fields are stripped; only the outer panel request supplies selection context;
- unknown `tool.result` IDs are ignored and cannot fall back to the active request.

## Project Transaction

### Snapshot acquisition

Proposal generation briefly acquires the project mutex to:

1. canonicalize and validate the project tree;
2. collect the transaction inventory;
3. copy transaction artifacts into an independent candidate root.

The long-running candidate operation occurs after releasing the mutex. Apply later rejects a stale base digest.

### Per-project mutex

The mutex key is the real canonical project path. It covers:

1. base digest and per-path before-hash checks;
2. proposal consume;
3. journal preparation;
4. writes and deletes;
5. after-hash checks;
6. disposable-copy verification;
7. commit or restoration of journal state.

Different canonical projects may transact independently. A competing operation returns `PROJECT_BUSY` without consuming the proposal.

### Apply sequence

1. Locate the active proposal without consuming it.
2. Acquire the project mutex.
3. Re-run tree safety checks.
4. Recompute the transaction digest and every changed path's before hash.
5. Return `PROPOSAL_STALE` without writes if any value differs.
6. Consume the proposal under the lock.
7. Persist a journal with status `prepared` and exact before bytes before the first write.
8. Change journal status to `applying`.
9. For each artifact, create its parent directory, then apply the exact approved bytes or deletion.
10. Catch any exception from any individual operation, restore every before image, verify the before digest, and mark `auto-rolled-back` or `rollback-failed`.
11. Verify after hashes and transaction digest.
12. Build an independent verification copy from the applied live bytes.
13. Run required validators in that copy.
14. On required unavailable/failure, restore and mark `auto-rolled-back` or `rollback-failed`.
15. On success, mark `applied`, retain the journal, and return rollback eligibility.

No `sch upgrade --force` or `pcb drc --refill-zones` command runs against the live project during workbench verification.

### Required verification

```js
requiredOk = result.ok === true && result.skipped !== true && result.executed !== false
```

- A changed schematic requires ERC to execute and pass under the current errors-only ERC contract. Warnings remain visible and affect readiness but do not silently change legacy apply compatibility.
- A changed board requires DRC to execute and pass with zero violations and zero unconnected items.
- A NativeProposalSource candidate that regenerates both schematic and board must pass both.
- A schematic-only proposal in a project that also has an untouched board runs DRC informationally. Existing board failure is reported as `SCHEMATIC_BOARD_PARITY_UNVERIFIED` but does not gate the schematic transaction because schematic-to-board parity is not implemented.
- A missing required tool produces `VERIFICATION_UNAVAILABLE` and automatic restoration.
- Validator selection uses explicit changed artifact paths; directory `readdir` order does not choose the target.

### Durable journal

The journal lives outside the project under an operator-owned ChatPCB state root. Windows defaults to `%LOCALAPPDATA%/OH-MY-ChatPCB/transactions`; tests inject a temporary root.

It stores:

- transaction ID;
- canonical project identity hash;
- before and after transaction digests;
- before bytes for modified/deleted artifacts;
- created artifact paths;
- proposal/source identity;
- verification summary;
- status and timestamps.

Metadata is written atomically and contains no credentials, raw provider transcript, or temporary candidate paths.

Completed journals are retained for 7 days with at most 20 retained journals per canonical project. Oldest eligible completed journals are removed first. `needs-inspection` and `rollback-failed` journals are never removed automatically; they require an explicit recovery resolution.

Journal states are:

```text
prepared
applying
applied
auto-rolled-back
rolled-back
aborted
needs-inspection
rollback-failed
```

### Startup reconciliation

For `prepared` or `applying` journals:

- current digest equals before digest: mark `aborted`;
- current digest equals after digest: mark `applied` and expose rollback;
- otherwise: mark `needs-inspection` and refuse new apply/rollback for that project.

The daemon never guesses a restoration target when the digest matches neither known state.

### Manual rollback

Rollback is allowed only when:

- journal status is `applied`;
- canonical project identity matches;
- current digest equals the recorded after digest;
- the panel's immediate correlated host status reports no unsaved editor changes.

The daemon enforces saved-artifact identity; the panel enforces unsaved-editor state. A later saved edit returns `ROLLBACK_STALE` and is never overwritten.

Successful rollback restores before bytes, removes transaction-created files, verifies the before digest, and marks `rolled-back`. Failure preserves the journal and returns `ROLLBACK_FAILED`.

## Panel Changes

The current card shell remains. This slice adds incrementally:

- selection chips beside the active project;
- coverage/host-state text;
- Why, What, Files, Components, Nets, Risks, and Verification plan sections inside the existing patch approval card;
- per-file collapsible textual diffs;
- a fresh correlated dirty-state check before Approve;
- Reject using the existing cancel request;
- Revise by cancelling the active preview and sending a new request;
- Rollback on the applied-result card when the transaction is eligible;
- Stop only for an invocation that already has a cancellable provider operation.

Full conversation history, panel navigation, and a new visual shell are deferred.

Diff text is inserted with text nodes, never interpreted as HTML. Large diffs are collapsed by file. Existing DOM IDs used by verification remain stable.

## Stable Error Codes

| Code | Meaning |
| --- | --- |
| `KICAD_HOST_TIMEOUT` | Embedded host exists but did not answer. |
| `KICAD_SELECTION_UNSUPPORTED` | No supported selection anchors were captured. |
| `SELECTION_CONNECTIVITY_UNPROVEN` | Selection is usable but connectivity is not proven. |
| `PROPOSAL_MISSING` | Proposal is not registered. |
| `PROPOSAL_EXPIRED` | Proposal TTL elapsed. |
| `PROPOSAL_STALE` | Transaction digest or before hash changed. |
| `PROPOSAL_DIFF_TOO_LARGE` | The full reviewable diff exceeds the bounded proposal surface. |
| `PROJECT_BUSY` | Another project transaction holds the mutex. |
| `TRANSACTION_WRITE_FAILED` | A write failed and restoration ran. |
| `VERIFICATION_UNAVAILABLE` | A required validator did not execute. |
| `VERIFICATION_FAILED` | A required validator executed and failed. |
| `ROLLBACK_STALE` | Saved project changed after apply. |
| `ROLLBACK_FAILED` | Restoration did not reach the expected digest. |
| `TRANSACTION_NEEDS_INSPECTION` | Crash state matches neither known digest. |

Legacy `PATCH_*` codes remain accepted/emitted by the `schematic.patch` facade where required for compatibility. New structured fields carry the corresponding proposal/transaction code.

## Windows and Security Requirements

- Paths with spaces and Korean/Unicode characters remain argument-array or filesystem API values.
- Child process windows stay hidden.
- Canonical roots are verified before recursive copy or restoration.
- Live-project links, junctions, and special files are rejected before proposal or mutation.
- Per-path writes are confined beneath the canonical project root.
- File locks produce typed write failure and all-files restoration.
- `kicadCliPath`, `ngspicePath`, and future engine commands are operator-owned configuration.
- The daemon stays loopback-only and mutations stay under the configured workspace root.
- `project.create.workspaceRoot` is confined to the operator-configured workspace rather than trusting a panel-supplied arbitrary root.
- Host messages use exact IDs; late or malformed messages cannot complete another request.
- Stored journals contain design artifact bytes but no credentials and receive user-only filesystem permissions where the platform permits.

## Follow-Up Copperhead Increment Constraints

The next specification and plan may begin after this core slice passes. It must preserve these decisions:

1. Implement the existing `ProposalSource` contract; do not add an engine-specific panel path.
2. Run Copperhead only in a disposable private Git repository staged from the transaction inventory.
3. Never run Copperhead against the live project.
4. Use CLI subprocess integration first; MCP `0.1.0` remains deferred.
5. Test compatibility range `>=0.10.0 <0.11.0` and record the exact observed version.
6. Run `init --path hardware --no-hooks`; never install hooks into the live project.
7. Configure repository-local Git identity before candidate commits.
8. Set `COPPERHEAD_KICAD_CLI` only when ChatPCB resolves KiCad major version 8 or newer.
9. Use the candidate root as subprocess cwd so Copperhead cannot load a live-project `.env`.
10. Parse per-command JSON schemas: doctor/init results are not `RunResult`; `do` is.
11. Treat `do` outcome `refused` independently from success/failure and do not trust exit code alone.
12. Reject an empty transaction-inventory diff as non-applicable.
13. Derive affected components/nets from before/after ChatPCB analysis; Copperhead `RunResult` does not provide those fields.
14. Do not expose `transcriptDir` or candidate absolute paths to the panel.
15. On Windows, resolve the installed JavaScript entry point and launch it with `process.execPath`, `shell: false`, and an argument array. Do not pass the user request through an npm `.cmd` command string because `cmd.exe` expands percent-delimited text.
16. Add bounded stdout/stderr capture, redaction, operation timeouts, cancellation, and process-tree termination.
17. Treat Copperhead doctor OpenSpec failure as advisory for a candidate without `openspec/config.yaml`; require node, KiCad, Git, and provider readiness.
18. Keep Copperhead source unvendored and separately licensed under Apache-2.0.

## Testing Strategy

### Transaction inventory

- includes `.chatpcb.json`, `.kicad_mod`, and `.kicad_dru`;
- remains deterministic for mixed case and nested Korean/Unicode paths;
- excludes transient reports and `.kicad_prl`;
- rejects links and special files;
- changes digest for every protected artifact byte change.

### Proposal and approval

- Native source returns every required structured field;
- full regeneration is labeled as such;
- nested artifact paths are identical across plan, apply, hash, and rollback;
- preview leaves the live project byte-identical;
- public proposal payloads contain no before/after file bytes;
- oversized diffs are blocked rather than truncated;
- reject, revise, expiry, and single-use behavior dispose candidates;
- busy/wrong-project requests do not burn a valid proposal;
- provider output cannot approve or roll back.

### Project transaction

- create, modify, and delete operations;
- parent directory creation for every path;
- injected exception after each individual operation restores all bytes;
- exact after-hash mismatch restores;
- base digest and per-file stale checks occur under the mutex;
- same-project contention returns `PROJECT_BUSY`;
- different projects operate independently;
- required ERC skip/failure restores;
- required DRC skip/failure restores;
- validators run only in disposable copies;
- board-regenerating native candidate requires DRC;
- schematic-only informational DRC does not masquerade as gating success;
- successful apply persists an `applied` journal;
- manual rollback restores exact before bytes;
- rollback after later saved edits returns `ROLLBACK_STALE`;
- startup reconciliation covers before, after, and unknown digests;
- rollback failure preserves a `rollback-failed` journal.

### Host and context

- correlation ID on status, reload, and selection messages;
- stale response ignored;
- project mismatch ignored;
- standalone, host-timeout, and mock states remain distinct;
- dirty response clears preview;
- symbol/local/global/hierarchical-label normalization;
- unsupported selection diagnostic;
- percent characters cannot corrupt host JavaScript;
- connectivity coverage remains partial and unproven;
- mock tests do not satisfy the compiled-host gate.

### Panel and daemon

- existing named-project and Korean request flow now stops at preview until approval;
- existing patch card renders structured fields and exact diff text;
- diff HTML is not interpreted;
- Approve performs a fresh correlated dirty check;
- Reject and Revise invalidate the prior preview;
- Rollback eligibility and stale state are visible;
- direct daemon ERC/DRC do not mutate live artifacts;
- request `ngspicePath` is ignored;
- unknown result IDs do not fall back to another active request;
- existing CLI behavior remains unchanged.

### Verification commands

Run sequentially on Windows:

```powershell
npm test
npm run verify:panel
npm run verify:ui
```

Do not run the three heavy commands concurrently. The 2026-09-10 baseline produced one non-reproducible Windows temporary-copy failure only under concurrent execution; focused reruns and the sequential full suite passed.

A live KiCad 10 fork build and interactive selection test are required before compiled selection support is documented as implemented. Until the missing checkout is restored, source-contract and mock-host verification are reported separately.

## File-Level Scope

Expected additions:

- `src/context/selection-context.js`
- `src/evidence/transaction-inventory.js`
- `src/workflow/native-proposal-source.js`
- `src/workflow/project-transaction.js`
- `src/runtime/project-mutex-registry.js`
- `src/runtime/transaction-journal.js`
- focused tests for each module

Expected modifications:

- `kicad-fork/chatpcb_panel/chatpcb_panel.h`
- `kicad-fork/chatpcb_panel/chatpcb_panel.cpp`
- `apps/panel/index.html`
- `apps/panel/panel.js`
- `apps/panel/styles.css`
- `src/runtime/agent-daemon.js`
- `src/runtime/patch-approval-registry.js`
- `src/workflow/schematic-patch.js`, which becomes a candidate/facade and stops owning live writes
- `src/workflow/inspect-project.js`
- `src/analyzer/kicad-schematic.js` only for supported label facts
- current panel, daemon, patch, inspection, and KiCad source-contract tests

Files intentionally untouched:

- `src/kicad/project-generator.js`
- `src/kicad/board-route-planner.js`
- `src/runtime/board-profiles.js`
- `src/runtime/circuit-spec.js`
- `src/analyzer/external-adapter.js`
- provider registry definitions

Public README, architecture, and roadmap claims change only after corresponding behavior is implemented and verified. Documentation separates Implemented, Experimental, and Planned states.

## Acceptance Criteria

1. Every daemon/workbench generation or patch writes through `ProjectTransaction`; no daemon validation mutates the live project.
2. A durable journal exists before the first write and supports deterministic startup reconciliation.
3. Write, hash, required ERC, and required DRC failures restore exact prior bytes.
4. Required verification must execute; `skipped: true` is never passed.
5. Proposal consume occurs under the canonical project mutex after stale checks.
6. Transaction digest protects `.chatpcb.json`, footprint modules, design rules, and every apply-eligible artifact.
7. Existing `schematic.patch` envelope requests remain compatible while returning structured proposal/transaction fields.
8. Initial and existing-project panel requests produce a preview before mutation.
9. The existing patch card shows WHY, WHAT, FILES, COMPONENTS, NETS, RISKS, verification plan, and per-file textual diff.
10. A supported schematic selection is correlated to the active project and shown in the panel; connectivity is explicitly unproven.
11. Standalone browser mode still works without pretending a selection was captured; an embedded-host timeout blocks mutation.
12. Approve is blocked by dirty KiCad state, changed transaction digest, or changed before hash.
13. Eligible manual rollback restores exact bytes and refuses after later saved user edits.
14. Provider output cannot approve, apply, or roll back a proposal.
15. Request-supplied KiCad/ngspice executable paths cannot cross the operator-owned configuration boundary.
16. Existing project, provider, inspection, readiness, and CLI behaviors remain compatible except for the intentional new approval gate on daemon/panel generation.
17. Windows spaces, Korean/Unicode paths, junctions, file locks, and concurrent operations have automated coverage.
18. `npm test`, `npm run verify:panel`, and `npm run verify:ui` pass sequentially.
19. Documentation does not claim compiled KiCad selection support until a real KiCad 10 fork build and interactive flow pass.
20. The accepted proposal and transaction contracts are sufficient for the next isolated Copperhead ProposalSource without another panel or write-path redesign.
