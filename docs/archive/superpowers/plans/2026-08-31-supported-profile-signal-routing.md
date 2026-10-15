# Supported Profile Signal Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route the SCL and SDA profile paths with explicit safe waypoint chains and reduce both supported-profile DRC unconnected totals without adding violations.

**Architecture:** Keep generic routing unchanged. Add a small declarative profile route-chain table and a renderer that evaluates each pad pair against the existing pad-clearance, maximum-leg, and cross-net-intersection rules. Rejected chains create no segment.

**Tech Stack:** Node.js, `node:test`, KiCad 10.0.3 CLI, generated KiCad PCB S-expressions.

**Spec:** `docs/superpowers/specs/2026-08-31-supported-profile-signal-routing-design.md`

## Global Constraints

- Preserve zero KiCad DRC violations for ESP32-S3 and STM32 profiles.
- Do not alter VBUS, +3V3, USB data, RESET, BOOT, ground-zone, or BMS topology in this increment.
- Keep every generated route leg at most 30 mm.
- Keep the current shared worktree uncommitted; do not stage or commit pre-existing changes.

---

### Task 1: Define the waypoint-route contract

**Files:**
- Modify: `tests/project-generator.test.js`

**Interfaces:**
- Produces a regression test for profile SCL/SDA waypoint segments.

- [x] **Step 1: Add the failing test**

```js
assert.ok(boardSegmentCount(board, 'SCL') >= 2);
assert.ok(boardSegmentCount(board, 'SDA') >= 2);
assert.equal(boardHasSegmentNear(board, { x: 47, y: 43 }, { x: 113.825, y: 79 }), false);
assert.equal(boardSegmentSpans(board).every((span) => span <= 30), true);
```

Run: `node --test tests/project-generator.test.js`

Expected: FAIL because the profile renderer has no SCL/SDA route chains.

### Task 2: Render explicit profile waypoint chains

**Files:**
- Modify: `src/kicad/project-generator.js`
- Test: `tests/project-generator.test.js`

**Interfaces:**
- Consumes `PROFILE_SIGNAL_ROUTE_CHAINS` objects shaped as `{ netName, references, anchors, options }`.
- Produces `renderProfileWaypointRoutes(...)`, which delegates each leg to existing `canAddBoardSegment` checks.

- [x] **Step 1: Add route-chain declarations**

```js
const PROFILE_SIGNAL_PATHS = [
  ['SCL', ['J2', 'R4'], { anchors: [{ x: 47, y: 39 }, { x: 70, y: 39 }, { x: 90, y: 60 }, { x: 113, y: 60 }] }],
  ['SDA', ['J2', 'R5'], { anchors: [{ x: 42, y: 45.54 }, { x: 42, y: 65 }, { x: 44, y: 90 }, { x: 26, y: 90 }] }]
];
```

- [x] **Step 2: Evaluate each source/destination pad pair**

Build `[start, ...anchors, end]`, pass it through `polylineLegs`, then use `legsEverySegmentSafe` and `addBoardSegment` with the existing 1.0 mm different-net keepout. Choose only the shortest accepted path.

- [x] **Step 3: Run the focused GREEN test**

Run: `node --test tests/project-generator.test.js`

Expected: all tests pass and the new assertions prove multi-leg SCL/SDA routes.

### Task 3: Measure KiCad output

**Files:**
- Modify only if results are measured: `plan.md`, `docs/handoff-next-session.md`

- [x] **Step 1: Regenerate both profiles**

```powershell
node ./bin/chatpcb-cli.js generate --project ./workspaces/esp32-s3-usbc-sensor-profile --prompt "Release profile ESP32-S3 USB-C 5V sensor board with 3.3V 500mA regulator, I2C sensor connector, UART debug header, SWD, USB, SPI, GPIO header, reset button, and status LED."
node ./bin/chatpcb-cli.js generate --project ./workspaces/stm32-usbc-sensor-profile --prompt "Release profile STM32 USB-C 5V sensor board with 3.3V 500mA regulator, I2C sensor connector, UART debug header, SWD, USB, SPI, GPIO header, reset button, and status LED."
```

- [x] **Step 2: Run board DRC**

```powershell
node ./bin/chatpcb-cli.js drc --project ./workspaces/esp32-s3-usbc-sensor-profile
node ./bin/chatpcb-cli.js drc --project ./workspaces/stm32-usbc-sensor-profile
```

Expected: zero violations and at most 24 ESP32 / 22 STM32 unconnected items. If either report has a violation, remove the candidate route and record the failure without updating counts.

Actual: ESP32-S3 `0` violations / `24` unconnected; STM32 `0` violations / `22` unconnected.

- [x] **Step 3: Run regression verification**

Run: `npm test`, `npm run verify:sample`, `npm run verify:panel`, `npm run verify:ui`.

Expected: every command exits with code 0.

Actual: `npm test` passed `107/107`; `verify:sample`, `verify:panel`, and `verify:ui` passed. The sample simulation correctly returned the existing typed `NGSPICE_UNAVAILABLE` skip.
