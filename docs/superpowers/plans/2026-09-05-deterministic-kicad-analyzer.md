# Deterministic KiCad Analyzer Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic schematic/PCB facts and a fail-closed optional external analyzer path to the read-only `project.inspect` workflow.

**Architecture:** A small S-expression parser feeds focused schematic and PCB extractors. A fact-contract layer normalizes IDs, provenance, confidence, sorting, and collisions. An orchestration layer combines built-in facts with disposable, checksum-verified external adapter results and returns them from `project.inspect` without modifying saved project files.

**Tech Stack:** Node.js 20+, native `node:test`, native `fs/promises`, `node:child_process`, SHA-256 via `node:crypto`, existing CLI/daemon and KiCad file formats.

**Spec:** `docs/superpowers/specs/2026-09-05-deterministic-kicad-analyzer-design.md`

## Global Constraints

- KiCad files remain the authoritative editable design artifacts; `.chatpcb.json` is not rewritten by inspection.
- Facts must be deterministic for fixed input bytes and sorted canonically before return.
- Every fact and finding carries artifact provenance, extractor version, and confidence.
- External adapters are optional, explicitly configured, version-pinned, checksum-verified, time-bounded, and never downloaded automatically.
- External analyzers run against a disposable copy or serialized input; no analyzer may write the saved project directory.
- Existing Phase 1 artifact, freshness, validation, CLI, daemon, and panel behavior remains compatible.
- Typed analyzer diagnostics never masquerade as clean ERC/DRC or release-ready evidence.
- Every behavior change follows TDD: write a failing test, observe the expected failure, implement the minimum code, then refactor only while green.

---

### Task 1: S-expression parser and fact contract

**Files:**
- Create: `src/analyzer/sexpr.js`
- Create: `src/analyzer/fact-contract.js`
- Test: `tests/sexpr.test.js`
- Test: `tests/fact-contract.test.js`

**Interfaces:**
- `parseSExpression(source, { sourcePath? })` returns one nested array node whose first item is the list head; atoms are strings and quoted values are unescaped.
- `SExpressionParseError` has `code === 'ANALYZER_PARSE_ERROR'`, `sourcePath`, and a human-readable message.
- `canonicalJson(value)` returns JSON with recursively sorted object keys and stable array order.
- `createFact({ id, category, value, sourceArtifact, extractor, confidence })` returns a validated fact object.
- `normalizeFacts(facts)` returns `{ facts, diagnostics }`, sorts facts by ID/category/canonical value, and omits invalid or colliding IDs with typed diagnostics.
- `normalizeFinding(finding)` validates `id`, `severity`, `confidence`, `factIds`, and `sourceArtifacts`.

- [ ] **Step 1: Write the failing parser tests**

```js
test('parseSExpression preserves nested lists and unescapes quoted atoms', () => {
  const tree = parseSExpression('(root (name "A\\"B") (at 1.25 -2 90) bare)');
  assert.deepEqual(tree, ['root', ['name', 'A"B'], ['at', '1.25', '-2', '90'], 'bare']);
});

test('parseSExpression rejects unterminated strings and lists with a typed error', () => {
  assert.throws(() => parseSExpression('(root "unterminated'), (error) =>
    error.code === 'ANALYZER_PARSE_ERROR' && /unterminated/i.test(error.message));
});
```

Run: `node --test tests/sexpr.test.js`

Expected: FAIL because `src/analyzer/sexpr.js` does not exist.

- [ ] **Step 2: Implement the minimal tokenizer/parser**

Scan one character at a time, skip whitespace and `;` comments, parse balanced parentheses, preserve atom text, decode `\\` and `\"` inside quoted strings, and throw `SExpressionParseError` on an unexpected close, unterminated string, or unbalanced list. Reject trailing non-whitespace after the root list.

- [ ] **Step 3: Run parser tests and verify they pass**

Run: `node --test tests/sexpr.test.js`

Expected: PASS with both parser tests green.

- [ ] **Step 4: Write failing fact-contract tests**

