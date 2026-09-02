# Remaining Supported-Profile PCB Connections Design

## Goal

Reduce the supported ESP32-S3 and STM32 PCB drafts from the measured `0 violations / 24 unconnected` and `0 violations / 22 unconnected` states to `0 violations / 0 unconnected`, without changing the schematic-only ADBMS6830 cell-monitor profile or enabling manufacturing exports early.

## Measured Baseline

| Net | ESP32-S3 | STM32 | Main cause |
|---|---:|---:|---|
| `+3V3` | 12 | 12 | Distributed regulator, passives, and headers are not one copper tree |
| `VBUS` | 6 | 6 | USB-C duplicate pads, C3, U1, and J1 are split |
| `RESET` | 1 | 1 | SW1-to-J7 distance exceeds the generic bounded route |
| `BOOT` | 1 | 1 | SW2-to-J7 distance exceeds the generic bounded route |
| `USB_DP` | 2 | 1 | HRO duplicate pads need a dedicated escape; ESP32 also needs J7 connection |
| `USB_DN` | 2 | 1 | HRO duplicate pads need a dedicated escape; ESP32 also needs J7 connection |

The counts come from fresh KiCad 10.0.3 JSON DRC reports generated with `pcb drc --refill-zones`.

## Chosen Approach

Use a hybrid router with two bounded responsibilities:

1. A deterministic obstacle-aware grid route handles long, low-current F.Cu paths and the distributed `+3V3` tree. It reuses the existing board outline, other-net pad keepout, cross-net intersection, and maximum-leg constraints.
2. A USB-C escape renderer handles the dense HRO receptacle. It may emit short F.Cu fanout, paired vias, and B.Cu segments. Its USB-specific clearance is never applied to generic routes and every candidate must pass live KiCad DRC.

This avoids accumulating profile-coordinate-only paths and avoids introducing a general-purpose autorouter. Existing explicit CC1/CC2 and I2C paths remain supported.

## Routing Order and Gates

Each increment is accepted only when both profiles keep zero violations. A failed live DRC candidate is removed before the next increment.

1. Add DRC summaries by net; counts remain `24/22`.
2. Route RESET/BOOT; target at most `22/20`.
3. Build the `+3V3` copper tree; target at most `10/8`.
4. Build the VBUS escape and backbone; target at most `4/2`.
5. Build USB DP/DN duplicate-pad escape and downstream routes; target `0/0`.

Intermediate target counts are upper bounds because KiCad may collapse more than one ratsnest edge when a copper island joins the main tree.

## Safety and Release Constraints

- Preserve zero KiCad DRC violations after every increment.
- Do not reduce the generic 1.0 mm other-net pad keepout or the 30 mm generated-leg cap.
- Power routes use an explicit width separate from 0.15 mm signal routes.
- USB routes do not claim controlled impedance until a stackup and impedance calculation are defined.
- Do not generate Gerber or drill artifacts until both supported profiles report zero violations and zero unconnected items.
- Keep the ADBMS6830 project schematic-only with `pinMapStatus: unverified-example-only` and no PCB footprint.
- Keep generated measurement projects under ignored `workspaces/` directories.

## Verification

Every task uses a failing unit test first, followed by focused tests, the full `npm test` suite, and fresh KiCad 10.0.3 DRC for both profiles. Final verification also runs `verify:sample`, `verify:panel`, and `verify:ui`.
