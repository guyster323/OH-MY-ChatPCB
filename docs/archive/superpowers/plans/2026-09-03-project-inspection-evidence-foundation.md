# Project Inspection and Evidence Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic saved-project inspection, versioned evidence metadata, freshness checks, and artifact-bound patch approval without changing KiCad as the source of editable design state.

**Architecture:** New evidence modules hash and classify saved KiCad artifacts. `inspectProject()` combines that stable inventory with the existing ERC/DRC adapters, while `.chatpcb.json` schema normalization reports legacy, current, or stale evidence. Patch previews gain a content-derived ID; apply fails closed if the project or candidate changed after approval.

**Tech Stack:** Node.js 20+, ES modules, `node:test`, SHA-256 from `node:crypto`, existing KiCad CLI adapters, static panel JavaScript.

**Spec:** `docs/superpowers/specs/2026-09-03-evidence-gated-runtime-rebuild-design.md`

## Global Constraints

- KiCad files remain authoritative for editable design state.
- `.chatpcb.json` schema version 1 remains readable and is never rewritten implicitly.
- Artifact paths are project-relative POSIX paths; absolute paths never enter persisted evidence.
- Project digest uses sorted `{path, kind, sha256, size}` records and excludes transient ERC/DRC reports.
- Inspection does not report failure merely because ERC or DRC contains findings; validation status remains nested evidence.
- All project directories pass `assertSafeProjectDir` before inspection or patch writes.
- Patch application requires a matching, unexpired preview ID and fresh before hashes.
- A stale or expired approval writes nothing.
- No external analyzer is installed in this phase.
- Existing `generate`, `validate`, `drc`, `simulate`, provider, and panel flows remain compatible.

---

### Task 1: Deterministic Artifact Inventory

**Files:**
- Create: `src/evidence/artifact-inventory.js`
- Create: `tests/artifact-inventory.test.js`

**Interfaces:**
- Produces: `collectArtifactInventory({ projectDir }): Promise<{ projectDigest: string, artifacts: ArtifactEvidence[] }>`.
- `ArtifactEvidence`: `{ path: string, kind: string, sha256: string, size: number }`.
- Consumes only regular project files with supported source extensions.

- [ ] **Step 1: Write the failing stable-inventory test**

```js
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { collectArtifactInventory } from '../src/evidence/artifact-inventory.js';

test('collectArtifactInventory hashes sorted KiCad sources and ignores reports', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-inventory-'));
  try {
    await mkdir(path.join(root, 'sheets'));
    await writeFile(path.join(root, 'board.kicad_pcb'), 'pcb-v1');
    await writeFile(path.join(root, 'sheets', 'power.kicad_sch'), 'sch-v1');
    await writeFile(path.join(root, 'chatpcb-drc.json'), '{"transient":true}');

    const first = await collectArtifactInventory({ projectDir: root });
    const second = await collectArtifactInventory({ projectDir: root });

    assert.deepEqual(first, second);
    assert.deepEqual(first.artifacts.map((item) => item.path), ['board.kicad_pcb', 'sheets/power.kicad_sch']);
    assert.equal(first.artifacts.every((item) => /^[a-f0-9]{64}$/.test(item.sha256)), true);
    assert.match(first.projectDigest, /^[a-f0-9]{64}$/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the test and confirm RED**

Run: `node --test tests/artifact-inventory.test.js`

Expected: FAIL because `src/evidence/artifact-inventory.js` does not exist.

- [ ] **Step 3: Implement classification, hashing, and stable digest**

```js
import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const SOURCE_KINDS = new Map([
  ['.kicad_pro', 'project'],
  ['.kicad_sch', 'schematic'],
  ['.kicad_pcb', 'board'],
  ['.kicad_sym', 'symbol-library'],
  ['.kicad_mod', 'footprint'],
  ['.kicad_dru', 'design-rules'],
  ['.cir', 'spice']
]);
const SOURCE_NAMES = new Map([
  ['sym-lib-table', 'symbol-table'],
  ['fp-lib-table', 'footprint-table']
]);
const TRANSIENT_NAMES = new Set(['chatpcb-erc.json', 'chatpcb-drc.json']);