```js
test('normalizeFacts sorts facts and rejects duplicate fully-qualified IDs', () => {
  const result = normalizeFacts([
    createFact({ id: 'builtin.board.net:2', category: 'board.net', value: { name: 'B' }, sourceArtifact: 'b.kicad_pcb', extractor: 'builtin.kicad-pcb@1', confidence: 'deterministic' }),
    createFact({ id: 'builtin.board.net:1', category: 'board.net', value: { name: 'A' }, sourceArtifact: 'b.kicad_pcb', extractor: 'builtin.kicad-pcb@1', confidence: 'deterministic' }),
    { id: 'builtin.board.net:1', category: 'board.net', value: { name: 'duplicate' }, sourceArtifact: 'b.kicad_pcb', extractor: 'other@1', confidence: 'heuristic' }
  ]);
  assert.deepEqual(result.facts.map((fact) => fact.id), ['builtin.board.net:1', 'builtin.board.net:2']);
  assert.equal(result.diagnostics.some((item) => item.code === 'ANALYZER_FACT_COLLISION'), true);
});
```

Run: `node --test tests/fact-contract.test.js`

Expected: FAIL because the contract module is missing.

- [ ] **Step 5: Implement contract validation and canonical sorting**

Require non-empty IDs/categories/source artifacts/extractors, the confidence values `deterministic`, `heuristic`, or `datasheet-backed`, and finding severities `info`, `warning`, or `blocker`. Detect duplicate IDs after sorting and emit one `ANALYZER_FACT_COLLISION` diagnostic per rejected duplicate.

- [ ] **Step 6: Run both contract test files**

Run: `node --test tests/sexpr.test.js tests/fact-contract.test.js`

Expected: all tests PASS with no unhandled warnings.

- [ ] **Step 7: Commit the parser and contract**

```bash
git add src/analyzer/sexpr.js src/analyzer/fact-contract.js tests/sexpr.test.js tests/fact-contract.test.js
git commit -m "feat: add deterministic analyzer fact contract"
```

### Task 2: Built-in schematic fact extractor

**Files:**
- Create: `src/analyzer/kicad-schematic.js`
- Test: `tests/kicad-schematic.test.js`

**Interfaces:**
- `analyzeSchematic({ source, sourceArtifact })` returns `{ facts, findings, diagnostics, summary }`.
- `summary` includes `formatVersion`, `symbolCount`, `labelCount`, `wireCount`, `junctionCount`, and `noConnectCount`.
- Component fact IDs use `builtin.schematic.component:<uuid>` when a UUID exists and `builtin.schematic.component:ref:<reference>` otherwise.

- [ ] **Step 1: Write a failing generated-schematic fixture test**

Use an inline KiCad S-expression containing `(version 20260306)`, one placed `(symbol ...)` with `lib_id`, `uuid`, `at`, `property` entries for Reference/Value/Footprint, one `(label "SDA" ...)`, one `(wire ...)`, one `(junction ...)`, and one `(no_connect ...)`. Assert the summary counts and the component value:

```js
test('analyzeSchematic extracts stable component and structural facts', () => {
  const result = analyzeSchematic({ source: fixture, sourceArtifact: 'demo.kicad_sch' });
  assert.deepEqual(result.summary, {
    formatVersion: '20260306', symbolCount: 1, labelCount: 1, wireCount: 1,
    junctionCount: 1, noConnectCount: 1
  });
  assert.deepEqual(result.facts.find((fact) => fact.category === 'schematic.component').value, {
    uuid: 'sym-1', reference: 'U1', value: 'MCU', libId: 'ChatPCB:MCU_PLACEHOLDER',
    footprint: 'Package_QFP:LQFP-32', position: { x: 10, y: 20 }, rotation: 0, unit: 1
  });
});
```

Run: `node --test tests/kicad-schematic.test.js`

Expected: FAIL because the extractor is missing.

- [ ] **Step 2: Implement direct-child extraction using the parser**

Parse the root, read the root `version`, and inspect only direct `symbol` children so embedded `lib_symbols` definitions are not counted as placed components. Extract property values by property name, numeric `(at ...)`, `unit`, and UUID. Count direct `label`, `wire`, `junction`, and `no_connect` nodes. Emit labels as `builtin.schematic.label:<index>` facts with coordinates and text; indexes are assigned after sorting by coordinate/text so random file order cannot change IDs.

- [ ] **Step 3: Add deterministic net and structural findings**

Emit `schematic.net` facts for labels, grouped by exact label text, with sorted label fact IDs in the value. Emit a deterministic warning finding when a placed component lacks a Reference or Footprint. Emit `ANALYZER_PARSE_ERROR` diagnostics from `SExpressionParseError` and return an empty summary with no fabricated facts.

- [ ] **Step 4: Run the schematic tests**

Run: `node --test tests/kicad-schematic.test.js`

Expected: all schematic extraction, malformed-input, and deterministic-order tests PASS.

