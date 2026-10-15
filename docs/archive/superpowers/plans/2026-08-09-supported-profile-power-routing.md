# Supported-Profile Power Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate deterministic common power placement, explicit power routing, and a GND zone for ESP32-S3 and STM32 supported-profile PCB drafts while retaining zero DRC violations.

**Architecture:** `renderKiCadBoard` resolves a small placement-intent map before emitting footprints. Its pad-center data drives a profile-power routing pass for VBUS, `SW_3V3`, and `+3V3`, followed by the existing generic bounded same-net routing. A renderer emits one GND zone inside the fixed board outline.

**Tech Stack:** Node.js 24 ESM, Node test runner, KiCad 10.0.3 `kicad-cli`.

## Global Constraints

- Apply placement, explicit routing, and the GND zone only to supported board profiles.
- Do not route USB, I2C, UART, SPI, GPIO, reset/boot, or debug signals in this increment.
- Never connect distinct nets or emit routing outside the `10,10` to `160,120` board outline.
- Keep generic same-net segments bounded by 30 mm and their existing other-net-pad keep-out rule.
- Do not add a release-ready claim; retain `ready-for-prototype-review` or `blocked`.
- KiCad 10.0.3 DRC must report zero violations for both supported profiles.

---

## File Structure

- Modify `src/kicad/project-generator.js` to resolve placements, render profile power segments, and render a GND zone.
- Modify `tests/project-generator.test.js` to assert placements, power routing, zone structure, and bounded segments.
- Modify `docs/handoff-next-session.md` only after live DRC measurements succeed.

### Task 1: Specify supported-profile board output

**Files:**
- Modify: `tests/project-generator.test.js:255-323`

**Interfaces:**
- Consumes: `generateMcuPeripheralProject({ projectDir, prompt })`.
- Produces: failing coverage for `renderKiCadBoard({ baseName, schematic, boardProfile })` output.

- [ ] **Step 1: Write the failing test**

Add a test named `supported profile PCB power intent uses fixed placement, routing, and ground zone`. Generate both existing release-profile prompts, then assert:

```js
assert.match(board, /\(at 18 65 90\)/);
assert.match(board, /\(at 52 55 0\)/);
assert.match(board, /\(zone\s+\(net \d+\)\s+\(net_name "GND"\)[\s\S]*?\(layer "F\.Cu"\)/);
assert.ok(boardPowerSegmentCount(board, 'VBUS') >= 2);
assert.ok(boardPowerSegmentCount(board, 'SW_3V3') >= 1);
assert.ok(boardPowerSegmentCount(board, '+3V3') >= 2);
```

Add `boardPowerSegmentCount(board, netName)`: find `netName` in the board net declarations, read its numeric id, and count `(segment ...)` blocks that contain `(net <id>)`.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `node --test --test-name-pattern "supported profile PCB power intent" tests/project-generator.test.js`

Expected: FAIL because the board currently has no zone and no fixed placement intent.

- [ ] **Step 3: Confirm the failure is behavioral**

The failing assertion must name missing placement, zone, or explicit power routing. If it is a fixture or parser error, correct the test setup and rerun before production changes.

- [ ] **Step 4: Commit the failing test**

```powershell
git add tests/project-generator.test.js
git commit -m "test: specify supported profile power routing"
```

### Task 2: Implement placement, power paths, and the GND zone

**Files:**
- Modify: `src/kicad/project-generator.js:47-99`
- Modify: `src/kicad/project-generator.js:467-751`

**Interfaces:**
- Consumes: `renderKiCadBoard({ baseName, schematic, boardProfile })` where `boardProfile` is `spec.boardProfile`.
- Produces: `boardPlacementFor(componentModel, index, profileMode)`, `renderProfilePowerSegments(...)`, and `renderGroundZone(netIds, profileMode)`.

- [ ] **Step 1: Pass profile data and resolve placements**

Pass `spec.boardProfile` from `generateMcuPeripheralProject` to `renderKiCadBoard`. Add this map and helper:

```js
const PROFILE_BOARD_PLACEMENTS = {
  J4: { x: 18, y: 65, rotation: 90 }, C3: { x: 35, y: 55, rotation: 0 },
  U1: { x: 52, y: 55, rotation: 0 }, L1: { x: 65, y: 55, rotation: 0 },
  C2: { x: 78, y: 55, rotation: 0 }
};
function boardPlacementFor(componentModel, index, profileMode) {
  return profileMode && PROFILE_BOARD_PLACEMENTS[componentModel.ref]
    ? PROFILE_BOARD_PLACEMENTS[componentModel.ref]
    : { x: 25 + (index % 5) * 22, y: 25 + Math.floor(index / 5) * 18, rotation: 0 };
}
```

Pass `rotation` through `renderBoardFootprint`, `renderEmbeddedBoardFootprint`, and `transformBoardFootprintBlock` so its `(at ...)` value no longer hard-codes zero.