export async function collectArtifactInventory({ projectDir }) {
  const root = path.resolve(projectDir);
  const files = await walk(root);
  const artifacts = [];
  for (const absolutePath of files) {
    const relative = path.relative(root, absolutePath).split(path.sep).join('/');
    const base = path.basename(absolutePath);
    if (TRANSIENT_NAMES.has(base) || base.endsWith('.chatpcb.json')) continue;
    const kind = SOURCE_NAMES.get(base) ?? SOURCE_KINDS.get(path.extname(base));
    if (!kind) continue;
    const content = await readFile(absolutePath);
    artifacts.push({ path: relative, kind, sha256: sha256(content), size: (await stat(absolutePath)).size });
  }
  artifacts.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return { projectDigest: sha256(JSON.stringify(artifacts)), artifacts };
}
```

Implement `walk()` with `readdir(..., { withFileTypes: true })`, ignore symlinks, and sort entries before recursion. Implement `sha256(value)` with `createHash('sha256').update(value).digest('hex')`.

- [ ] **Step 4: Add mutation and path tests**

Add tests proving a one-byte schematic change alters both its SHA-256 and `projectDigest`, and Windows separators are normalized to `/`. Add a symlink-not-followed test with `{ skip: process.platform === 'win32' }` so Windows developer-mode privileges are not required.

- [ ] **Step 5: Run focused tests**

Run: `node --test tests/artifact-inventory.test.js`

Expected: all inventory tests PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/evidence/artifact-inventory.js tests/artifact-inventory.test.js
git commit -m "feat: add deterministic project artifact inventory"
```

### Task 2: Evidence Manifest Normalization and Freshness

**Files:**
- Create: `src/evidence/evidence-manifest.js`
- Create: `tests/evidence-manifest.test.js`

**Interfaces:**
- Produces: `normalizeEvidenceManifest(raw): NormalizedEvidenceManifest`.
- Produces: `evidenceFreshness({ manifest, projectDigest }): { status: 'current'|'stale'|'legacy-unverified'|'missing', reason: string }`.
- Produces: `createEvidenceManifestV2({ intent, inspection, toolchain, facts, findings, approvals }): EvidenceManifestV2`.

- [ ] **Step 1: Write failing version and freshness tests**

```js
test('legacy metadata remains readable but cannot claim current evidence', () => {
  const legacy = normalizeEvidenceManifest({ kind: 'mcu-peripheral', mcu: { family: 'STM32' } });
  assert.equal(legacy.schemaVersion, 1);
  assert.equal(evidenceFreshness({ manifest: legacy, projectDigest: 'abc' }).status, 'legacy-unverified');
});

test('schema v2 evidence becomes stale when the saved project digest changes', () => {
  const manifest = normalizeEvidenceManifest({ schemaVersion: 2, evidence: { projectDigest: 'old' } });
  assert.deepEqual(evidenceFreshness({ manifest, projectDigest: 'new' }), {
    status: 'stale',
    reason: 'Evidence digest old does not match saved project digest new.'
  });
});
```

- [ ] **Step 2: Run the test and confirm RED**

Run: `node --test tests/evidence-manifest.test.js`

Expected: FAIL because the evidence manifest module does not exist.

- [ ] **Step 3: Implement strict normalization**

Reject non-object JSON, schema versions other than `1` or `2`, and malformed v2 arrays. Preserve legacy content under `intent`. Return new arrays rather than sharing input references.

```js
export function evidenceFreshness({ manifest, projectDigest }) {
  if (!manifest) return { status: 'missing', reason: 'No ChatPCB manifest exists.' };
  if (manifest.schemaVersion === 1) {
    return { status: 'legacy-unverified', reason: 'Schema version 1 has no artifact-bound evidence.' };
  }
  const recorded = manifest.evidence?.projectDigest;
  if (!recorded) return { status: 'missing', reason: 'Schema version 2 has no project digest.' };
  if (recorded !== projectDigest) {
    return { status: 'stale', reason: `Evidence digest ${recorded} does not match saved project digest ${projectDigest}.` };
  }
  return { status: 'current', reason: 'Evidence matches the saved project artifacts.' };
}
```

- [ ] **Step 4: Add v2 creation tests**

