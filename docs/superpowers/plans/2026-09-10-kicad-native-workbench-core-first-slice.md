# KiCad-Native Workbench Core First Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a journaled, approval-gated daemon mutation path and expose honest schematic selection context plus structured proposal/diff/rollback controls in the existing KiCad panel.

**Architecture:** Keep the current Node/WebView/daemon runtime. A NativeProposalSource creates a candidate in an isolated directory; an extended approval registry retains the private candidate; ProjectTransaction is the only daemon/workbench writer and persists a rollback journal before touching live artifacts. KiCad selection anchors are joined to deterministic saved-artifact facts with explicitly partial connectivity coverage.

**Tech Stack:** Node.js >=20 ESM, `node:test`, KiCad CLI 10-compatible JSON validation, wxWidgets/KiCad C++ source drop-in, Playwright 1.60.0, PowerShell on Windows.

**Spec:** `docs/superpowers/specs/2026-09-10-kicad-native-workbench-first-slice-design.md`

## Global Constraints

- Copperhead execution is out of this plan; the next increment implements the ProposalSource boundary defined here.
- No external analyzer execution; `ANALYZER_SANDBOX_UNAVAILABLE` remains unchanged.
- No routing, BOM, Gerber, firmware, provider-registry, or ChatPCB3 work.
- Daemon/workbench writes use ProjectTransaction; trusted local CLI behavior stays compatible.
- Required ERC/DRC runs in a disposable copy and passes only when `ok === true` and `skipped !== true`.
- Saved KiCad artifacts remain authoritative; clean ERC/DRC never establishes release readiness.
- The panel shell and its existing DOM IDs remain; add controls and sections incrementally.
- Selection connectivity remains explicitly partial; do not infer symbol pin-to-net connections.
- Worktree symlinks, junctions, special files, dirty KiCad state, and stale artifact digests fail closed.
- Windows spaces, Korean/Unicode paths, `%LOCALAPPDATA%`, file locks, and long paths are first-class tests.
- Do not claim compiled KiCad selection support until a real KiCad 10 fork build and interactive test run.
- Run heavy verification commands sequentially, not concurrently.

## File Structure

### New modules

- `src/evidence/transaction-inventory.js`: transaction artifact allowlist, deterministic digest, and byte snapshot.
- `src/runtime/project-mutex-registry.js`: canonical-path, reject-on-contention project mutex.
- `src/runtime/transaction-journal.js`: durable atomic journal, retention, and crash reconciliation.
- `src/workflow/project-transaction.js`: apply, required verification, automatic restoration, manual rollback.
- `src/workflow/native-proposal-source.js`: isolated native candidate, structured proposal, private/public change shapes.
- `src/context/selection-context.js`: host selection normalization and deterministic-fact filtering.

### Existing files with focused changes

- `src/runtime/patch-approval-registry.js`: add non-consuming lookup; consume only after lock; wrong project does not destroy the proposal.
- `src/workflow/schematic-patch.js`: retain compatibility exports but delegate candidate creation and writes.
- `src/workflow/inspect-project.js`: accept selection context and expose safe validation-copy helpers.
- `src/workflow/validate-project.js`, `src/workflow/validate-board.js`: allow explicit validation artifact paths without changing CLI defaults.
- `src/analyzer/kicad-schematic.js`: deterministic local/global/hierarchical label facts.
- `src/runtime/agent-daemon.js`: wire proposal/transaction services and remove alternate live mutation paths.
- `kicad-fork/chatpcb_panel/*`: correlated status/reload/selection host messages.
- `apps/panel/*`: incremental selection, proposal, diff, stop, revise, and rollback UI.
- `scripts/verify-panel-flow.js`, `scripts/verify-panel-ui.js`: approval-first flow and mock selection contract.

---

### Task 1: Transaction Artifact Inventory and Snapshot

**Files:**

- Create: `src/evidence/transaction-inventory.js`
- Create: `tests/transaction-inventory.test.js`
- Reuse: `src/workflow/inspection-copy.js`

**Interfaces:**

- Produces `collectTransactionInventory({ projectDir }) -> Promise<{ projectDir, transactionDigest, artifacts }>`.
- Produces `collectTransactionSnapshot({ projectDir }) -> Promise<{ projectDir, transactionDigest, artifacts, files }>`.
- `artifacts` entries are `{ path, kind, sha256, size }`; `files` entries add `bytes: Buffer`.
- Paths are project-relative POSIX strings and sorted by Unicode code point.

- [ ] **Step 1: Write allowlist, ordering, and digest tests**

Create a temporary project containing `.kicad_pro`, root and nested `.kicad_sch`, `.kicad_pcb`, `.kicad_sym`, `.kicad_mod`, `.kicad_dru`, `.chatpcb.json`, `.cir`, both library tables, `.kicad_prl`, and ERC/DRC reports. Assert the first ten kinds are included, transient/report files are excluded, paths use `/`, and repeated inventories are byte-identical.

