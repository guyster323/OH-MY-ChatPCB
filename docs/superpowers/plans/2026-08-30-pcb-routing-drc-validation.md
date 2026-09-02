# PCB Routing and DRC Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the supported-profile PCB drafts with measured, safety-checked routing and expose a board-level KiCad DRC workflow that can prove whether both profiles have zero violations and zero unconnected items.

**Architecture:** Keep board generation deterministic and conservative. Reuse the existing `runKicadCli` process boundary for `pcb drc`, parse KiCad's top-level `violations` and `unconnected_items` arrays into a typed result, and make `validate.drc` available through the daemon and CLI. Routing changes remain profile-aware and are accepted only when the generated board passes the DRC gate; a failed gate remains an explicit non-release result.

**Tech Stack:** Node.js 20+, `node:test`, Node filesystem/process APIs, KiCad 10.0.3 CLI, KiCad S-expression PCB files.

**Spec:** `plan.md#next-immediate-task`

## Global Constraints

- Supported-profile PCB changes must not introduce KiCad DRC violations.
- The release gate requires both zero DRC violations and zero unconnected items.
- GND zones must be refilled with `pcb drc --refill-zones` before their copper is counted.
- Do not centerline-autoroute the dense HRO USB-C receptacle pad field without a DRC-verified escape pattern.
- Keep generated project files under ignored `workspaces/` directories.
- Keep `ready-for-release` unavailable while any routing, DRC, manufacturing, sourcing, datasheet, simulation, or evidence gate is incomplete.
- Run `npm test`, `npm run verify:sample`, `npm run verify:panel`, and `npm run verify:ui` before declaring the increment complete.

---

### Task 1: Add a board-level KiCad DRC workflow

**Files:**
- Create: `src/workflow/validate-board.js`
- Create: `tests/validate-board.test.js`

**Interfaces:**
- Consumes: `{ projectDir, kicadCliPath, runKicadCliImpl }`, following `validateProject` dependency injection.
- Produces: `validateBoard({ projectDir, kicadCliPath, runKicadCliImpl })`, returning `{ ok, skipped, report, drc, ... }` with `drc.violationCount`, `drc.unconnectedCount`, and `drc.byType`.

- [x] **Step 1: Write the failing tests**

  Add tests that create a temporary `.kicad_pcb`, inject a fake KiCad runner, and assert:

  ```js
  const result = await validateBoard({
    projectDir: root,
    runKicadCliImpl: async (args, options) => {
      calls.push({ args, options });
      await writeFile(args[args.indexOf('--output') + 1], JSON.stringify({ violations: [], unconnected_items: [] }));
      return { exitCode: 0, stdout: '', stderr: '', command: 'fake-kicad-cli', source: 'test' };
    }
  });

  assert.equal(result.ok, true);
  assert.deepEqual(calls[0].args.slice(0, 6), ['pcb', 'drc', '--refill-zones', '--format', 'json', '--output']);
  assert.equal(result.drc.violationCount, 0);
  assert.equal(result.drc.unconnectedCount, 0);
  assert.equal(path.isAbsolute(result.report), true);
  ```

  Add separate tests for one violation, one unconnected item, an invalid/missing report, no board file, and a missing KiCad CLI. The result must be `ok: false` for a real DRC failure or invalid report, and `ok: true, skipped: true` only for an unavailable prerequisite or absent board.

- [x] **Step 2: Run the focused tests and verify the expected RED failure**

  Run: `node --test tests/validate-board.test.js`

  Expected: FAIL because `src/workflow/validate-board.js` and `validateBoard` do not exist yet.

- [x] **Step 3: Implement the minimal parser and command wrapper**

  Locate the first `.kicad_pcb` in the resolved project directory, write the report to `<projectDir>/chatpcb-drc.json`, and call:

  ```js
  ['pcb', 'drc', '--refill-zones', '--format', 'json', '--output', reportPath, boardPath]
  ```

  Parse `violations` and `unconnected_items` as arrays. Count each item's `type` into `drc.byType`, retain the KiCad command/source/exit output, and return `ok === true` only when the command exits successfully and both arrays are empty.