- [ ] **Step 5: Commit the schematic extractor**

```bash
git add src/analyzer/kicad-schematic.js tests/kicad-schematic.test.js
git commit -m "feat: extract deterministic schematic facts"
```

### Task 3: Built-in PCB fact extractor

**Files:**
- Create: `src/analyzer/kicad-pcb.js`
- Test: `tests/kicad-pcb.test.js`

**Interfaces:**
- `analyzePcb({ source, sourceArtifact })` returns `{ facts, findings, diagnostics, summary }`.
- `summary` includes `formatVersion`, sorted `layers`, `outline`, and counts for `footprintCount`, `padCount`, `segmentCount`, `viaCount`, `zoneCount`, and `graphicCount`.
- Board facts use IDs `builtin.board.net:<id>`, `builtin.board.footprint:<uuid-or-ref>`, `builtin.board.pad:<footprint>:<number>`, `builtin.board.segment:<index>`, `builtin.board.via:<index>`, and `builtin.board.summary`.

- [ ] **Step 1: Write a failing PCB fixture test**

Use an inline board with F.Cu/B.Cu layers, two nets, one rotated footprint, two pads (one with a net and one no-net), one segment, one via, one `gr_rect` Edge.Cuts item, and one zone. Assert numeric geometry is parsed, layers are sorted by numeric layer ID, and pad coordinates remain local-to-footprint plus board position as separate fields.

Run: `node --test tests/kicad-pcb.test.js`

Expected: FAIL because the PCB extractor is missing.

- [ ] **Step 2: Implement board summary, nets, footprints, pads, segments, and vias**

Walk direct board children, parse `version`, `layers`, `net`, `footprint`, `pad`, `segment`, `via`, `zone`, and graphic nodes. Keep pad `position` local and include `footprintPosition`/`footprintRotation`; do not perform rotated-coordinate math in this phase. Preserve pad layer atoms as a sorted array. Treat missing net IDs as `null` and use `netName: null` for no-net pads.

- [ ] **Step 3: Implement conservative unrouted and structural findings**

Emit one `board.unrouted` fact with `netIds` whose named net has fewer than two associated pads or no segment/via evidence. This is a heuristic fact and must state `confidence: 'heuristic'`. Emit a deterministic warning when a pad references an undeclared net ID. Do not claim DRC connectivity.

- [ ] **Step 4: Run PCB tests and commit**

Run: `node --test tests/kicad-pcb.test.js`

Expected: all PCB extraction and malformed-input tests PASS.

```bash
git add src/analyzer/kicad-pcb.js tests/kicad-pcb.test.js
git commit -m "feat: extract deterministic PCB facts"
```

### Task 4: Built-in analyzer orchestration and `project.inspect` integration

**Files:**
- Create: `src/analyzer/project-analyzer.js`
- Modify: `src/workflow/inspect-project.js`
- Test: `tests/project-analyzer.test.js`
- Modify: `tests/inspect-project.test.js`

**Interfaces:**
- `analyzeProject({ projectDir, inventory, analyzerAdapters = [], readFileImpl = readFile, collectInventoryImpl = collectArtifactInventory })` returns `{ facts, findings, analyzers }`.
- Built-in analyzer status is `{ id: 'builtin.kicad', namespace: 'builtin', status: 'complete'|'partial'|'skipped', version: '1', sourceArtifacts, diagnostics }`.
- `inspectProject` accepts `analyzerAdapters` and adds `inspection.facts`, `inspection.analyzers`, and top-level `findings` without removing Phase 1 fields.

- [ ] **Step 1: Add failing orchestration tests**

Create a temporary project with both fixture files and injectable clean ERC/DRC implementations. Assert `inspectProject` returns sorted facts and the built-in analyzer status. Add a repeated-call assertion that `JSON.stringify(first.inspection.facts) === JSON.stringify(second.inspection.facts)`.

Run: `node --test tests/project-analyzer.test.js tests/inspect-project.test.js`

Expected: FAIL because `project-analyzer.js` is missing and `inspectProject` has no fact fields.

- [ ] **Step 2: Implement source-file selection and built-in orchestration**

Use only `.kicad_sch` and `.kicad_pcb` entries from the Phase 1 inventory. Read bytes once per artifact, call the focused extractor, normalize/merge facts and findings, and sort analyzer statuses. A missing schematic or board yields a typed `ANALYZER_SOURCE_MISSING` diagnostic in the built-in status while preserving facts from the other file.