Assert literal top-level keys, that artifact records contain relative paths only, and that `facts`, `findings`, and `approvals` default to empty arrays.

- [ ] **Step 5: Run focused tests**

Run: `node --test tests/evidence-manifest.test.js`

Expected: all manifest tests PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/evidence/evidence-manifest.js tests/evidence-manifest.test.js
git commit -m "feat: define artifact-bound evidence manifest"
```

### Task 3: Saved Project Inspection Workflow

**Files:**
- Create: `src/workflow/inspect-project.js`
- Create: `tests/inspect-project.test.js`
- Modify: `src/workflow/project-workspace.js`

**Interfaces:**
- Produces: `inspectProject({ projectDir, kicadCliPath, validateProjectImpl, validateBoardImpl, now }): Promise<ProjectInspection>`.
- Consumes: `collectArtifactInventory`, manifest normalization, `validateProject`, `validateBoard`, and `assertSafeProjectDir`.

- [ ] **Step 1: Write the failing inspection test**

```js
test('inspectProject returns stable artifact evidence and separate validation results', async () => {
  const result = await inspectProject({
    projectDir: root,
    now: () => '2026-09-03T00:00:00.000Z',
    validateProjectImpl: async () => ({ ok: true, erc: { errorCount: 0, warningCount: 0 } }),
    validateBoardImpl: async () => ({ ok: false, drc: { violationCount: 0, unconnectedCount: 2 } })
  });

  assert.equal(result.ok, true);
  assert.equal(result.inspection.artifactCount, 2);
  assert.equal(result.validation.erc.ok, true);
  assert.equal(result.validation.drc.ok, false);
  assert.equal(result.validationClean, false);
});
```

- [ ] **Step 2: Run the test and confirm RED**

Run: `node --test tests/inspect-project.test.js`

Expected: FAIL because `inspectProject` does not exist.

- [ ] **Step 3: Implement inspection without conflating findings with execution failure**

```js
export async function inspectProject(options = {}) {
  const projectDir = assertSafeProjectDir(options.projectDir);
  const inventory = await collectArtifactInventory({ projectDir });
  const rawManifest = await readChatPcbManifest(projectDir);
  const manifest = rawManifest ? normalizeEvidenceManifest(rawManifest) : null;
  const [erc, drc] = await Promise.all([
    (options.validateProjectImpl ?? validateProject)({ projectDir, kicadCliPath: options.kicadCliPath }),
    (options.validateBoardImpl ?? validateBoard)({ projectDir, kicadCliPath: options.kicadCliPath })
  ]);
  return {
    ok: true,
    inspectedAt: (options.now ?? (() => new Date().toISOString()))(),
    inspection: { ...inventory, artifactCount: inventory.artifacts.length },
    manifest: { schemaVersion: manifest?.schemaVersion ?? null, freshness: evidenceFreshness({ manifest, projectDigest: inventory.projectDigest }) },
    validation: { erc, drc },
    validationClean: erc.ok === true && drc.ok === true
  };
}
```

Do not add `releaseEligible` or alter `reviewCircuitReadiness` in this phase. Clean validation and current evidence are necessary but not sufficient for release readiness; sourcing, datasheet, simulation/calculation, layout, manufacturing, and approval gates remain authoritative.

`readChatPcbManifest()` must require zero or one `.chatpcb.json` file. Multiple manifests return `MULTIPLE_CHATPCB_MANIFESTS`; invalid JSON returns `CHATPCB_MANIFEST_INVALID`.

- [ ] **Step 4: Add error-path tests**

Cover an unsafe project path, invalid JSON, multiple manifests, a project without PCB, and a project without `.chatpcb.json`. Assert that source files are unchanged after each inspection.

- [ ] **Step 5: Run workflow and existing validation tests**

Run: `node --test tests/inspect-project.test.js tests/validate-project.test.js tests/validate-board.test.js`

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/workflow/inspect-project.js src/workflow/project-workspace.js tests/inspect-project.test.js
git commit -m "feat: inspect saved KiCad project evidence"
```

### Task 4: CLI and Daemon `project.inspect`