```js
const first = await collectTransactionInventory({ projectDir: root });
const second = await collectTransactionInventory({ projectDir: root });
assert.deepEqual(second, first);
assert.ok(first.artifacts.some((item) => item.path === 'nested/전원.kicad_sch'));
assert.ok(first.artifacts.some((item) => item.path.endsWith('.chatpcb.json')));
assert.ok(first.artifacts.some((item) => item.path.endsWith('.kicad_mod')));
assert.ok(first.artifacts.some((item) => item.path.endsWith('.kicad_dru')));
assert.ok(!first.artifacts.some((item) => item.path.endsWith('.kicad_prl')));
assert.ok(!first.artifacts.some((item) => item.path === 'chatpcb-erc.json'));
```

- [ ] **Step 2: Run the focused test and verify the missing module failure**

Run: `node --test tests/transaction-inventory.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/evidence/transaction-inventory.js`.

- [ ] **Step 3: Implement classification and deterministic inventory**

Implement these exports:

```js
export function transactionArtifactKind(relativePath) {
  const normalized = relativePath.split(path.sep).join('/');
  if (normalized.endsWith('.chatpcb.json')) return 'chatpcb-manifest';
  if (path.posix.basename(normalized) === 'sym-lib-table') return 'symbol-table';
  if (path.posix.basename(normalized) === 'fp-lib-table') return 'footprint-table';
  return TRANSACTION_EXTENSIONS.get(path.posix.extname(normalized)) ?? null;
}

export async function collectTransactionInventory({ projectDir }) {
  const snapshot = await collectTransactionSnapshot({ projectDir });
  return {
    projectDir: snapshot.projectDir,
    transactionDigest: snapshot.transactionDigest,
    artifacts: snapshot.artifacts
  };
}
```

Use `assertInspectionTree(projectDir)` before walking. Read bytes once, hash those exact bytes, use their length for `size`, and hash canonical JSON of the sorted metadata for `transactionDigest`.

- [ ] **Step 4: Add mutation and unsafe-tree tests**

Change one byte in each protected extension in table-driven subtests and assert the digest changes. Create a symlink on POSIX and a junction through the existing Windows test helper pattern in `tests/kicad-validation-boundary.test.js`; assert `UNSAFE_INSPECTION_LINK` before any bytes are returned.

- [ ] **Step 5: Run focused and adjacent tests**

Run: `node --test tests/transaction-inventory.test.js tests/artifact-inventory.test.js tests/kicad-validation-boundary.test.js`

Expected: PASS; the existing Windows-only expected skip may remain.

- [ ] **Step 6: Commit**

```powershell
git add src/evidence/transaction-inventory.js tests/transaction-inventory.test.js
git commit -m "feat: add transaction artifact inventory"
```

---

### Task 2: Canonical Project Mutex and Non-Destructive Proposal Lookup

**Files:**

- Create: `src/runtime/project-mutex-registry.js`
- Create: `tests/project-mutex-registry.test.js`
- Modify: `src/runtime/patch-approval-registry.js:63-105`
- Modify: `tests/patch-approval-registry.test.js`

**Interfaces:**

- Produces `createProjectMutexRegistry({ realpathImpl } = {})` with `runExclusive({ projectDir }, work)` and `isLocked({ projectDir })`.
- Extends the approval registry with `peek({ patchId, projectDir })`.
- `peek` never consumes; `consume` removes only a matching, active record.

- [ ] **Step 1: Write mutex contention and cleanup tests**

```js
const registry = createProjectMutexRegistry();
let release;
const first = registry.runExclusive({ projectDir: root }, async () => {
  await new Promise((resolve) => { release = resolve; });
  return 'first';
});
await assert.rejects(
  registry.runExclusive({ projectDir: root }, async () => 'second'),
  { code: 'PROJECT_BUSY' }
);
release();
assert.equal(await first, 'first');
assert.equal(await registry.runExclusive({ projectDir: root }, async () => 'third'), 'third');
```

Also assert two different projects run concurrently and an exception releases the lock.

- [ ] **Step 2: Run the mutex test and verify failure**

Run: `node --test tests/project-mutex-registry.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement the canonical mutex**

Use `realpath` for existing project directories. Return typed errors:

```js
function projectBusy(projectDir) {
  const error = new Error(`Another ChatPCB transaction is active for ${projectDir}.`);
  error.code = 'PROJECT_BUSY';
  return error;
}
```

Add the canonical key before calling `work` and remove it in `finally`.

- [ ] **Step 4: Write approval peek and wrong-project retention tests**

Register one record, call `peek` from the correct project twice, call `peek` and `consume` from a different project, then consume from the correct project. Assert the wrong-project calls return `PATCH_STALE` without disposal or deletion.

- [ ] **Step 5: Implement `peek` and correct consume semantics**

Factor active-record validation into one helper. `peek` returns `{ ok: true, record }`. Expiry still disposes. A project mismatch returns a failure without `remove(record)`. Matching `consume` deletes the map entry and clears its active timer.

- [ ] **Step 6: Run focused tests**

Run: `node --test tests/project-mutex-registry.test.js tests/patch-approval-registry.test.js`

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/runtime/project-mutex-registry.js src/runtime/patch-approval-registry.js tests/project-mutex-registry.test.js tests/patch-approval-registry.test.js
git commit -m "feat: serialize project proposals safely"
```

