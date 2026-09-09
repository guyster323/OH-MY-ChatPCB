# Next work and integration plan

> **For agentic workers:** Use superpowers:executing-plans task by task. User-selected ownership: Astra plans and reviews; Grok CLI `grok-4.6` with `xhigh` executes through Orca orchestration. Do not spawn substitute agents.

**Goal:** Finish reviewable pending work before starting the next roadmap increment, and integrate only verified changes.

**Architecture:** Saved KiCad artifacts remain authoritative. Complete the existing validation boundary increment before advancing analyzer connectivity or manufacturing capabilities. Preserve unfinished routing work separately until its current-main behavior is verified.

**Tech Stack:** Node.js >=20, node:test, KiCad CLI, PowerShell, Orca orchestration.

**Spec:** `docs/ROADMAP.md`; `docs/superpowers/plans/2026-09-05-kicad-validation-boundary.md` in `.worktrees/kicad-analyzer`; existing supported-profile routing designs in `docs/superpowers/specs/`.

## Global constraints

- External analyzer execution remains disabled with `ANALYZER_SANDBOX_UNAVAILABLE`.
- ERC/DRC success alone never establishes release readiness.
- Preserve pre-existing edits, personal guides, and all worktrees; no reset, deletion, force push, or automatic manufacturing release.
- User authorizes necessary merges. Review and passing relevant checks precede integration. Remote publication is not necessary for this local integration task.
- Grok owns implementation and integration commands; Astra owns plan and review. No overlapping writers.

## Inventory, 2026-09-08

Fetched origin successfully. At inventory time, `main` and `origin/main` were `6b3e89b`. All other local branch tips were ancestors of main; there were no unmerged committed branch tips.

| Worktree / branch | Finding | Action |
| --- | --- | --- |
| main | Clean before this plan | Integration target |
| .worktrees/kicad-analyzer / feat/kicad-validation-boundary | Same base as main; 10 tracked modified files plus new plan, copy helper, and regression tests | Highest-priority completion and verification |
| workspaces/OH-MY-ChatPCB/route-reset-boot | 38 commits behind main; two uncommitted source/test files for RESET/BOOT | Review delta against current main before transplanting or merging |
| .worktrees/codex-kicad-chat-guide | Personal branch; .gitignore marked modified, empty displayed textual diff | Preserve; no product merge needed |
| .worktrees/supported-profile-power-routing | Committed work already included | No remerge needed |
| workspaces/OH-MY-ChatPCB/evidence-foundation | Committed work already included | No remerge needed; stale sidebar comment is not Git evidence |
| workspaces/OH-MY-ChatPCB/pad-aware-route-planner | Committed work already included | No remerge needed |

Remote-only exception discovered during the final sweep: `origin/codex/schematic-quality-improvements` at `c179e81` has no common ancestor with main in this non-shallow repository (roots `49bdea6` vs `04b5ee4`). It is a separate Rust/native-wxWidgets **ChatPCB3** direction whose README explicitly excludes the WebView/HTTP/WebSocket shell used by main. The direct tree comparison spans 156 files (18,658 additions / 19,507 deletions), and GitHub reports no open PRs. Preserve this branch; do not use `--allow-unrelated-histories` or treat it as a small schematic-preview patch. Choosing a native ChatPCB3 migration versus continuing this Node/WebView runtime is a separate architectural work item.

## Task 1: Complete existing validation boundary increment

**Files:** Existing changes in `src/kicad/kicad-cli.js`, `src/runtime/agent-daemon.js`, `src/workflow/{inspect-project,validate-project,inspection-copy}.js`, `tests/{daemon,kicad-cli,kicad-validation-boundary}.test.js`, and associated README/architecture/roadmap/spec documents in the validation worktree.

**Interfaces:** Preserve CLI `--kicad-cli` operator override; untrusted daemon/provider arguments must not select an executable. Inspection returns artifact-bound facts and typed errors/skips with existing contracts.

- [x] Read the existing validation-boundary plan and entire pending diff including untracked files. Record which acceptance criteria are already implemented.
- [x] Run `node --test tests/kicad-cli.test.js tests/kicad-validation-boundary.test.js tests/daemon.test.js tests/inspect-project.test.js` from the validation worktree. Report exact failures; add behavior regressions before fixing confirmed gaps.
- [x] Verify executable selection propagation, project-local executable exclusion, root/ancestor/child links and Windows junction handling, independent private copies, source immutability, disposable version-query cwd, and waiting for validators before cleanup.
- [x] Run `npm test`, `npm run verify:sample`, and `npm run verify:panel`; report skips separately. Use real KiCad where available. Run UI verification only if renderer/host behavior changes justify it.
- [x] Update existing docs to match delivered behavior and report full source/test diff plus exact validation evidence to Astra. Do not commit until review returns.

Completed in the validation worktree. Follow-up excluded the original project from automatic version/ERC/DRC discovery, preserved explicit trusted operator overrides, canonicalized internally created temp roots, and verified trusted request/patch propagation. Astra-identified schematic-patch candidate gaps (`excludeProjectDir` plus canonical temp root) were closed in the same implementation commit.

## Task 2: Review and integrate validated boundary work

**Files:** Same scoped files as Task 1; this plan is maintained by Astra in main.

