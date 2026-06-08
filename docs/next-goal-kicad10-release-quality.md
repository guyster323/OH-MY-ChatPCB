# Next Goal: KiCad 10 Update Path and Release-Quality Circuit UX

This handoff is for the next Codex session. Start here before editing code.

## Why This Is The Next Goal

The current ChatPCB flow proves integration, not production schematic quality.
The KiCad fork panel can launch and generate a project, but the generated MCU
schematic is still a constrained fixture-style draft. A normal user will also
accept KiCad update prompts, so the product must handle the latest official
KiCad stable release path instead of relying only on the local fork build.

As of 2026-06-08, the official KiCad latest stable release found during the
previous session was KiCad 10.0.3. Verify this again before acting because the
latest release can change.

## Current Verified Baseline

- Root repo: `C:\Users\windo\chatpcb2`
- Root commit: `ff9b888 feat: complete ChatPCB KiCad panel flow`
- KiCad fork checkout: `C:\Users\windo\kicad-source-mirror-chatpcb`
- KiCad fork branch: `chatpcb-panel-scaffold`
- KiCad fork commit from prior handoff: `6818a8e feat: wire ChatPCB panel into schematic editor`
- Local official KiCad detected before this handoff: `C:\Program Files\KiCad\9.0`
- Official KiCad 10 was not installed locally at that time.
- Built fork executable verified before this handoff:
  `C:\Users\windo\kicad-source-mirror-chatpcb\build\chatpcb-vcpkg\eeschema\eeschema.exe`
- The fork panel previously showed `Connected` and `codex: available`.
- In-KiCad Generate previously created artifacts under
  `C:\Users\windo\chatpcb2\workspaces\panel-project-from-kicad`.

## User-Observed Problems

1. The visible schematic quality was poor from a general-user perspective.
2. KiCad displayed an update message.
3. A general user would normally update KiCad, so the latest-stable path must
   be tested directly.

## Important Product Distinction

Do not conflate these two paths:

- **Latest official KiCad user path:** official KiCad opens and validates
  ChatPCB-generated `.kicad_pro`, `.kicad_sch`, and future `.kicad_pcb` files.
- **ChatPCB embedded panel path:** the ChatPCB side panel exists only in the
  local KiCad fork until it is rebased/ported/packaged against a newer KiCad
  source branch.

Both matter, but they have different acceptance criteria.

## Goal Prompt For New Session

Paste the prompt below into a new Codex session using the Goal command. Fill in
the bracketed placeholders first.

