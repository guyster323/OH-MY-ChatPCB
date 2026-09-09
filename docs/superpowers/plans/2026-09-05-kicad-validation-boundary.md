# KiCad validation boundary hardening

Base: 6b3e89b; branch feat/kicad-validation-boundary.
Implementer: gpt-5.6-luna, max reasoning effort. Controller reviews diff and security regressions.

## Threat model and compatibility
Untrusted daemon JSON and provider tool payloads must not choose the executable launched as KiCad. Server dispatch configuration, environment and direct local CLI flags are operator-controlled; retain local CLI --kicad-cli compatibility and document this distinction. An attacker may supply a project containing symlinks/junctions or paths through linked ancestors. KiCad binaries and the OS user account are trusted; this patch is not an OS sandbox. External analyzers stay disabled.

## Milestone 1 — executable selection boundary
- Add trusted kicadCliPath in daemon dispatch options. Request args.kicadCliPath must be rejected with typed error or ignored consistently before any launch. Provider-emitted values must be stripped and cannot override server configuration.
- Propagate trusted config through recursive provider dispatch and project.request validation/patch paths; inspect, ERC, DRC and version queries must use it consistently.
- Keep local CLI inspect/validate/drc --kicad-cli as trusted operator input. Do not label direct local API code injection as remote attack.
- Move version query cwd to disposable inspection workspace; never launch version checks with authoritative project as cwd.
- Audit fallback lookup: project-local kicad-cli must not become executable through cwd search; daemon config is separate from request args. Automatic PATH discovery also excludes the original project tree (`excludeProjectDir`) so inspect cannot select a project binary after changing cwd to the disposable copy. Trusted `explicitPath` and `KICAD_CLI_PATH` remain operator overrides.
- Canonicalize only internally created temp roots with `realpath` before validating a copy (inspection and schematic-patch candidate trees). Continue rejecting user-supplied project and ancestor links; callers must pass canonical project paths. Patch-candidate ERC must pass `excludeProjectDir` as the original project so automatic discovery cannot select a project-tree binary after cwd changes to the copy.

## Milestone 2 — safe inspection copy
- Reject root/ancestor symlink or junction traversal, child file/directory links, and report/library links before KiCad/version execution.
- Use a shared focused helper to validate paths and create a private, verified copy with regular independent files. Never preserve symlinks into the validation tree. Avoid silently following source links or copying target contents from outside the requested tree.
- Resolve/cross-check actual project containment where allowedWorkspaceRoot is applicable. Keep async filesystem validation separate from existing synchronous lexical guards where necessary.
- Validate copy before use, do not run toolchain concurrently before source safety checks finish, await active validators before cleanup on failure.
- Preserve existing typed missing-board/schematic skips, artifact/freshness fields, final digest binding, and original source bytes for successful normal inspect.

## Milestone 3 — proof and tests
Add failing regression tests first for:
- direct daemon malicious kicadCliPath and provider alias payload attempts never reach executable selection;
- trusted server path propagated through relevant branches;
- root link, ancestor link, directory junction and child/report symlink rejected with typed error before validators/toolchain;
- legitimate validators may mutate only copy files and original source bytes/digest remain unchanged;
- version cwd is disposable, cleaned after completion;
- errors do not race cleanup against still-running validators.
Prefer portable temp fixtures and junctions on Windows; only explicit capability-based skips where unavailable.
Run focused tests then full npm test. Live KiCad sample inspection and panel flows reviewed by controller.

## Milestone 4 — handoff
Worker edits source/tests only, writes .superpowers/kicad-validation-report.md with exact red/green and test results. Do not commit/push/merge or spawn agents. Controller updates public docs from final behavior, reviews source-to-sink paths and requested conditions, asks worker to fix confirmed gaps, then verifies and reports outcome. No sandbox or Phase 3 capability implementation in this task.