**Files:**
- Modify: `bin/chatpcb-cli.js`
- Modify: `src/runtime/agent-daemon.js`
- Modify: `src/runtime/provider-process.js`
- Modify: `tests/cli.test.js`
- Modify: `tests/daemon.test.js`
- Modify: `tests/provider-process.test.js`

**Interfaces:**
- CLI: `chatpcb inspect --project <dir> [--kicad-cli <path>]`.
- Daemon tool: `{ name: 'project.inspect', args: { projectDir, kicadCliPath? } }`.
- Provider capability in this phase: read-only `project.inspect` is allowed.

- [ ] **Step 1: Add failing CLI and daemon tests**

CLI test assertions:

```js
assert.equal(result.status, 0);
assert.equal(parsed.ok, true);
assert.match(parsed.result.inspection.projectDigest, /^[a-f0-9]{64}$/);
```

Daemon test:

```js
const result = await dispatchToolCall(
  { name: 'project.inspect', args: { projectDir: root } },
  { inspectProjectImpl: async () => ({ ok: true, inspection: { projectDigest: 'abc' } }) }
);
assert.equal(result.ok, true);
assert.equal(result.result.inspection.projectDigest, 'abc');
```

- [ ] **Step 2: Run tests and confirm RED**

Run: `node --test tests/cli.test.js tests/daemon.test.js tests/provider-process.test.js`

Expected: FAIL because the command and tool are unknown.

- [ ] **Step 3: Add the CLI command**

Import `inspectProject`, add the `inspect` branch before `validate`, print the inspection result, and set exit code `0` when inspection executes successfully regardless of nested ERC/DRC findings. Add this usage line:

```text
chatpcb inspect --project <dir> [--kicad-cli <path>]
```

- [ ] **Step 4: Add daemon dispatch and provider allowance**

Add `project.inspect` to `PROVIDER_ALLOWED_TOOLS` and `DEFAULT_ALLOWED_TOOL_NAMES`. Inject `inspectProjectImpl` through `dispatchToolCall` options and return its typed result from the switch.

- [ ] **Step 5: Run focused tests**

Run: `node --test tests/cli.test.js tests/daemon.test.js tests/provider-process.test.js`

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```powershell
git add bin/chatpcb-cli.js src/runtime/agent-daemon.js src/runtime/provider-process.js tests/cli.test.js tests/daemon.test.js tests/provider-process.test.js
git commit -m "feat: expose deterministic project inspection"
```

### Task 5: Artifact-Bound Patch Approval

**Files:**
- Create: `src/runtime/patch-approval-registry.js`
- Create: `tests/patch-approval-registry.test.js`
- Modify: `src/workflow/schematic-patch.js`
- Modify: `src/runtime/agent-daemon.js`
- Modify: `tests/schematic-patch.test.js`
- Modify: `tests/daemon.test.js`

**Interfaces:**
- Produces: `createPatchApprovalRegistry({ ttlMs = 900000, now = Date.now })`.
- Preview returns `patchId`, `expiresAt`, `beforeArtifacts`, and `afterArtifacts`.
- Apply consumes `expectedPatchId`; mismatch returns `PATCH_STALE`, expiry returns `PATCH_APPROVAL_EXPIRED`.

- [ ] **Step 1: Write failing registry tests**

```js
test('patch approval registry consumes a matching unexpired preview once', () => {
  let time = 1000;
  const registry = createPatchApprovalRegistry({ ttlMs: 900000, now: () => time });
  registry.register({ patchId: 'sha256:abc', projectDir: 'C:/project' });
  assert.equal(registry.consume({ patchId: 'sha256:abc', projectDir: 'C:/project' }).ok, true);
  assert.equal(registry.consume({ patchId: 'sha256:abc', projectDir: 'C:/project' }).reason.code, 'PATCH_APPROVAL_MISSING');
});

test('patch approval registry rejects an expired preview', () => {
  let time = 1000;
  const registry = createPatchApprovalRegistry({ ttlMs: 10, now: () => time });
  registry.register({ patchId: 'sha256:abc', projectDir: 'C:/project' });
  time = 1011;
  assert.equal(registry.consume({ patchId: 'sha256:abc', projectDir: 'C:/project' }).reason.code, 'PATCH_APPROVAL_EXPIRED');
});
```