- [x] **Step 4: Run the focused tests and verify GREEN**

  Run: `node --test tests/validate-board.test.js`

  Expected: all board-validation tests pass with zero failures.

- [ ] **Step 5: Commit the isolated workflow milestone**

  ```powershell
  git add tests/validate-board.test.js src/workflow/validate-board.js
  git commit -m "feat: add board-level KiCad DRC validation"
  ```

### Task 2: Expose DRC through the daemon and CLI

**Files:**
- Modify: `src/runtime/agent-daemon.js`
- Modify: `bin/chatpcb-cli.js`
- Modify: `tests/daemon.test.js`
- Modify: `tests/cli.test.js`

**Interfaces:**
- Consumes: `validateBoard` from Task 1.
- Produces: daemon `dispatchToolCall({ name: 'validate.drc', args: { projectDir, kicadCliPath } })` and CLI `chatpcb drc --project <dir> [--kicad-cli <path>]`.

- [x] **Step 1: Write the failing daemon and CLI tests**

  Assert that a `validate.drc` dispatch reaches an injectable `validateBoardImpl` and that the CLI command returns the validator's JSON with exit code `0` for a passing report and `2` for a DRC failure. Keep the injected fake runner responsible for writing the report so the tests do not depend on an installed KiCad binary.

- [x] **Step 2: Run the focused tests and verify RED**

  Run: `node --test tests/daemon.test.js tests/cli.test.js`

  Expected: FAIL because the new tool and command are not wired.

- [x] **Step 3: Implement the dispatch and command wiring**

  Add `validateBoardImpl = validateBoard` to the daemon's dependency options, dispatch `validate.drc`, import the workflow in the CLI, and print `ok: result.ok` while preserving the existing `1`/`2` process status contract.

- [x] **Step 4: Run the focused tests and verify GREEN**

  Run: `node --test tests/daemon.test.js tests/cli.test.js`

  Expected: all focused tests pass.

- [ ] **Step 5: Commit the interface milestone**

  ```powershell
  git add tests/daemon.test.js tests/cli.test.js src/runtime/agent-daemon.js bin/chatpcb-cli.js
  git commit -m "feat: expose PCB DRC validation through CLI and daemon"
  ```

### Task 3: Add one measured profile-routing increment

**Files:**
- Modify: `src/kicad/project-generator.js`
- Modify: `tests/project-generator.test.js`
- Modify: `src/workflow/generate-mcu-project.js`

**Interfaces:**
- Consumes: existing `PROFILE_BOARD_PLACEMENTS`, `PROFILE_POWER_PATHS`, pad-center capture, and `validateBoard` from Task 1.
- Produces: deterministic profile-aware PCB segments that retain existing same-net keepouts and can be measured with `chatpcb drc`.

- [x] **Step 1: Record the fresh DRC baseline**

  Generate both supported profiles, then run:

  ```powershell
  node ./bin/chatpcb-cli.js drc --project ./workspaces/esp32-s3-usbc-sensor-profile
  node ./bin/chatpcb-cli.js drc --project ./workspaces/stm32-usbc-sensor-profile
  ```

  Record violation and unconnected counts before changing routing. If a generated board differs from the checked-in baseline, use the fresh output as the only comparison point.

- [x] **Step 2: Write a failing routing regression test**

  Add a focused assertion for one explicit, profile-safe net path (starting with a non-dense power or connector path) that checks its generated segment endpoints and maximum leg length. Also assert that generated segments do not intersect a different-net segment or pass through a no-net pad keepout.

- [x] **Step 3: Run the focused routing test and verify RED**

  Run: `node --test tests/project-generator.test.js`

  Expected: the new assertion fails because the requested explicit path is not emitted.

