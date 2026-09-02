# Remaining Supported-Profile PCB Connections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce supported ESP32-S3 and STM32 board DRC results to zero violations and zero unconnected items while keeping ADBMS6830 as a schematic-only cell monitor.

**Architecture:** Add net-aware DRC diagnostics, then use a deterministic F.Cu grid planner for long signals and the `+3V3` tree. Handle dense HRO USB-C VBUS and DP/DN with isolated layer-aware escape primitives and live KiCad acceptance gates.

**Tech Stack:** Node.js, `node:test`, generated KiCad 10 PCB S-expressions, KiCad CLI 10.0.3.

**Spec:** `docs/superpowers/specs/2026-08-31-remaining-profile-pcb-connections-design.md`

## Global Constraints

- Preserve zero KiCad DRC violations after every increment.
- Keep the generic other-net pad keepout at `1.0mm` and generated route legs at or below `30mm`.
- Keep ADBMS6830 schematic-only; do not assign U1 a footprint or emit a BMS PCB.
- Do not generate Gerber or drill files until both profile reports are `0/0`.
- Execute in an isolated worktree because the current shared checkout contains pre-existing uncommitted changes.
- Commit only files changed by the task being completed.

---

## Execution Record: 2026-08-31

Task 1 is complete in the shared checkout: `validateBoard` now returns `drc.unconnectedByNet`, with test coverage for `VBUS` and `+3V3` extraction. Fresh KiCad 10.0.3 DRC confirms the safe baseline remains ESP32-S3 `0 violations / 24 unconnected` and STM32 `0 violations / 22 unconnected`.

Tasks 2 and 3 are suspended pending a routing-model revision. A center-point 2 mm grid prototype reduced the RESET/BOOT ratsnest edges, but live DRC found physical-pad clearance violations (`6` ESP32-S3, `8` STM32). Raising center keepout and reserving upward switch exits still left RESET and BOOT competing for the same corridor. The prototype was removed; no DRC-regressive copper remains.

Do not resume Tasks 2–6 with center-only pad obstacles. The replacement design must parse each pad's size, shape, local rotation, and copper layer; test clearance against the actual pad boundary plus trace width and board rule; and reserve distinct corridors or layers for RESET and BOOT before applying the same model to power and USB-C.

### Task 1: Report PCB unconnected counts by net

**Files:**
- Modify: `src/workflow/validate-board.js:91`
- Test: `tests/validate-board.test.js:61`

**Interfaces:**
- Consumes: KiCad JSON `unconnected_items[*].items[*].description` strings containing `[NET_NAME]`.
- Produces: `result.drc.unconnectedByNet: Record<string, number>`.

- [x] **Step 1: Write the failing net-summary test**

Add two unconnected items whose descriptions contain `[VBUS]` and `[+3V3]`, then assert:

```js
assert.deepEqual(result.drc.unconnectedByNet, { VBUS: 1, '+3V3': 1 });
```

- [x] **Step 2: Run the focused test and confirm RED**

Run: `node --test tests/validate-board.test.js`

Expected: FAIL because `unconnectedByNet` is absent.

- [x] **Step 3: Parse and count the first bracketed net name**

Add this helper and call it for each `unconnected_items` entry:

```js
function unconnectedNetName(item) {
  for (const endpoint of item?.items ?? []) {
    const match = endpoint?.description?.match(/\[([^\]]+)\]/);
    if (match) return match[1];
  }
  return 'unknown';
}
```

Increment `unconnectedByNet[netName]` once per KiCad unconnected item, not once per endpoint.

- [x] **Step 4: Run focused and full tests**

Run: `node --test tests/validate-board.test.js` and `npm test`.

Expected: PASS; clean reports return `{}`.

- [ ] **Step 5: Commit**

```powershell
git add src/workflow/validate-board.js tests/validate-board.test.js
git commit -m "feat: summarize board disconnects by net"
```

### Task 2: Add a deterministic obstacle-aware F.Cu route planner

**Files:**
- Create: `src/kicad/board-route-planner.js`
- Create: `tests/board-route-planner.test.js`
- Modify: `src/kicad/project-generator.js:949`

**Interfaces:**
- Produces: `findGridRoute({ start, end, netName, padCenters, segments, outline, gridMm, keepOutMm, maxLegMm }): Point[] | null`.
- Consumes: `{x, y, netName, ref}` pad centers and `{start, end, netName}` accepted segments.

- [ ] **Step 1: Write planner RED tests**

Test that the planner routes around a different-net pad centered on the direct path, keeps every returned leg at most 30 mm, is deterministic for identical inputs, and returns `null` when obstacles close every corridor.