- [ ] **Step 2: Run registry tests and confirm RED**

Run: `node --test tests/patch-approval-registry.test.js`

Expected: FAIL because the registry does not exist.

- [ ] **Step 3: Implement single-use registry**

Use a private `Map` keyed by `patchId`. Normalize project paths with `path.resolve`. `consume()` deletes the record before returning so a failed downstream apply cannot replay the approval.

- [ ] **Step 4: Add failing stale-project patch test**

```js
const preview = await applySchematicPatch({ projectDir: root, prompt, approved: false });
await appendFile(existingSchematic, '\n(user edit)\n');
const result = await applySchematicPatch({
  projectDir: root,
  prompt,
  approved: true,
  expectedPatchId: preview.patchId,
  validateProjectImpl: async () => ({ ok: true })
});
assert.equal(result.applied, false);
assert.equal(result.reason.code, 'PATCH_STALE');
assert.match(await readFile(existingSchematic, 'utf8'), /user edit/);
```

- [ ] **Step 5: Derive patch identity from exact content**

In `buildPatchPlan`, collect SHA-256 records for every before and proposed file, sort by relative path, and calculate:

```js
const patchId = `sha256:${createHash('sha256').update(JSON.stringify({
  projectDir: resolvedProjectDir,
  beforeArtifacts,
  afterArtifacts,
  changedFiles
})).digest('hex')}`;
```

Do not include timestamps or random UUIDs in the digest input. Because generated KiCad UUIDs are currently random, calculate candidate output once per preview and make the daemon registry retain the candidate plan until apply or expiry. Add `dispose()` cleanup for cancel, expiry, and daemon shutdown.

- [ ] **Step 6: Wire daemon preview, approve, cancel, and expiry**

Preview registers the plan and returns `patchId` plus `expiresAt`. Approve requires `call.args.patchId`; cancel consumes and disposes the stored plan. A missing ID returns `PATCH_APPROVAL_REQUIRED`. Changed before hashes return `PATCH_STALE` before any write.

- [ ] **Step 7: Run patch and daemon tests**

Run: `node --test tests/patch-approval-registry.test.js tests/schematic-patch.test.js tests/daemon.test.js`

Expected: approve, cancel, stale, expiry, rollback, and replay tests PASS.

- [ ] **Step 8: Commit**

```powershell
git add src/runtime/patch-approval-registry.js src/workflow/schematic-patch.js src/runtime/agent-daemon.js tests/patch-approval-registry.test.js tests/schematic-patch.test.js tests/daemon.test.js
git commit -m "feat: bind patch approval to artifact hashes"
```

### Task 6: Panel Inspection and Freshness UI

**Files:**
- Modify: `apps/panel/app.js`
- Modify: `apps/panel/index.html`
- Modify: `apps/panel/styles.css`
- Modify: `scripts/verify-panel-flow.js`
- Modify: `scripts/verify-panel-ui.js`
- Modify: `tests/panel-assets.test.js`
- Modify: `tests/panel-ui-verifier.test.js`

**Interfaces:**
- Sends: `project.inspect` after project selection, generation, approved patch, and KiCad reload acknowledgement.
- Renders: inspection digest prefix, artifact count, ERC/DRC summaries, and freshness state.
- Stores: active `patchId` only until approve, cancel, project change, or expiry.

- [ ] **Step 1: Add failing panel behavior tests**

Extend browser verification so the fake daemon returns:

```js
{
  inspection: { projectDigest: 'a'.repeat(64), artifactCount: 6 },
  manifest: { schemaVersion: 2, freshness: { status: 'current', reason: 'Evidence matches.' } },
  validation: { erc: { ok: true, erc: { errorCount: 0, warningCount: 0 } }, drc: { ok: false, drc: { violationCount: 0, unconnectedCount: 2 } } }
}
```

Assert the UI shows `current`, digest prefix `aaaaaaaaaaaa`, `6 artifacts`, ERC `0/0`, and DRC `0/2`. Change the fake project digest and assert the Approve button is disabled with a stale message.

- [ ] **Step 2: Run panel tests and confirm RED**

Run: `node --test tests/panel-assets.test.js tests/panel-ui-verifier.test.js`

Expected: FAIL because inspection and freshness UI are absent.