- [ ] **Step 3: Add input-change protection**

Recompute the artifact inventory after extraction. If the final digest differs from the supplied digest, return no facts/findings and a failed built-in status with `ANALYZER_INPUT_CHANGED`; do not throw away the existing Phase 1 inventory or validation results. Add a test whose `collectInventoryImpl` returns a changed digest on its second call.

- [ ] **Step 4: Integrate into `inspectProject`**

Run `analyzeProject` alongside disposable ERC/DRC validation. Pass `options.analyzerAdapters` through. Return `inspection: { ...inventory, artifactCount, toolchain, facts, analyzers }` and `findings` at the top level. Keep `validationClean` based only on ERC/DRC as before.

- [ ] **Step 5: Run integration tests**

Run: `node --test tests/project-analyzer.test.js tests/inspect-project.test.js`

Expected: all new tests and all existing inspect-project tests PASS.

- [ ] **Step 6: Commit built-in inspection integration**

```bash
git add src/analyzer/project-analyzer.js src/workflow/inspect-project.js tests/project-analyzer.test.js tests/inspect-project.test.js
git commit -m "feat: expose deterministic facts from project inspection"
```

### Task 5: Pinned external analyzer adapter

**Files:**
- Create: `src/analyzer/external-adapter.js`
- Modify: `src/analyzer/project-analyzer.js`
- Test: `tests/external-analyzer.test.js`

**Interfaces:**
- `runConfiguredAnalyzer({ definition, projectDir, inventory, sourceFiles, fsImpl, spawnImpl })` returns `{ analyzer, facts, findings }` and never mutates `projectDir`.
- Definition fields are `id`, `namespace`, `command`, `args`, `version`, `sha256`, `timeoutMs`, and `input` (`'project-copy'` or `'json'`).
- `analyzer.status` is `complete`, `skipped`, or `failed`; typed diagnostics use the codes in the Phase 2 spec.

- [ ] **Step 1: Write failing adapter safety tests**

Use `process.execPath` with a temporary Node script and calculate its SHA-256. Cover:

```js
test('checksum mismatch skips before spawning the adapter', async () => {
  const result = await runConfiguredAnalyzer({ definition: { ...validDefinition, sha256: '0'.repeat(64) }, ...context, spawnImpl: () => { throw new Error('must not spawn'); } });
  assert.equal(result.analyzer.status, 'failed');
  assert.equal(result.analyzer.diagnostics[0].code, 'ANALYZER_ADAPTER_CHECKSUM_MISMATCH');
});
```

Also write a script that creates `created-by-adapter.txt` in its received project directory and emits valid JSON; assert the source project snapshot is unchanged and the temporary file is removed.

Run: `node --test tests/external-analyzer.test.js`

Expected: FAIL because `external-adapter.js` is missing.

- [ ] **Step 2: Implement definition validation and executable hashing**

Require a non-empty adapter ID/namespace/version, a lowercase 64-character SHA-256, a positive timeout no greater than five minutes, and an absolute executable path. Hash the executable before spawning. Return `ANALYZER_ADAPTER_UNAVAILABLE` for `ENOENT` and `ANALYZER_ADAPTER_CHECKSUM_MISMATCH` for any mismatch. Never shell-expand the command or interpolate untrusted arguments.

- [ ] **Step 3: Implement isolated input modes and process lifecycle**

For `project-copy`, copy the project into a fresh temp directory, replace the literal `{projectDir}` argument token with that path, set `CHATPCB_ANALYZER_PROJECT_DIR` to the copy, and remove it in `finally`. For `json`, send `{ projectDigest, artifacts, sources }` on stdin where source contents are UTF-8 strings keyed by relative artifact path; do not include the original absolute path. Enforce timeout with `SIGTERM` and return `ANALYZER_ADAPTER_TIMEOUT`.

- [ ] **Step 4: Parse, redact, and normalize adapter output**

Require one JSON object with integer `schemaVersion`, `facts` array, and optional `findings` array. Redact stderr with the existing `redactProviderText` helper. Prefix every fact ID with the declared namespace, set `extractor` to `<namespace>@<version>`, copy source artifact paths from the output only after validating they are in the inventory, and downgrade undeclared confidence to `heuristic`. Invalid JSON/schema returns `ANALYZER_ADAPTER_INVALID_OUTPUT` with no facts.

- [ ] **Step 5: Merge external results without overriding built-ins**