---

### Task 3: Durable Transaction Journal and Crash Reconciliation

**Files:**

- Create: `src/runtime/transaction-journal.js`
- Create: `tests/transaction-journal.test.js`

**Interfaces:**

- Produces `createTransactionJournal({ stateRoot, now, retentionMs, maxPerProject } = {})`.
- Methods: `prepare(record)`, `transition({ transactionId, status, patch })`, `get({ transactionId })`, `list({ projectDir })`, `reconcile({ projectDir, collectInventoryImpl })`, `prune({ projectDir })`.
- Journal file schema is version 1; before bytes are base64 strings with their hashes.

- [ ] **Step 1: Write atomic persistence and permission tests**

```js
const journal = createTransactionJournal({ stateRoot, now: () => 1000 });
const record = await journal.prepare({
  projectDir: root,
  beforeTransactionDigest: 'before',
  afterTransactionDigest: 'after',
  changes: [{ path: 'demo.kicad_sch', operation: 'modify', beforeBytes: Buffer.from('old'), beforeHash: 'old-hash' }],
  proposal: { proposalId: 'sha256:test', source: { id: 'native', version: '1' } }
});
assert.equal(record.status, 'prepared');
assert.equal((await journal.get({ transactionId: record.transactionId })).changes[0].beforeBase64, Buffer.from('old').toString('base64'));
```

Assert no temporary metadata file remains after the atomic rename.

- [ ] **Step 2: Run the test and verify failure**

Run: `node --test tests/transaction-journal.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement state-root and atomic journal writes**

Use a canonical project identity hash for directory placement. Create directories with mode `0o700` and metadata with mode `0o600` where supported. Write JSON to a sibling temporary file, then `rename` to `<transactionId>.json`.

```js
const transactionId = `txn_${randomUUID()}`;
const projectKey = createHash('sha256').update(canonicalProjectDir).digest('hex');
```

Validate every transition against the allowed state set and preserve immutable identity/digest fields.

- [ ] **Step 4: Write reconciliation tests for every crash state**

Prepare `prepared` and `applying` records. Inject inventory results equal to the before digest, after digest, and an unrelated digest. Assert transitions to `aborted`, `applied`, and `needs-inspection`. Assert `needs-inspection` survives pruning.

- [ ] **Step 5: Implement reconciliation and retention**

Keep at most 20 eligible completed journals per project and delete eligible journals older than 7 days. Never automatically prune `needs-inspection` or `rollback-failed`.

- [ ] **Step 6: Run focused tests**

Run: `node --test tests/transaction-journal.test.js tests/transaction-inventory.test.js`

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/runtime/transaction-journal.js tests/transaction-journal.test.js
git commit -m "feat: persist project transaction journals"
```

---

### Task 4: Transactional Apply, Verification, and Manual Rollback

**Files:**

- Create: `src/workflow/project-transaction.js`
- Create: `tests/project-transaction.test.js`
- Modify: `src/workflow/validate-project.js:7-92`
- Modify: `src/workflow/validate-board.js:7-91`
- Modify: `tests/validate-project.test.js`
- Modify: `tests/validate-board.test.js`

**Interfaces:**

- Produces `applyProjectTransaction({ projectDir, proposalId, approvalRegistry, mutexRegistry, journal, inspectAppliedProjectImpl, fsImpl })`.
- Produces `rollbackProjectTransaction({ projectDir, transactionId, mutexRegistry, journal, collectSnapshotImpl, fsImpl })`.
- Adds optional `schematicPath` to `validateProject` and `boardPath` to `validateBoard`; absence retains current first-file CLI behavior.

- [ ] **Step 1: Add explicit validation-target tests**

Create two schematic/board files and pass an explicit target. Assert the generated KiCad CLI argument list contains the supplied path, not the first `readdir` result. Existing no-target tests must stay unchanged.

- [ ] **Step 2: Implement explicit validation targets**

Resolve explicit paths beneath `projectDir`; reject traversal. Otherwise call the existing `findFirst`. Do not change skipped-result shapes in the public validators.

- [ ] **Step 3: Write the successful transaction test**

Build a proposal registry record with one modified schematic and one new `.chatpcb.json`. Inject passing ERC inspection and a temporary journal.

