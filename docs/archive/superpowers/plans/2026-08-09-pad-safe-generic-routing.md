# Pad-Safe Generic Routing Implementation Plan

> For agentic workers: use subagent-driven-development or executing-plans task-by-task.

Goal: Reject unsafe generic PCB tracks so both supported profiles reach zero KiCad DRC violations.

Architecture: Track accepted segments as start, end, and net name. Before adding a segment, reject it when any different-net or no-net pad is within the existing keep-out, or it geometrically intersects an accepted different-net segment.

Tech Stack: Node ESM, Node test runner, KiCad 10.0.3.

## Global Constraints

- Preserve 30 mm maximum span and J4 at 18,65,0.
- Treat no-net pads as obstacles.
- Do not add zones, signal routing, or release claims.
- Require DRC 0 and unconnected counts at most 40 ESP32 / 37 STM32.

### Task 1: Test and implement pad-safe segment admission

Files: Modify tests/project-generator.test.js and src/kicad/project-generator.js.

- [ ] Write a failing generated-board test that asserts no segment crosses the J3/J7 no-net pad positions and no pair of different-net segments intersects.
- [ ] Run the focused test and verify it fails against commit 9ea7913.
- [ ] Add acceptedSegments to renderBoardSegments. Change addBoardSegment to receive net name and all pad centers, reject candidates that violate the current pad-distance rule or intersect an accepted different-net segment, then append accepted records.
- [ ] Run the focused test and node --test tests/project-generator.test.js; both pass.
- [ ] Commit with message: fix: prevent unsafe generic board segments.

### Task 2: Verify official DRC and document

Files: Modify docs/handoff-next-session.md only after success.

- [ ] Generate both supported profile projects and run the existing KiCad 10.0.3 JSON DRC commands.
- [ ] Parse violations and unconnected_items; stop without tracked edits if any gate fails.
- [ ] On pass, run npm test, npm run verify:sample, npm run verify:panel, npm run verify:ui, and git diff --check.
- [ ] Record only measured evidence and remaining prototype-review blockers; commit with message: docs: record pad-safe routing verification.

## Plan Self-Review

The two tasks cover source safety behavior and live DRC evidence; no unapproved routing scope is added.