- [ ] **Step 2: Implement the explicit profile-power routing pass**

Call `renderProfilePowerSegments` before the generic loop in `renderBoardSegments` only when `profileMode` is true. Use exactly these paths:

```js
const PROFILE_POWER_PATHS = [
  ['VBUS', ['J4', 'C3', 'U1']], ['SW_3V3', ['U1', 'L1']],
  ['+3V3', ['L1', 'C2', 'U1']]
];
```

For each adjacent reference pair, choose the closest pad centers on that net. Skip absent, identical, over-30-mm, or 1.0-mm-other-net-pad-keep-out pairs. Reuse `addBoardSegment` and its key set so generic routing cannot duplicate explicit paths.

- [ ] **Step 3: Render the profile-only GND zone**

Append `renderGroundZone(netIds, profileMode)` after segments in `renderKiCadBoard`. Return an empty string without `profileMode` or a GND id. Otherwise render:

```text
  (zone (net <gnd-id>) (net_name "GND") (layer "F.Cu") (hatch edge 0.5)
    (connect_pads (clearance 0.15)) (min_thickness 0.25)
    (fill yes (thermal_gap 0.3) (thermal_bridge_width 0.3))
    (polygon (pts (xy 10.5 10.5) (xy 159.5 10.5) (xy 159.5 119.5) (xy 10.5 119.5)))
  )
```

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `node --test --test-name-pattern "supported profile PCB power intent" tests/project-generator.test.js`

Expected: PASS for both profiles.

- [ ] **Step 5: Run all project-generator tests**

Run: `node --test tests/project-generator.test.js`

Expected: PASS, including generic draft, footprint, and bounded-segment coverage.

- [ ] **Step 6: Commit the implementation**

```powershell
git add src/kicad/project-generator.js tests/project-generator.test.js
git commit -m "feat: route supported profile power paths"
```

### Task 3: Verify KiCad evidence and update the handoff

**Files:**
- Modify: `docs/handoff-next-session.md`

**Interfaces:**
- Consumes: the two generated profile projects and `C:\Users\windo\AppData\Local\Programs\KiCad\10.0\bin\kicad-cli.exe`.
- Produces: verified DRC violation and unconnected-item counts in the handoff.

- [ ] **Step 1: Generate fresh profile projects**

```powershell
node ./bin/chatpcb-cli.js generate --project ./workspaces/esp32-s3-usbc-sensor-profile --prompt "Release profile ESP32-S3 USB-C 5V sensor board with 3.3V 500mA regulator, I2C sensor connector, UART debug header, SWD, USB, SPI, GPIO header, reset button, and status LED."
node ./bin/chatpcb-cli.js generate --project ./workspaces/stm32-usbc-sensor-profile --prompt "Release profile STM32 USB-C 5V sensor board with 3.3V 500mA regulator, I2C sensor connector, UART debug header, SWD, USB, SPI, GPIO header, reset button, and status LED."
```

- [ ] **Step 2: Run DRC and enforce measured criteria**

```powershell
& "C:\Users\windo\AppData\Local\Programs\KiCad\10.0\bin\kicad-cli.exe" pcb drc --output .\workspaces\esp32-s3-usbc-sensor-profile\chatpcb-drc.json --format json .\workspaces\esp32-s3-usbc-sensor-profile\chatpcb_mcu_peripheral.kicad_pcb
& "C:\Users\windo\AppData\Local\Programs\KiCad\10.0\bin\kicad-cli.exe" pcb drc --output .\workspaces\stm32-usbc-sensor-profile\chatpcb-drc.json --format json .\workspaces\stm32-usbc-sensor-profile\chatpcb_mcu_peripheral.kicad_pcb
```

Expected: zero violations and fewer than 40 ESP32-S3 / 37 STM32 unconnected items. If either condition fails, stop documentation and create a failing regression test for the observed issue.

- [ ] **Step 3: Run full verification**

```powershell
npm test
npm run verify:sample
npm run verify:panel
npm run verify:ui
git diff --check
```

Expected: all Node checks pass; `verify:sample` may return the typed `NGSPICE_UNAVAILABLE` skip; `git diff --check` is silent.

- [ ] **Step 4: Record verified evidence and commit it**

Add a dated handoff entry with the implementation commit, KiCad version, both DRC counts, both unconnected counts, and remaining signal-routing/release-evidence blockers. Do not change readiness to release-ready. Then run:

```powershell
git add docs/handoff-next-session.md
git commit -m "docs: record supported profile power routing verification"
```

## Plan Self-Review

- Spec coverage: Tasks 1-2 implement every scoped output; Task 3 verifies DRC and measured connectivity while recording only evidence that passed.
- Placeholder scan: no deferred implementation markers or unspecified error-handling steps remain.
- Type consistency: Task 2 defines each helper and parameter named by Task 1; generic routing retains its current helper contracts.