```js
const result = await applyProjectTransaction({
  projectDir: root,
  proposalId: plan.proposalId,
  approvalRegistry,
  mutexRegistry,
  journal,
  inspectAppliedProjectImpl: async () => ({
    validation: { erc: { ok: true, skipped: false, executed: true, erc: { errorCount: 0, warningCount: 0 } }, drc: { ok: true, skipped: true } }
  })
});
assert.equal(result.applied, true);
assert.equal(result.transaction.status, 'applied');
assert.equal(await readFile(schematic, 'utf8'), 'after');
```

- [ ] **Step 4: Run the transaction test and verify failure**

Run: `node --test tests/project-transaction.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 5: Implement path-confined writes and all-files restoration**

Inside `mutexRegistry.runExclusive`, peek, check base digest and every `beforeHash`, consume, journal `prepared`, transition to `applying`, and apply each create/modify/delete. Call `mkdir(path.dirname(target), { recursive: true })` for every created or modified path. A catch block restores every before byte and removes created paths, then verifies the before digest.

Use one helper for restoration from both automatic and manual paths:

```js
async function restoreChanges({ projectDir, changes, fsImpl }) {
  for (const change of changes.toReversed()) {
    const target = resolveTransactionPath(projectDir, change.path);
    if (change.beforeBytes === null) await fsImpl.rm(target, { force: true });
    else {
      await fsImpl.mkdir(path.dirname(target), { recursive: true });
      await fsImpl.writeFile(target, change.beforeBytes);
    }
  }
}
```

- [ ] **Step 6: Implement skip-aware required verification**

Determine validation targets from changed artifacts. Require ERC for changed `.kicad_sch`; require DRC for changed `.kicad_pcb`. `ok: true, skipped: true` becomes `VERIFICATION_UNAVAILABLE`. Verification receives a copied applied state through `inspectAppliedProjectImpl`; it never runs upgrade/refill against the live path.

- [ ] **Step 7: Add table-driven failure injection tests**

Cover stale transaction digest, stale before hash, create failure, second-write failure, delete failure, after-hash mismatch, required ERC skip/failure, and required DRC skip/failure. For every row, assert exact before bytes and journal state `auto-rolled-back`; inject restoration failure and assert `rollback-failed` plus preserved journal.

- [ ] **Step 8: Add manual rollback and crash-block tests**

Apply successfully, then call rollback and assert the before digest. Edit a file after apply and assert `ROLLBACK_STALE`. Seed `needs-inspection` and assert both apply and rollback return `TRANSACTION_NEEDS_INSPECTION`.

- [ ] **Step 9: Run focused tests**

Run: `node --test tests/project-transaction.test.js tests/validate-project.test.js tests/validate-board.test.js tests/transaction-journal.test.js`

Expected: PASS.

- [ ] **Step 10: Commit**

```powershell
git add src/workflow/project-transaction.js src/workflow/validate-project.js src/workflow/validate-board.js tests/project-transaction.test.js tests/validate-project.test.js tests/validate-board.test.js
git commit -m "feat: apply and roll back project transactions"
```

---

### Task 5: Native Structured Proposal and Legacy Patch Facade

**Files:**

- Create: `src/workflow/native-proposal-source.js`
- Create: `tests/native-proposal-source.test.js`
- Modify: `src/workflow/schematic-patch.js`
- Modify: `tests/schematic-patch.test.js`

**Interfaces:**

- Produces `createNativeProposal({ projectDir, request, projectName, context, validateCandidateImpl })`.
- Produces `publicProposal(plan)` without candidate paths or file bytes.
- Preserves `createSchematicPatchPlan`, `disposeSchematicPatchPlan`, and `applySchematicPatch` exports as compatibility facades.
- Private plan fields match ProjectTransaction: `proposalId`, `baseTransactionDigest`, `afterTransactionDigest`, `changes`, `requiredValidation`.

- [ ] **Step 1: Write structured proposal and live-immutability tests**

Assert preview returns non-empty `why`, `what`, `files`, `components`, `nets`, `risks`, `verificationPlan`, `candidateVerification`, and per-file diff. Snapshot the live tree before/after and assert equality. Assert public JSON contains no `beforeBytes`, `afterBytes`, `candidateRoot`, or temp path.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `node --test tests/native-proposal-source.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Extract candidate generation from `schematic-patch.js`**

Copy only transaction-inventory artifacts into a canonical temporary candidate. Run `generateMcuPeripheralProject` there. Collect after snapshot after candidate validation has normalized bytes. Build a union of before/after paths and create `create`, `modify`, and `delete` changes with stable relative paths.

Set native proposal language explicitly:

```js
const what = 'Regenerate the supported ChatPCB project artifact set from the requested circuit specification.';
const risks = [
  'This NativeProposalSource performs full project regeneration rather than a surgical selection edit.',
  'Selection connectivity is not proven by the current analyzer.'
];
```

- [ ] **Step 4: Add content-addressing, nested path, diff limit, and DRC tests**