Run each configured adapter after built-in extraction, normalize its facts through `normalizeFacts`, and keep adapter statuses sorted by ID. A fully-qualified ID collision omits the colliding external fact and records `ANALYZER_FACT_COLLISION`; built-in facts remain intact. External failure leaves built-in facts available.

- [ ] **Step 6: Run adapter tests and commit**

Run: `node --test tests/external-analyzer.test.js tests/project-analyzer.test.js`

Expected: all checksum, timeout, JSON, namespacing, collision, and disposable-copy tests PASS.

```bash
git add src/analyzer/external-adapter.js src/analyzer/project-analyzer.js tests/external-analyzer.test.js tests/project-analyzer.test.js
git commit -m "feat: add pinned external analyzer adapters"
```

### Task 6: Daemon/CLI exposure and documentation

**Files:**
- Modify: `src/runtime/agent-daemon.js`
- Modify: `bin/chatpcb-cli.js`
- Modify: `README.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/ROADMAP.md`
- Modify: `plan.md`
- Test: `tests/daemon.test.js`
- Modify: `tests/cli.test.js`

**Interfaces:**
- `project.inspect` daemon calls pass `call.args.analyzerAdapters` to the injected inspection implementation while preserving the existing project path guard.
- The CLI `inspect` command continues to print JSON with `inspection.facts`, `inspection.analyzers`, and `findings`; no adapter binary is installed or selected implicitly.

- [ ] **Step 1: Write failing daemon/CLI compatibility tests**

Add an injectable daemon test that captures `{ projectDir, analyzerAdapters }` and asserts the exact adapter definitions are forwarded. Add a CLI test fixture that runs `node bin/chatpcb-cli.js inspect --project <dir>` and asserts the JSON contains an array at `result.inspection.facts` and an analyzer status at `result.inspection.analyzers[0]`.

Run: `node --test tests/daemon.test.js tests/cli.test.js`

Expected: FAIL because daemon dispatch drops the adapter option and CLI output has no analyzer fields.

- [ ] **Step 2: Implement forwarding and CLI compatibility**

Forward `analyzerAdapters` in the `project.inspect` dispatch and in provider-context inspection calls. Keep CLI flags unchanged for this phase; built-in facts are automatic, and external definitions are supplied only through programmatic daemon/inspection options until a pinned config-file UX is designed.

- [ ] **Step 3: Update public documentation**

Document the fact categories, confidence meanings, typed adapter skips, disposable isolation, and the fact that `project.inspect` remains read-only. Update the architecture and roadmap phase status without claiming electrical correctness or release readiness from structural facts.

- [ ] **Step 4: Run compatibility tests and commit**

Run: `node --test tests/daemon.test.js tests/cli.test.js tests/phase1-docs.test.js`

Expected: all compatibility and documentation tests PASS.

```bash
git add src/runtime/agent-daemon.js bin/chatpcb-cli.js README.md docs/ARCHITECTURE.md docs/ROADMAP.md plan.md tests/daemon.test.js tests/cli.test.js
git commit -m "docs: expose deterministic analyzer inspection"
```

### Task 7: Full verification and handoff

**Files:**
- Test: all repository tests
- Modify: `docs/superpowers/plans/2026-09-05-deterministic-kicad-analyzer.md` only for completed checkboxes and observed command output

- [ ] **Step 1: Run focused analyzer tests**

Run: `node --test tests/sexpr.test.js tests/fact-contract.test.js tests/kicad-schematic.test.js tests/kicad-pcb.test.js tests/project-analyzer.test.js tests/external-analyzer.test.js`

Expected: 0 failures and no unhandled rejections.

- [ ] **Step 2: Run the complete regression suite**

Run: `npm test`

Expected: 0 failures; the existing Windows symlink test may remain the single documented skip.

- [ ] **Step 3: Run sample and panel verification**

Run: `npm run verify:sample` and `npm run verify:panel` and `npm run verify:ui`.

Expected: generated sample inspection includes deterministic facts, existing ERC/DRC behavior is unchanged, and both panel verifiers complete successfully.

- [ ] **Step 4: Review repository state**

Run: `git diff --check; git status --short --branch; git log --oneline -8`

Expected: no whitespace errors, only intentional Phase 2 commits, and a clean feature branch ready for review.

- [ ] **Step 5: Commit any final plan checkbox update**

```bash
git add docs/superpowers/plans/2026-09-05-deterministic-kicad-analyzer.md
git commit -m "docs: record deterministic analyzer verification"
```

