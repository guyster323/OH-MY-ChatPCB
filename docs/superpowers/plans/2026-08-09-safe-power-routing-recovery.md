# Safe Power-Routing Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recover zero KiCad DRC violations for supported-profile PCB drafts by removing unsafe rotation, zone, and endpoint-pad routing behavior.

**Architecture:** The project generator retains the existing profile placement map and generic bounded router. It changes J4 to zero rotation, disables the unfilled profile GND zone, and makes the profile-power safety check examine every other-net pad, including pads on endpoint footprints.

**Tech Stack:** Node.js 24 ESM, Node test runner, KiCad 10.0.3 CLI.

## Global Constraints

- Apply changed placement and profile-power routing only to supported board profiles.
- J4 must render at (at 18 65 0); generic J4 placement is unchanged.
- Do not serialize a profile GND zone.
- Reject direct segments within 1.0 mm of every other-net pad, including endpoint-footprint pads.
- Preserve the generic same-net router for all supported and generic nets.
- Do not route USB, I2C, UART, SPI, GPIO, reset/boot, or debug signals.
- Both profile DRC reports must have zero violations and no more than 40 ESP32-S3 / 37 STM32 unconnected items.
- Do not claim release readiness.

---

### Task 1: Specify and implement safe profile-power output

**Files:**
- Modify: `tests/project-generator.test.js:324-371`
- Modify: `src/kicad/project-generator.js:10-116`
- Modify: `src/kicad/project-generator.js:622-855`

**Interfaces:**
- Consumes: `renderKiCadBoard({ baseName, schematic, boardProfile })`.
- Produces: profile board text with unrotated J4, no zone, generic routing enabled, and safe `renderProfilePowerSegments` filtering.

- [ ] **Step 1: Write the failing test**

Change `supported profile PCB power intent uses fixed placement, routing, and ground zone` to `supported profile PCB power intent rejects unsafe endpoint-pad routes`. For each profile assert:

```js
assert.match(board, /\(at 18 65 0\)/);
assert.doesNotMatch(board, /\(at 18 65 90\)/);
assert.doesNotMatch(board, /\(zone\s+\(net \d+\)\s+\(net_name "GND"/);
assert.equal(boardHasSegmentNear(board, { x: 34.225, y: 55 }, { x: 51, y: 54.5 }), false);
```

Keep the existing C2 and J6 profile-placement assertions. Add one assertion that the board still contains at least one generic signal segment, using the declared `SCL` net id and `boardPowerSegmentCount` renamed to `boardSegmentCount`.
Add `boardHasSegmentNear(board, first, second)`, which parses each segment start/end coordinate and returns true when either direction is within 0.02 mm of both requested points.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `node --test --test-name-pattern "supported profile PCB power intent rejects unsafe" tests/project-generator.test.js`

Expected: FAIL because current output has J4 rotation 90, a GND zone, and explicit power segments.

- [ ] **Step 3: Implement the minimal safe behavior**

Change only these production behaviors:

```js
J4: { x: 18, y: 65, rotation: 0 }
```

Remove `renderGroundZone` and its call. Remove the profile-mode `continue` that skips non-power generic nets. In `profilePowerSegmentRunsNearOtherNetPad`, skip only centers on the same net:

```js
if (center.netName === netName) return false;
return distanceFromPointToSegment(center, start, end) < BOARD_CROSS_FOOTPRINT_TRACE_PAD_KEEP_OUT_MM;
```

This causes all unsafe direct profile-power pairs to be omitted while leaving the generic bounded routing active.

- [ ] **Step 4: Run focused and file tests**

Run:

```powershell
node --test --test-name-pattern "supported profile PCB power intent rejects unsafe" tests/project-generator.test.js
node --test tests/project-generator.test.js
```

Expected: the focused test and every project-generator test pass.

- [ ] **Step 5: Commit**

```powershell
git add src/kicad/project-generator.js tests/project-generator.test.js
git commit -m "fix: recover safe supported profile routing"
```

### Task 2: Verify KiCad recovery and record evidence

**Files:**
- Modify: `docs/handoff-next-session.md`

**Interfaces:**
- Consumes: the implementation commit, two fresh profile projects, and `C:\Users\windo\AppData\Local\Programs\KiCad\10.0\bin\kicad-cli.exe`.
- Produces: verified DRC and unconnected-item measurements.

- [ ] **Step 1: Generate profiles and run official DRC**

Run the two existing release-profile generation commands, then:

```powershell
& "C:\Users\windo\AppData\Local\Programs\KiCad\10.0\bin\kicad-cli.exe" pcb drc --output .\workspaces\esp32-s3-usbc-sensor-profile\chatpcb-drc.json --format json .\workspaces\esp32-s3-usbc-sensor-profile\chatpcb_mcu_peripheral.kicad_pcb
& "C:\Users\windo\AppData\Local\Programs\KiCad\10.0\bin\kicad-cli.exe" pcb drc --output .\workspaces\stm32-usbc-sensor-profile\chatpcb-drc.json --format json .\workspaces\stm32-usbc-sensor-profile\chatpcb_mcu_peripheral.kicad_pcb
```

Parse `.violations` and `.unconnected_items` in both JSON reports.

- [ ] **Step 2: Enforce acceptance before documentation**

Proceed only if both violation counts are zero and unconnected items are no greater than ESP32-S3 40 / STM32 37. Otherwise report BLOCKED with exact counts and do not change tracked docs.

- [ ] **Step 3: Run complete verification**

```powershell
npm test
npm run verify:sample
npm run verify:panel
npm run verify:ui
git diff --check
```

Expected: all commands exit zero; the typed NGSPICE_UNAVAILABLE sample skip is allowed.

- [ ] **Step 4: Record evidence and commit**

Append a dated handoff entry with the recovery commit, KiCad 10.0.3, DRC counts, unconnected counts, and remaining routing/release blockers. Keep readiness below release-ready.

```powershell
git add docs/handoff-next-session.md
git commit -m "docs: record safe routing recovery"
```

## Plan Self-Review

- Task 1 covers every source and test behavior in the approved design.
- Task 2 is the only task permitted to update handoff documentation and does so only after the measured gate passes.
- The names, constants, and acceptance values match the design document.