Assert repeated identical inputs produce the same proposal ID. Add a nested sheet and prove final comparison uses its relative path. Generate a supported profile containing a board and assert candidate validation requests ERC and DRC. Inject a diff over 5 MiB and assert `PROPOSAL_DIFF_TOO_LARGE`.

- [ ] **Step 5: Refactor schematic patch compatibility exports**

`createSchematicPatchPlan` delegates to `createNativeProposal`. Preview maps the structured public proposal back onto existing fields (`patchId`, `changedFiles`, `diff`, `files`, `validation`, `review`). Approved apply delegates to `applyProjectTransaction`; remove direct `writePlannedFiles`, `snapshotFiles`, and `restoreSnapshots` ownership from this module.

- [ ] **Step 6: Update legacy patch tests**

Keep envelope-visible preview/apply/cancel/stale assertions. Replace the old pre-write “rolls back when validation fails” test with candidate-verification-disabled approval plus transaction write/verification restoration tests from Task 4. Assert legacy `PATCH_*` codes remain where documented.

- [ ] **Step 7: Run focused tests**

Run: `node --test tests/native-proposal-source.test.js tests/schematic-patch.test.js tests/project-transaction.test.js`

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add src/workflow/native-proposal-source.js src/workflow/schematic-patch.js tests/native-proposal-source.test.js tests/schematic-patch.test.js
git commit -m "feat: return structured native change proposals"
```

---

### Task 6: Daemon Workbench Mutation Boundary

**Files:**

- Modify: `src/runtime/agent-daemon.js`
- Modify: `src/workflow/simulate-project.js`
- Modify: `tests/daemon.test.js`
- Modify: `tests/simulate-project.test.js`

**Interfaces:**

- `startDaemon` creates one approval registry, mutex registry, and transaction journal from trusted `dispatchOptions`.
- Adds `project.transaction.status` and `project.transaction.rollback` direct daemon tools.
- `schematic.generate`, `project.request`, and provider-generated changes return previews until direct panel approval.
- Direct daemon ERC/DRC results retain their existing result shapes but execute through an inspection copy.

- [ ] **Step 1: Write failing daemon safety tests**

Add tests proving:

- initial `project.request` returns `requiresApproval: true` and writes no KiCad artifacts;
- daemon `schematic.generate` also previews;
- direct daemon ERC/DRC validator mutations never reach the source directory;
- `simulate.spice` ignores request `ngspicePath` and receives only configured `dispatchOptions.ngspicePath`;
- provider-emitted approval, rollback, nested selection, and executable fields are stripped;
- rollback/status are unavailable through provider allowed tools;
- configured `allowedWorkspaceRoot` owns `project.create` placement.

- [ ] **Step 2: Run the daemon tests and confirm behavioral failures**

Run: `node --test tests/daemon.test.js tests/simulate-project.test.js`

Expected: FAIL because generation currently writes immediately, direct validation uses the live path, and ngspice accepts request input.

- [ ] **Step 3: Construct shared workbench services in `startDaemon`**

```js
const projectMutexRegistry = dispatchOptions.projectMutexRegistry ?? createProjectMutexRegistry();
const transactionJournal = dispatchOptions.transactionJournal ?? createTransactionJournal({
  stateRoot: dispatchOptions.transactionStateRoot
});
```

Pass services through every recursive `dispatchToolCall`. Reconcile configured workspace projects lazily when status/apply/rollback first addresses them; do not scan the entire filesystem at startup.

- [ ] **Step 4: Route patch approval through ProjectTransaction**

Preview registers the private native plan and returns `publicProposal`. Approval calls `applyProjectTransaction`; cancel consumes/disposes only its matching proposal. Add status/rollback cases that never enter `PROVIDER_ALLOWED_TOOLS`.

- [ ] **Step 5: Replace generation and request live writes with previews**

For both new and existing project directories, provider tool calls may influence the prompt or return a preview, but the daemon never treats an engine/provider result as applied. Remove `snapshotProject` and `restoreProjectSnapshot` after all request failure tests prove the source remains unchanged without them.

- [ ] **Step 6: Make daemon validation read-only and executable selection trusted**

Use `inspectProjectImpl` to obtain ERC/DRC from a checked copy for daemon tools. Pass `ngspicePath` from dispatch configuration exactly like `kicadCliPath`; delete/ignore it in `withProjectContext`.

- [ ] **Step 7: Run focused boundary tests**

Run: `node --test tests/daemon.test.js tests/kicad-validation-boundary.test.js tests/simulate-project.test.js tests/project-transaction.test.js`

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add src/runtime/agent-daemon.js src/workflow/simulate-project.js tests/daemon.test.js tests/simulate-project.test.js
git commit -m "feat: enforce daemon proposal transactions"
```

---

### Task 7: Saved-Artifact Selection Context

**Files:**