```text
Goal: Continue the OH-MY-ChatPCB work from C:\Users\windo\chatpcb2 and make a direct, user-facing decision about KiCad latest-stable compatibility and schematic release quality.

Context:
- Root repo: C:\Users\windo\chatpcb2
- KiCad fork checkout: C:\Users\windo\kicad-source-mirror-chatpcb
- Start by reading:
  1. C:\Users\windo\chatpcb2\docs\next-goal-kicad10-release-quality.md
  2. C:\Users\windo\chatpcb2\docs\handoff-next-session.md
  3. C:\Users\windo\chatpcb2\plan.md
  4. C:\Users\windo\chatpcb2\CONTRIBUTING.md
- The previous verified root commit was ff9b888.
- The previous verified KiCad fork commit was 6818a8e.
- The previous built fork executable was:
  C:\Users\windo\kicad-source-mirror-chatpcb\build\chatpcb-vcpkg\eeschema\eeschema.exe

My constraints and preferences:
- I am testing as a general user, not only as a developer.
- If KiCad shows an update prompt, assume a normal user would update.
- Verify the latest official KiCad stable version from official KiCad sources before installing or testing it.
- Do not store provider credentials or remote API keys.
- Use local provider sessions only.
- Use TDD for behavior changes.
- Use Computer Use for direct GUI verification where feasible.
- Keep the final answer honest: separate "integration works" from "circuit is release-quality."

User-fill values:
- 이 PC에 공식 KiCad 최신 안정판을 설치/업데이트해도 되는가: [예]
- 설치가 가능하다면 선호 방식: [winget / 이미 받은 설치 파일 경로: C:\Program Files\KiCad\9.0\]
- 릴리스 수준으로 만들거나 리뷰 루프의 기준 샘플로 사용할 회로: [USB-C 전원 입력을 받는 ESP32 센서 보드. 3.3V 레귤레이터, I2C 센서 커넥터, UART 디버그 헤더, SWD, 리셋 버튼, 상태 LED 포함]
- 목표 MCU 또는 컨트롤러, 정확한 부품명을 알면 기입: [ESP32-S3]
- 필수 전원 입력: [USB-C 5V]
- 필요한 전원 레일과 전류 예산: [3.3V 500mA]
- 필수 인터페이스: [I2C 센서, UART 디버그, SWD, USB, SPI, GPIO 헤더]
- 제조/릴리스 목표: [JLCPCB 발주 가능 수준]
- 이번 세션에서 원하는 우선 결과: [제한된 한 회로를 릴리스 가능한 수준까지 개선과 회로 리뷰-개선 UX 루프 추가 둘 다]

Required work:
1. Reconstruct current repo and fork state with git status/log. Do not assume the handoff is current.
2. Verify current official KiCad latest stable from official KiCad sources.
3. If allowed above, install or update official KiCad latest stable and record the exact installed path/version.
4. Generate a fresh ChatPCB project from the chosen target prompt.
5. Open the generated project in official latest KiCad and inspect it as a user:
   - update/privacy/setup prompts
   - project opens without breakage
   - schematic readability
   - symbol library resolution
   - ERC output
   - SVG/PDF export if available
6. Also test the existing KiCad fork panel path separately:
   - built fork launches
   - ChatPCB panel connects
   - provider status is visible
   - Generate from inside KiCad writes artifacts
7. Decide, based on evidence, whether this session should focus on:
   - release-quality circuit generation for a narrow supported board, or
   - a user UX loop that reviews the generated schematic, lists issues, proposes fixes, previews patches, applies approved fixes, reruns ERC, and records residual risks.
8. Implement the selected path using TDD.

Release-quality circuit bar:
- Do not call the circuit release-ready just because ERC is clean.
- A release-ready constrained circuit must have real KiCad/library symbols where possible, explicit part values, footprints, power flags/rails, decoupling strategy, reset/boot/debug wiring, connector pinout, design assumptions, and ERC with zero errors.
- Any unresolved item must be visible to the user as a blocker or residual risk.
- If exact parts or design requirements are missing, prefer a review-and-improve UX loop over pretending the circuit is production-ready.

Review-loop UX bar:
- The panel must show review findings in user language, not only raw logs.
- Findings should be grouped by severity: blockers, warnings, notes.
- Each proposed fix should be previewed as a diff before applying.
- Applying fixes must be approval-gated and rollback-safe.
- The loop must rerun validation after each approved patch.
- The final state must say either "ready for release", "ready for prototype review", or "blocked", with reasons.

Verification expected before completion:
- npm test
- npm run verify:sample
- npm run verify:panel
- npm run verify:ui
- official KiCad latest-stable open/validate/export smoke test for the generated project, if installed
- built KiCad fork panel GUI smoke test with Computer Use, if feasible
- git diff --check
- final git status for both root repo and KiCad fork

Completion:
- Update C:\Users\windo\chatpcb2\docs\handoff-next-session.md with exact findings, commands, versions, blockers, and next steps.
- Update C:\Users\windo\chatpcb2\plan.md if phases or acceptance criteria changed.
- Commit and push only if the implementation and verification are complete.
```

## Recommended First Files

Open these in this order:

1. `docs/next-goal-kicad10-release-quality.md`
2. `docs/handoff-next-session.md`
3. `plan.md`
4. `CONTRIBUTING.md`
5. `src/runtime/circuit-spec.js`
6. `src/kicad/project-generator.js`
7. `src/workflow/generate-mcu-project.js`
8. `src/workflow/schematic-patch.js`
9. `apps/panel/panel.js`
10. `tests/project-generator.test.js`
11. `tests/schematic-patch.test.js`
12. `tests/validate-project.test.js`

## Suggested Implementation Direction

Start with latest KiCad compatibility because it is a user trust issue. Then
choose one of two product paths:

- If the user provides enough exact circuit requirements, improve one narrow
  MCU board generator until it reaches a documented prototype/release gate.
- If requirements are incomplete, implement the review-and-improve UX loop and
  make the system clearly state what is missing before release.

The second path is safer for a general-purpose ChatPCB product because most
real users will not provide complete electrical requirements on the first
prompt.
