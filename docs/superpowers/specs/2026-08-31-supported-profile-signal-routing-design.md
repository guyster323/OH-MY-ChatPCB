# Supported Profile Signal Routing Design

## Goal

Reduce the supported-profile PCB DRC unconnected count without introducing a DRC violation. This increment covers only the low-current SCL and SDA paths between the I2C header and their pull-up resistors.

## Baseline

Official KiCad 10.0.3 with `pcb drc --refill-zones` reports zero violations with 26 unconnected items for the ESP32-S3 profile and 24 for the STM32 profile. Each profile has one SCL and one SDA unconnected item. Power, USB-C, RESET, and BOOT are outside this increment.

## Design

Add declarative I2C anchors to the existing `PROFILE_SIGNAL_PATHS` table in `src/kicad/project-generator.js`.

```js
['SCL', ['J2', 'R4'], {
  anchors: [{ x: 47, y: 39 }, { x: 70, y: 39 }, { x: 90, y: 60 }, { x: 113, y: 60 }]
}]
```

The renderer evaluates each available source/destination pad pair and constructs `[start, ...anchors, end]`. It accepts the shortest candidate only when every leg is within the existing 30 mm cap, clears the existing different-net pad keepout, and does not intersect an accepted different-net segment. A rejected route emits no copper.

SDA uses the explicit anchor chain `[{ x: 42, y: 45.54 }, { x: 42, y: 65 }, { x: 44, y: 90 }, { x: 26, y: 90 }]` between `J2` and `R5`.

The first SCL candidate was rejected because it crossed J3's TX pad. The first SDA candidate was then rejected because its horizontal leg crossed the accepted CC2 escape segment. The final chains preserve the existing 1.0 mm pad keepout and cross-net segment-intersection gate; they route around those obstructions rather than weakening safety rules.

## Constraints

- No change to VBUS, +3V3, USB data, RESET, BOOT, or ground-zone behavior.
- Do not reduce pad keepout values or disable cross-net intersection checks.
- BMS remains a schematic-only cell-monitor example with no footprint or PCB output.
- A live KiCad 10.0.3 DRC result is required; string-level board tests are insufficient.

## Acceptance

- Unit tests prove SCL/SDA chains are emitted with all legs at most 30 mm and no direct J2-to-resistor centerline segment.
- KiCad DRC keeps zero violations for both profiles.
- Both profile unconnected totals decrease by at least two from the fresh 26/24 baseline.
- `npm test`, `npm run verify:sample`, `npm run verify:panel`, and `npm run verify:ui` continue to pass.

## Measured Result

On 2026-08-31, official KiCad 10.0.3 `pcb drc --refill-zones` reported zero violations and 24 unconnected items for ESP32-S3, and zero violations and 22 unconnected items for STM32. This meets the increment target but does not meet the project release gate of zero unconnected items.