- Create: `src/context/selection-context.js`
- Create: `tests/selection-context.test.js`
- Modify: `src/analyzer/kicad-schematic.js`
- Modify: `tests/kicad-schematic.test.js`
- Modify: `src/workflow/inspect-project.js`
- Modify: `tests/inspect-project.test.js`

**Interfaces:**

- Produces `normalizeSelectionContext(selection) -> { editor, sheet, dirty, hostState, items, diagnostics }`.
- Produces `buildSelectionEvidence({ selection, inspection }) -> { selection, facts, findings, coverage }`.
- `inspectProject({ selection })` adds `context` without changing existing top-level fields.

- [ ] **Step 1: Add global and hierarchical label analyzer tests**

Use a minimal valid schematic with `(label ...)`, `(global_label ...)`, and `(hierarchical_label ...)`. Assert deterministic facts preserve label kind, text, position, and ordering; empty text or malformed positions return `ANALYZER_PARSE_ERROR` without fabricated facts.

- [ ] **Step 2: Implement label-family parsing**

Factor label extraction over these node names:

```js
const LABEL_NODES = new Map([
  ['label', 'schematic.label'],
  ['global_label', 'schematic.global_label'],
  ['hierarchical_label', 'schematic.hierarchical_label']
]);
```

Build net facts from all valid label families while preserving each label fact ID. Do not add pin-to-net facts.

- [ ] **Step 3: Write selection normalization and filtering tests**

Cover symbol UUID/reference match, local/global/hierarchical label text match, unsupported item omission, duplicate anchor collapse, invalid coordinates, project/host state, related finding retention, and a mandatory `SELECTION_CONNECTIVITY_UNPROVEN` diagnostic.

- [ ] **Step 4: Run the selection test and verify missing-module failure**

Run: `node --test tests/selection-context.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 5: Implement context normalization and fact filtering**

Use a closed set of host item kinds. Trim strings, require finite numeric positions, sort anchors deterministically, and freeze no caller-owned objects. Retain facts only when identity/text matches; retain findings only when every referenced fact remains present.

```js
const coverage = {
  status: 'partial',
  diagnostics: [{
    code: 'SELECTION_CONNECTIVITY_UNPROVEN',
    message: 'Pin-to-net connectivity is not proven by the current saved-artifact analyzer.'
  }]
};
```

- [ ] **Step 6: Integrate optional selection into inspection**

After bound facts/findings are finalized, attach `context: buildSelectionEvidence(...)` only when `options.selection` is present. Add `transactionDigest` from Task 1 to the context project block without changing evidence freshness calculations.

- [ ] **Step 7: Run focused analyzer/inspection tests**

Run: `node --test tests/selection-context.test.js tests/kicad-schematic.test.js tests/project-analyzer.test.js tests/inspect-project.test.js`

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add src/context/selection-context.js src/analyzer/kicad-schematic.js src/workflow/inspect-project.js tests/selection-context.test.js tests/kicad-schematic.test.js tests/inspect-project.test.js
git commit -m "feat: build evidence for KiCad selections"
```

---

### Task 8: Correlated KiCad Schematic Host Selection Protocol

**Files:**

- Modify: `kicad-fork/chatpcb_panel/chatpcb_panel.h`
- Modify: `kicad-fork/chatpcb_panel/chatpcb_panel.cpp`
- Modify: `tests/kicad-fork.test.js`
- Modify: `docs/KICAD_FORK_BOOTSTRAP.md`

**Interfaces:**

- Adds `BuildSelectionContext(requestId, projectPath)` and selection request handling.
- Every host response echoes request ID when present.
- Uses official KiCad 10 APIs verified in source: `GetToolManager()->GetTool<SCH_SELECTION_TOOL>()->GetSelection()`, `m_Uuid`, `SCH_SYMBOL::GetRef(&sheet, false)`, `SCH_LABEL_BASE::GetShownText(&sheet, false)`, `GetPosition()`, `schIUScale.IUTomm`, and `GetCurrentSheet()`.

- [ ] **Step 1: Expand source-contract tests first**

Assert the C++ source contains:

- `selection.get` and `selection.context`;
- `SCH_SELECTION_TOOL` and `GetSelection()`;
- cases for `SCH_SYMBOL_T`, `SCH_LABEL_T`, `SCH_GLOBAL_LABEL_T`, and `SCH_HIER_LABEL_T`;
- `m_Uuid.AsString()`;
- `GetRef( &sheet, false )` and `GetShownText( &sheet, false )`;
- `schIUScale.IUTomm`;
- echoed `requestId` for status/reload/selection;
- no `wxString::Format` call whose format includes serialized JSON.

- [ ] **Step 2: Run the source-contract test and verify failure**

Run: `node --test tests/kicad-fork.test.js`

Expected: FAIL on missing selection protocol assertions.

- [ ] **Step 3: Implement correlated host responses**

Read `requestId` once in `OnScriptMessage` and add it to response JSON when non-empty. Preserve old request compatibility. Construct postMessage script through concatenation:

```cpp
const wxString payload = wxString::FromUTF8( aEvent.dump() );
const wxString script = wxT( "window.postMessage(" ) + payload + wxT( ", '*');" );
m_webView->RunScriptAsync( script );
```

- [ ] **Step 4: Implement selection capture for supported item types**

Include `<tool/tool_manager.h>`, `<tools/sch_selection_tool.h>`, `<sch_symbol.h>`, `<sch_label.h>`, and `<base_units.h>`. Retrieve the current `SCH_SELECTION`, current sheet, KIID, reference/text, and converted position. Emit unsupported item diagnostics without dereferencing unknown types.

- [ ] **Step 5: Document the uncompiled boundary honestly**

Update the bootstrap document with the message shape, supported types, and a status note: source contract verified; compiled KiCad 10 selection remains unverified until the missing fork checkout is restored. Do not state that interactive selection works.

- [ ] **Step 6: Run the focused test and formatting check**

Run: `node --test tests/kicad-fork.test.js`

Run: `git diff --check`

Expected: PASS. Record compiled-host verification as unavailable, not passed.

- [ ] **Step 7: Commit**

```powershell
git add kicad-fork/chatpcb_panel/chatpcb_panel.h kicad-fork/chatpcb_panel/chatpcb_panel.cpp tests/kicad-fork.test.js docs/KICAD_FORK_BOOTSTRAP.md
git commit -m "feat: expose schematic selection context"
```

---

### Task 9: Incremental Panel Proposal, Diff, Approval, and Rollback UX

**Files:**

- Modify: `apps/panel/index.html`
- Modify: `apps/panel/panel.js`
- Modify: `apps/panel/styles.css`
- Modify: `tests/panel-assets.test.js`
- Modify: `scripts/verify-panel-flow.js`
- Modify: `scripts/verify-panel-ui.js`
- Modify: `tests/panel-flow-verifier.test.js`
- Modify: `tests/panel-ui-verifier.test.js`

**Interfaces:**

- Keeps existing DOM IDs and adds selection/proposal/rollback IDs.
- Uses exact pending call IDs; no active-request fallback.
- Sends selection only as the outer panel `project.request` argument.
- Approve awaits a fresh correlated `project.status` before sending `schematic.patch` approval.

- [ ] **Step 1: Add panel asset contract assertions**

Assert markup contains selection summary, coverage, proposal Why/What/Files/Components/Nets/Risks/Verification plan, diff container, Revise, Stop, and Rollback controls. Assert script contains `project.transaction.rollback`, exact pending ID lookup, and no `pendingCalls.get(id) ??` fallback.

- [ ] **Step 2: Update the mock-host E2E expectation before production code**

Change the fake host to echo request IDs and return one selected `U1` plus global label `+3V3`. Change initial Send expectation from generated/applied to proposal preview with no live artifact change. Then click Approve, return a passing schematic-only transaction, assert structured proposal/diff was visible before apply, and click Rollback to restore the fixture bytes.

- [ ] **Step 3: Run panel tests and confirm failure**

Run: `node --test tests/panel-assets.test.js tests/panel-flow-verifier.test.js tests/panel-ui-verifier.test.js`

Expected: FAIL on missing controls and old generation behavior.

- [ ] **Step 4: Add incremental markup and safe rendering**

Add sections inside the existing patch card. Render every server string through `textContent`; create one `<details>` per changed file and one `<pre>` for its unified diff. Never assign proposal text to `innerHTML`.

- [ ] **Step 5: Replace host request state with correlation IDs**

Implement one `pendingHostRequests` map keyed by request ID. Distinguish absent host (`standalone`) from present-but-timed-out host (`KICAD_HOST_TIMEOUT`). Ignore responses whose ID or project path does not match.

- [ ] **Step 6: Capture selection on project activation and before Send**

Request `selection.get`, render selection chips, and attach normalized selection to the outer request. Embedded timeout blocks mutation; standalone mode sends a project-scoped request with visible selection-unavailable status.

- [ ] **Step 7: Implement proposal actions**

- Approve: fresh status check, then existing `schematic.patch` approval.
- Reject: existing cancel request and dispose UI state.
- Revise: cancel the current proposal, keep request text, and send the replacement request only after the cancel result confirms candidate disposal.
- Stop: send existing `provider.cancel` for the current invocation ID.
- Rollback: fresh dirty check, then `project.transaction.rollback` with transaction ID.

Unknown tool-result IDs are ignored and cannot complete project creation/request.

- [ ] **Step 8: Run browser and flow verification sequentially**

Run: `npm run verify:panel`

Run after completion: `npm run verify:ui`

Expected: both PASS; output identifies approval-first proposal flow, selected context, exact diff, apply, and rollback.

- [ ] **Step 9: Run focused unit tests**