- [x] **Step 4: Implement the smallest safe route**

  Extend the existing profile path table or add a profile-specific waypoint list. Reuse `canAddBoardSegment` for every leg, cap each leg at `30mm`, preserve the `1.0mm` different-net pad keepout, and emit no segment when the candidate cannot be proven safe. Do not weaken the keepout rule to force a lower count.

- [x] **Step 5: Run the focused test and live DRC**

  Run:

  ```powershell
  node --test tests/project-generator.test.js
  node ./bin/chatpcb-cli.js generate --project ./workspaces/esp32-s3-usbc-sensor-profile --prompt "Release profile ESP32-S3 USB-C 5V sensor board with 3.3V 500mA regulator, I2C sensor connector, UART debug header, SWD, USB, SPI, GPIO header, reset button, and status LED."
  node ./bin/chatpcb-cli.js generate --project ./workspaces/stm32-usbc-sensor-profile --prompt "Release profile STM32 USB-C 5V sensor board with 3.3V 500mA regulator, I2C sensor connector, UART debug header, SWD, USB, SPI, GPIO header, reset button, and status LED."
  node ./bin/chatpcb-cli.js drc --project ./workspaces/esp32-s3-usbc-sensor-profile
  node ./bin/chatpcb-cli.js drc --project ./workspaces/stm32-usbc-sensor-profile
  ```

  Expected: zero DRC violations. If either profile gains a violation or the safe route cannot be emitted, keep the change out of the generator and document the measured failure instead of claiming the 0/0 gate.

- [x] **Step 6: Update only measured metadata and tests**

  Keep manufacturing metadata `pending` unless both profiles report zero violations and zero unconnected items. Update the board-draft note and handoff only with fresh counts, KiCad version, and the exact remaining blockers.

- [x] **Step 7: Run the complete verification suite**

  Run: `npm test`, `npm run verify:sample`, `npm run verify:panel`, and `npm run verify:ui`.

- [ ] **Step 8: Commit the routing milestone**

  ```powershell
  git add tests/project-generator.test.js src/kicad/project-generator.js src/workflow/generate-mcu-project.js docs/handoff-next-session.md plan.md
  git commit -m "feat: add measured safe profile routing increment"
  ```

### Task 4: Hand off to the ADBMS6830 BMS example

**Files:**
- The Task 3 result is recorded before modifying the BMS profile.
- Later expected files: `src/runtime/board-profiles.js`, `src/kicad/project-generator.js`, `tests/board-profiles.test.js`, `tests/project-generator.test.js`, and a new dated design/spec document.

**Interfaces:**
- Consumes: the Task 3 DRC result and the official ADBMS6830 datasheet/pinout.
- Produces: a separate BMS profile design, not an implicit extension of the MCU sensor profile.

- [x] **Step 1: Report the measured 1~3 outcome**

  State each profile's DRC violation count, unconnected count, emitted/rejected route groups, and whether the requested 0/0 gate passed.

- [x] **Step 2: Research and design the BMS example**

  Use the official Analog Devices ADBMS6830 documentation to define cell count, supply/ground topology, thermistor inputs, balancing outputs, serial interface, protection assumptions, connector pinout, and explicit “example/prototype only” safety boundaries before writing code. The current ADBMS6830 page is used for the requested part identity; the public full pin/application reference is the related official ADBMS6830B datasheet, so exact A-variant package/pin evidence remains pending.

- [x] **Step 3: Ask for approval of the BMS design**

  Do not silently choose battery chemistry, pack voltage, charge current, protection FETs, fuse, or balancing limits. The user requested an example; the implemented default is explicitly labeled as a 16S Li-ion schematic-only prototype with no charger/protection hardware, and those assumptions remain release gates.

### Review follow-up: safety and integration corrections

- [x] Remove the unverified BMS U1 physical footprint and record `pinMapStatus: unverified-example-only`.
- [x] Return `ok: false` for KiCad execution errors other than ENOENT.
- [x] Allow provider tool prompts and nested dispatch to use `validate.drc`.
- [x] Use BMS-specific readiness wording instead of calling it a USB-C sensor profile.