```js
const route = findGridRoute({
  start: { x: 10, y: 10 },
  end: { x: 50, y: 10 },
  netName: 'RESET',
  padCenters: [{ x: 30, y: 10, netName: 'GND', ref: 'JX' }],
  segments: [],
  outline: { minX: 0, minY: 0, maxX: 60, maxY: 30 },
  gridMm: 2,
  keepOutMm: 1,
  maxLegMm: 30
});
assert.ok(route.length >= 4);
```

- [ ] **Step 2: Run planner tests and confirm RED**

Run: `node --test tests/board-route-planner.test.js`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement bounded A* search**

Use a 2 mm orthogonal grid, exact start/end nodes, Manhattan distance heuristic, stable neighbor order `[right, down, left, up]`, and the existing geometry rules: other-net pad distance, cross-net intersection, board outline, and 30 mm maximum compressed leg. Collapse collinear grid points before returning.

- [ ] **Step 4: Integrate `route: 'grid'` without changing existing routes**

In `candidateRoutePolylines`, delegate only `options.route === 'grid'` to `findGridRoute`. Keep explicit anchors, `usb-c-escape`, and generic candidates unchanged.

- [ ] **Step 5: Run planner and generator tests**

Run: `node --test tests/board-route-planner.test.js tests/project-generator.test.js`.

Expected: PASS with no existing board output regression.

- [ ] **Step 6: Commit**

```powershell
git add src/kicad/board-route-planner.js src/kicad/project-generator.js tests/board-route-planner.test.js
git commit -m "feat: add bounded board route planner"
```

### Task 3: Route RESET and BOOT through actual profile endpoints

**Files:**
- Modify: `src/kicad/project-generator.js:21`
- Test: `tests/project-generator.test.js:399`

**Interfaces:**
- Consumes: `findGridRoute` from Task 2 and actual SW1/SW2/J7 pad centers.
- Produces: accepted F.Cu RESET and BOOT route segments.

- [ ] **Step 1: Add failing cross-profile assertions**

Generate both profiles and assert `boardSegmentCount(board, 'RESET') >= 2` and `boardSegmentCount(board, 'BOOT') >= 2`, with all spans at most 30 mm and no cross-net intersections.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `node --test tests/project-generator.test.js`.

Expected: FAIL because RESET/BOOT have no profile routes.

- [ ] **Step 3: Add endpoint-driven route declarations**

```js
['RESET', ['SW1', 'J7'], { route: 'grid', width: 0.2 }],
['BOOT', ['SW2', 'J7'], { route: 'grid', width: 0.2 }]
```

Make `renderBoardSegment(start, end, netId, { width, layer })` emit the requested width while retaining `0.15` and `F.Cu` defaults.

- [ ] **Step 4: Run unit and live KiCad gates**

Run focused tests, regenerate both profiles, then run `chatpcb drc` on both projects.

Expected: zero violations; ESP32-S3 at most 22 unconnected and STM32 at most 20. If either board has a violation, remove only these declarations and preserve the measured failure in the handoff.

- [ ] **Step 5: Commit**

```powershell
git add src/kicad/project-generator.js tests/project-generator.test.js
git commit -m "feat: route profile reset and boot signals"
```

### Task 4: Build one `+3V3` copper tree

**Files:**
- Modify: `src/kicad/project-generator.js:889`
- Test: `tests/project-generator.test.js:340`

**Interfaces:**
- Consumes: grid planner and all `+3V3` pad centers.
- Produces: `connectProfileNetTree(..., { netName: '+3V3', rootRef: 'L1', width: 0.4, route: 'grid' })`.

- [ ] **Step 1: Add a failing power-tree test**

Assert that every `+3V3` component reference in `padCentersByNet.get('+3V3')` participates in the emitted `+3V3` segment graph and every segment uses width `0.4`.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `node --test tests/project-generator.test.js`.

Expected: FAIL because the current output only contains a partial L1/C2 path and opportunistic generic segments.

- [ ] **Step 3: Implement rooted safe-tree connection**

Start from L1 pad 2, repeatedly select the shortest planner-accepted route from the connected copper tree to an unconnected `+3V3` pad group. Treat duplicate pads on one footprint as one group only after emitted copper joins them. Reject a whole candidate route if any leg fails safety validation.

- [ ] **Step 4: Run unit and live KiCad gates**

Expected live result: zero violations; ESP32-S3 at most 10 unconnected and STM32 at most 8.

- [ ] **Step 5: Commit**

```powershell
git add src/kicad/project-generator.js tests/project-generator.test.js
git commit -m "feat: connect profile 3v3 copper tree"
```

### Task 5: Add layer-aware VBUS escape and backbone

**Files:**
- Modify: `src/kicad/project-generator.js:1185`
- Test: `tests/project-generator.test.js`