Run: `node --test tests/panel-assets.test.js tests/panel-flow-verifier.test.js tests/panel-ui-verifier.test.js tests/daemon.test.js`

Expected: PASS.

- [ ] **Step 10: Commit**

```powershell
git add apps/panel/index.html apps/panel/panel.js apps/panel/styles.css scripts/verify-panel-flow.js scripts/verify-panel-ui.js tests/panel-assets.test.js tests/panel-flow-verifier.test.js tests/panel-ui-verifier.test.js
git commit -m "feat: review and roll back changes in panel"
```

---

### Task 10: Documentation, Full Verification, and Review Gate

**Files:**

- Modify: `README.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/ROADMAP.md`
- Modify: `docs/handoff-next-session.md` only with a concise new dated entry
- Modify: `tests/phase1-docs.test.js`

**Interfaces:**

- Documents Implemented, Experimental, and Planned separately.
- Compiled KiCad selection remains Experimental/Unverified until a real build runs.
- Copperhead adapter remains Planned with its isolated ProposalSource boundary.

- [ ] **Step 1: Write documentation contract assertions**

Add assertions that public docs name:

- transaction journal and rollback;
- selection connectivity as partial/unproven;
- proposal-first daemon behavior;
- Copperhead adapter as planned, isolated, and not MCP-first;
- source-contract versus compiled KiCad verification status;
- ERC/DRC skip as unverified for workbench apply.

- [ ] **Step 2: Run docs tests and confirm failure**

Run: `node --test tests/phase1-docs.test.js`

Expected: FAIL on missing delivered-work language.

- [ ] **Step 3: Update docs to actual delivered behavior**

Keep historical plans/specs unchanged. Add one concise handoff entry with exact verification evidence. Do not claim Copperhead execution, pin-to-net context, PCB selection, simulation comparison, or a compiled KiCad host.

- [ ] **Step 4: Run focused safety and integration suites**

Run: `node --test tests/transaction-inventory.test.js tests/project-mutex-registry.test.js tests/transaction-journal.test.js tests/project-transaction.test.js tests/native-proposal-source.test.js tests/schematic-patch.test.js tests/daemon.test.js tests/selection-context.test.js tests/inspect-project.test.js tests/kicad-fork.test.js tests/panel-assets.test.js`

Expected: PASS with zero failures.

- [ ] **Step 5: Run the complete Node suite**

Run: `npm test`

Expected: PASS with zero failures; report the exact pass/skip counts from fresh output.

- [ ] **Step 6: Run panel verification sequentially**

Run: `npm run verify:panel`

Run after it exits: `npm run verify:ui`

Expected: both PASS. Do not run concurrently.

- [ ] **Step 7: Inspect the complete branch diff**

Run: `git diff --check`

Run: `git status --short --branch`

Run: `git diff --stat bdcaded..HEAD`

Expected: no whitespace errors; only planned product, test, and documentation paths changed; no Copperhead source, workspace fixture dump, provider registry expansion, or unrelated worktree content.

- [ ] **Step 8: Run an Orca-supervised Grok 4.6 xhigh adversarial review**

Review the complete `bdcaded..HEAD` diff for partial writes, skipped verification, stale approval consumption, journal recovery, Windows file locks/paths, host correlation, unsafe HTML, provider privilege escalation, and accidental documentation overclaims. Fix validated findings with focused regression tests and repeat affected verification.

- [ ] **Step 9: Re-run the full gate and commit adversarial-review corrections if present**

After every validated finding is fixed, run `npm test`, `npm run verify:panel`, and `npm run verify:ui` sequentially again. Then inspect and stage only plan-scoped implementation/test paths:

```powershell
git add -- src tests apps/panel kicad-fork scripts
git diff --cached --check
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) { git commit -m "fix: address workbench adversarial review" }
```

- [ ] **Step 10: Commit final documentation**

```powershell
git add README.md docs/ARCHITECTURE.md docs/ROADMAP.md docs/handoff-next-session.md tests/phase1-docs.test.js
git commit -m "docs: describe KiCad-native workbench core"
```

- [ ] **Step 11: Record the next design boundary**

After all acceptance evidence is green, begin a separate Copperhead ProposalSource design/plan using the 18 constraints in the approved spec. Do not add Copperhead code opportunistically to this branch before the core review gate closes.

## Plan Self-Review

- Every first-slice requirement maps to a task: transaction safety Tasks 1-6, context Tasks 7-8, panel interaction Task 9, truthful documentation and final gates Task 10.
- Function and field names are consistent across tasks: `transactionDigest`, `proposalId`, `ProjectTransaction`, `ProposalSource`, `project.transaction.status`, and `project.transaction.rollback`.
- Copperhead, routing, manufacturing, provider expansion, schema migration, and full panel redesign are excluded from implementation while their future boundary remains explicit.
- No task relies on the missing KiCad checkout to claim success; source-contract and compiled-host evidence remain separate.