- [ ] **Step 3: Add inspection state and rendering**

Add one `inspectionState` object in `app.js`. Use existing envelope helpers to call `project.inspect`. Render freshness with data attributes `current`, `stale`, `legacy-unverified`, or `missing`; do not infer freshness from ERC/DRC counts.

- [ ] **Step 4: Bind patch approval UI to `patchId`**

Store `patchId` and `expiresAt` from preview. Include `patchId` in approve/cancel calls. Clear it on any project path change, new preview, reload conflict, expiry, apply result, or socket reconnect.

- [ ] **Step 5: Run browser and panel verification**

Run:

```powershell
node --test tests/panel-assets.test.js tests/panel-ui-verifier.test.js
npm run verify:panel
npm run verify:ui
```

Expected: all tests and both verification scripts PASS.

- [ ] **Step 6: Commit**

```powershell
git add apps/panel/app.js apps/panel/index.html apps/panel/styles.css scripts/verify-panel-flow.js scripts/verify-panel-ui.js tests/panel-assets.test.js tests/panel-ui-verifier.test.js
git commit -m "feat: show project evidence freshness in panel"
```

### Task 7: Migration Documentation and Final Gate

**Files:**
- Modify: `README.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/ROADMAP.md`
- Modify: `plan.md`
- Modify: `docs/handoff-next-session.md`
- Test: `tests/phase1-docs.test.js`

**Interfaces:**
- Documents `.chatpcb.json` schema v1 compatibility and schema v2 evidence semantics.
- Makes this rebuild roadmap the active source of architectural direction.

- [ ] **Step 1: Add failing documentation contract tests**

Add assertions that public docs name `project.inspect`, artifact-bound approvals, KiCad files as authoritative editable state, and `.chatpcb.json` as an intent/evidence manifest. Remove the stale unchecked statement that PCB patch diff is absent; replace it with a tested statement that all generated artifacts participate in preview and rollback.

- [ ] **Step 2: Run the documentation test and confirm RED**

Run: `node --test tests/phase1-docs.test.js`

Expected: FAIL because the new architecture terms are absent.

- [ ] **Step 3: Update public architecture and roadmap**

Use this product statement verbatim:

> OH-MY-ChatPCB is a local-first, evidence-gated KiCad agent runtime that connects user-owned AI providers to native KiCad workflows with deterministic inspection, reviewable patches, validation, rollback, and human release gates.

Document that Circuit JSON, kicad-happy, KiCad IPC, and solver integrations are optional pinned adapters. Record schema v1 as readable but unverified and schema v2 as artifact-bound.

- [ ] **Step 4: Record measured migration evidence**

Append the exact Node version, KiCad CLI path/version, test counts, `verify:sample`, `verify:panel`, `verify:ui`, and one real `chatpcb inspect` result. Keep current PCB unconnected counts and release blockers explicit.

- [ ] **Step 5: Run the full final verification**

Run:

```powershell
npm test
npm run verify:sample
npm run verify:panel
npm run verify:ui
node ./bin/chatpcb-cli.js inspect --project ./workspaces/sample-mcu
git diff --check
```

Expected: all tests and verification scripts PASS; inspection reports a valid digest; generic sample remains blocked or prototype-only according to its existing evidence.

- [ ] **Step 6: Commit**

```powershell
git add README.md docs/ARCHITECTURE.md docs/ROADMAP.md plan.md docs/handoff-next-session.md tests/phase1-docs.test.js
git commit -m "docs: adopt evidence-gated runtime architecture"
```

## Phase Completion Review

- [ ] Confirm every new function has a test that was observed failing before implementation.
- [ ] Confirm unchanged artifacts yield stable hashes and changing one byte invalidates evidence.
- [ ] Confirm patch approval is single-use, expires, and fails closed after project changes.
- [ ] Confirm inspection cannot modify project files.
- [ ] Confirm schema v1 projects still open and inspect as `legacy-unverified`.
- [ ] Confirm panel approval is disabled for stale evidence.
- [ ] Confirm no external analyzer or solver was installed.
- [ ] Request code review against this plan and its design spec.
- [ ] Use `superpowers:finishing-a-development-branch` before merge or PR creation.
