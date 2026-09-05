# Analyzer follow-up implementation plan

Base: da0f886 (PR #3). Work in .worktrees/kicad-analyzer on feat/analyzer-followup.

## Scope and constraints
Finish the previously proposed residual milestones. Keep external-adapter.js execution disabled with ANALYZER_SANDBOX_UNAVAILABLE. No sandbox implementation, routing changes, or API expansion. Preserve user files and other worktrees. Do not claim full electrical connectivity or full Phase 2 completion.

## Milestone 1: Deterministic contracts
Files: src/analyzer/fact-contract.js, tests/fact-contract.test.js.
Add regressions using reversed arrays of malformed IDs including objects, Symbol and undefined. Invalid diagnostic IDs must be omitted or normalized safely, JSON serializable, and independent of caller ordering. Preserve valid string IDs. Implement only after observing failure.

## Milestone 2: Status and finding integrity
Files: src/analyzer/project-analyzer.js, tests/project-analyzer.test.js, optionally a focused contract helper.
Reject reserved builtin adapter identities/namespaces so disabled external definitions cannot overwrite built-in bookkeeping or discard built-in findings. Canonically order returned adapter statuses including ties. For duplicate findings retain deterministically, emit ANALYZER_FINDING_COLLISION, downgrade affected analyzer status, preserve built-in preference and valid fact references. Test actual multi-symbol/file fixtures and reversed definition inputs; avoid adding an external execution override solely to test unreachable code.

## Milestone 3: Security boundary regression coverage
Files: tests/daemon.test.js, tests/inspect-project.test.js.
Add behavior tests proving nested provider analyzer definitions are stripped (with and without trusted outer definitions, including validation aliases).
Add a controlled asynchronous validation barrier to prove mutations while validation remains pending cause final inspection to discard facts/findings. Avoid timing-only sleeps. Existing source checks may already implement this; add missing verification without unnecessary production changes.

## Milestone 4: Document actual delivery
Controller owns documentation. Reconcile Phase 2 spec/plan with disabled adapters, structural-only nets, absent pin-net reconstruction/power analysis and version compatibility evidence. Preserve historical intent but add explicit implemented/deferred sections. Independent KiCad validation path hardening remains a disclosed follow-up.

## Milestone 5: Verify and review
Worker: focused tests, full npm test once after code changes, diff check; report exact results and limitations. Controller: review diff and run sample/panel/UI only if relevant regressions justify; full-branch review and address confirmed scoped findings.

## Milestone 6: Integration
After checks and review, commit scoped files, push feature branch, create accurately scoped PR against main, check CI then merge under the user's prior instruction. Do not force push or bypass required checks. Update main with ff-only and report PR, merge commit, validation and remaining work.

## Ownership
Luna Max implements milestones 1–3, tests and reports; controller writes this plan and reconciles docs in milestone 4 concurrently. Worker must not edit docs or git commit while controller is editing; return code ready for controller commit.

## Implementation and verification

- Milestones 1–3 implemented by gpt-5.6-luna with max reasoning effort; controller reviewed all changed source/test diffs.
- Malformed diagnostic IDs are omitted unless valid strings; reserved built-in identities cannot replace internal finding ownership; duplicate findings produce explicit collision diagnostics; tied adapter statuses sort deterministically.
- Provider stripping is covered for direct inspection and both validation aliases, with and without trusted outer definitions.
- The mutation regression waits for actual analyzer completion and pending validation before modifying input. An internal analyzer injection seam defaults to the real implementation and is not forwarded from daemon tool arguments.
- Controller full verification: npm test — 187 tests, 186 passed, 0 failed, 1 existing Windows symlink skip. Worker focused verification — 62 passed.
- Milestone 4 documented actual structural delivery and explicitly deferred pin-net, power, version corpus and sandbox work. External execution remains disabled.
- No renderer or generator changes: prior sample/UI verification remains applicable; CLI and panel-flow coverage ran in the full suite.