- [x] Astra reviews the complete diff and evidence; Grok fixes confirmed scoped issues and reruns affected checks.
- [x] Grok stages explicit scoped paths, commits the validation branch, and verifies main has no unrelated changes before local merge. Coordinate the plan file so it is not silently staged with implementation.
- [x] Merge locally into main using fast-forward where possible. Record resulting SHA and `git status --short --branch`; do not push implicitly.

Independent review accepted the increment, including the schematic-patch correction. Implementation commit `f1470c816577e05116dd575168fe58536aa8a82e` (`fix: harden KiCad CLI selection and inspection copy boundary`) was fast-forwarded onto local `main` from `6b3e89b`. Remote `origin/main` remains `6b3e89b`; this task does not push.

## Task 3: Resolve pending RESET/BOOT routing increment

**Files:** `src/kicad/project-generator.js`, `tests/project-generator.test.js` in the existing route-reset-boot worktree.

- [x] Compare pending delta with current main; retain only behavior not already delivered and inspect width/layer collision implications. Preserve original uncommitted work until a reviewed commit exists.
- [x] Run focused generator tests and KiCad DRC on both supported profiles before and after the candidate. Track violation and unconnected counts separately; zero violations is not a fully connected board.
- [x] Integrate only if no regression and the bounded route improvement is demonstrated; otherwise document exact remaining work and keep it unmerged. Do not expand this into a complete router redesign.

Routing assessment is complete and the draft remains unmerged. ESP32 pending work adds one F.Cu GND zone-island unconnected item absent from main, which fails the existing increment gate (ESP32 at most 22 unconnected, STM32 at most 20, no new GND disconnect). Preserve the two uncommitted routing files until a bounded corridor/routing change removes that island.

| KiCad 10.0.3 board | Main violations / unconnected | Pending violations / unconnected |
| --- | --- | --- |
| ESP32-S3 | 0 / 24 | 0 / 23 |
| STM32 | 0 / 22 | 0 / 20 |

Both pending boards connect RESET/BOOT endpoints and the focused generator suite passed 15/15. All four boards remain incompletely connected; zero rule violations does not establish release readiness. Evidence: local temp `chatpcb-reset-boot-review/REPORT.md`, `comparison.json`, and per-board DRC reports.

## Final local integration, 2026-09-09

Orca Run: `run_ef8c621fb480`. Implementation SHA: `f1470c816577e05116dd575168fe58536aa8a82e` on `feat/kicad-validation-boundary` and local `main`.

**Pre-merge:** `git fetch origin` succeeded. Local `main` at `C:\Users\windo\orca\OH-MY-ChatPCB` was `6b3e89b`, matching `origin/main`, with only the coordinator-owned untracked file `docs/superpowers/plans/2026-09-08-next-work-integration.md`. Ancestry still permitted a fast-forward (`6b3e89b` is an ancestor of `f1470c8`). Implementation was not changed during this integration.

**Merge:** `git merge --ff-only feat/kicad-validation-boundary` updated `6b3e89b..f1470c8`. Local `main` is `f1470c8`, one commit ahead of `origin/main`. No push, no branch or worktree deletion, no reset, and no unrelated-history merge.

**Verification on local main after merge:**

- `npm test` exit code `0`. TAP totals: 213 tests, 212 passed, 0 failed, 1 skipped (`does not follow symlinks` is skipped on `win32` in `tests/artifact-inventory.test.js`). Duration 26234.4535 ms.
- Raw log: `C:\Users\windo\AppData\Local\Temp\oh-my-chatpcb-main-npm-test-f1470c8.log`
- Working-tree `git diff --check` and `--cached` exit `0`. Range `6b3e89b..f1470c8` reports existing `new blank line at EOF` in `docs/superpowers/plans/2026-09-05-kicad-validation-boundary.md:37` and `src/workflow/inspection-copy.js:63`; those implementation files were left unchanged.

**Retained unmerged work:**

- RESET/BOOT draft stays uncommitted in `workspaces/OH-MY-ChatPCB/route-reset-boot` (`guyster323/route-reset-boot` at `723eb1d`): dirty `src/kicad/project-generator.js` and `tests/project-generator.test.js`.
- Native ChatPCB3 remote `origin/codex/schematic-quality-improvements` (`c179e81`) remains unmerged; no common ancestor with this repository's main.

**Remaining limitations (not release-ready):**

- External analyzer execution remains disabled (`ANALYZER_SANDBOX_UNAVAILABLE`).
- General PATH aliases, a full OS sandbox, and concurrent same-account mutation remain outside this increment.
- Supported-profile boards are still incompletely connected; ERC/DRC success is not manufacturing or release evidence.
- RESET/BOOT routing is not integrated because ESP32 pending DRC adds a new GND island.

This plan file is committed separately as docs after verification. Implementation files were not restaged with it.

## Subsequent backlog, after pending work is resolved

1. Deterministic pin-to-net connectivity and power-tree facts, with explicit partial/unsupported status.
2. KiCad 9/10 compatibility corpus with actual executable evidence.
3. DRC-clean, fully connected supported-profile boards; then manufacturing exports with human release gates.
4. KiCad fork packaging, platform CI smoke tests, and upstream rebase workflow.

Next local priorities after this integration: keep the RESET/BOOT draft unmerged until a bounded change removes the ESP32 GND island without violating the existing unconnected gates; keep ChatPCB3 as a separate architectural decision; then resume the backlog above starting with deterministic pin-to-net connectivity. Do not treat local `main` at `f1470c8` as a release.