**Interfaces:**
- Produces: `renderBoardVia({ at, size: 0.8, drill: 0.4, netId })` and layer-aware segments.
- Consumes: J4 VBUS pads, C3 pad 1, U1 VBUS pads, and J1 pad 1.

- [ ] **Step 1: Add failing via/layer tests**

Assert that VBUS output includes B.Cu segments and net-assigned vias, while existing signal routes remain on F.Cu.

- [ ] **Step 2: Run the focused test and confirm RED**

Expected: FAIL because the generator emits only F.Cu segments and no vias.

- [ ] **Step 3: Add board via and layer primitives**

Emit KiCad vias with `(layers "F.Cu" "B.Cu")`, explicit net id, 0.8 mm size, and 0.4 mm drill. Include layer in segment deduplication and cross-layer intersection checks; F.Cu and B.Cu crossings are not copper intersections unless joined by a via.

- [ ] **Step 4: Render the VBUS topology**

Escape each disconnected J4 VBUS copper island outward from the connector pad field, transition to B.Cu, join one B.Cu backbone, then return to F.Cu at C3. Continue on F.Cu from C3 to U1 and from C3 toward J1 using 0.6 mm width. Do not route a centerline directly across the HRO signal pad row.

- [ ] **Step 5: Run live KiCad gates**

Expected: zero violations; ESP32-S3 at most 4 unconnected and STM32 at most 2.

- [ ] **Step 6: Commit**

```powershell
git add src/kicad/project-generator.js tests/project-generator.test.js
git commit -m "feat: add profile vbus escape backbone"
```

### Task 6: Route USB DP/DN duplicate pads and downstream connections

**Files:**
- Modify: `src/kicad/project-generator.js`
- Test: `tests/project-generator.test.js`

**Interfaces:**
- Consumes: layer-aware segments/vias from Task 5 and actual J4/J7 USB pad centers.
- Produces: separate USB_DP and USB_DN copper graphs with no cross-net intersections.

- [ ] **Step 1: Add failing USB graph tests**

For each profile, assert that all J4 pads assigned to USB_DP belong to one emitted copper graph and all USB_DN pads belong to another. For ESP32, also assert each graph reaches its J7 pad. Assert the two graphs never share coordinates or vias.

- [ ] **Step 2: Run the focused test and confirm RED**

Expected: FAIL because HRO duplicate data pads remain disconnected.

- [ ] **Step 3: Implement the USB-specific escape**

Use mirrored short F.Cu fanouts and paired vias so the interleaved A/B duplicate pads can join on B.Cu without crossing. Route DP/DN as a pair toward the actual downstream endpoint, with identical via count and route-length mismatch no greater than 0.5 mm. Keep this clearance policy inside `usb-data-escape`; do not lower generic route keepouts.

- [ ] **Step 4: Run unit and live KiCad gates**

Expected: both profiles report zero violations and zero unconnected items. Record route lengths and explicitly state that DRC-clean geometry is not controlled-impedance evidence.

- [ ] **Step 5: Commit**

```powershell
git add src/kicad/project-generator.js tests/project-generator.test.js
git commit -m "feat: route profile usb data escape"
```

### Task 7: Enforce the final release gate and update evidence

**Files:**
- Modify: `plan.md`
- Modify: `docs/handoff-next-session.md`
- Modify: `README.md` only if the documented DRC status changes
- Test: `tests/project-generator.test.js`

**Interfaces:**
- Consumes: final KiCad DRC JSON for both profiles.
- Produces: durable `0/0` evidence while leaving sourcing, datasheet, impedance, and manufacturing review gates pending.

- [ ] **Step 1: Regenerate both profiles in fresh ignored directories**

Use the existing release-profile prompts and ensure each directory contains only one `.kicad_pcb` before validation.

- [ ] **Step 2: Run all verification commands**

```powershell
npm test
npm run verify:sample
npm run verify:panel
npm run verify:ui
node ./bin/chatpcb-cli.js drc --project ./workspaces/final-drc/esp32
node ./bin/chatpcb-cli.js drc --project ./workspaces/final-drc/stm32
```

Expected: all automated checks pass and both DRC summaries are `violationCount: 0`, `unconnectedCount: 0`.

- [ ] **Step 3: Confirm BMS scope did not change**

Run the ADBMS6830 tests and assert its generated files still omit `.kicad_pcb`, U1 still has no footprint, and `pinMapStatus` remains `unverified-example-only`.

- [ ] **Step 4: Update measured documentation**

Record KiCad version, exact DRC counts, route limitations, and the remaining release blockers. Do not mark the project release-ready solely because PCB DRC reaches `0/0`.

- [ ] **Step 5: Commit**

```powershell
git add plan.md docs/handoff-next-session.md README.md tests/project-generator.test.js
git commit -m "docs: record zero-unconnected board gate"
```
