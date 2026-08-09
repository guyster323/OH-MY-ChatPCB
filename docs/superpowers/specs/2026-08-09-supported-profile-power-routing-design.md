# Supported-Profile Power Routing Design

## Goal

Improve the generated ESP32-S3 and STM32 USB-C sensor-board PCB drafts by
making the common power path intentional and reproducible. This increment
must retain zero KiCad DRC violations while reducing power and ground
unconnected items. It does not claim that either board is release-ready.

## Scope

The work applies only when a supported board profile is selected. It covers
the shared USB-C and buck-regulator circuitry:

- place the USB-C connector at the board edge;
- arrange the USB-C input capacitor, TPS62177DQC, inductor, and output
  capacitor as a compact power island;
- route the VBUS, `SW_3V3`, and `+3V3` nets with explicit, bounded
  profile-aware segments;
- generate a filled GND copper zone inside the board outline;
- retain the existing conservative same-net routing for all other nets.

Signal routing for USB data, I2C, UART, SPI, GPIO, reset/boot, and debug is
out of scope. Manufacturing files, sourcing evidence, and release-status
changes are also out of scope.

## Design

`renderKiCadBoard` will obtain a deterministic placement-intent map before
rendering footprints. The map is keyed by component reference and supplies
coordinates and rotation for `J4`, `U1`, `C3`, `L1`, and `C2`; all remaining
components keep the current grid placement. This preserves a stable layout
for both profiles without adding a general autorouter.

The board renderer will record every pad center as it does today, then add a
small profile-power routing pass before the generic bounded-routing pass.
The power pass connects only known pairs in the following order:

1. USB-C VBUS pads to C3 and the U1 VBUS pads;
2. U1 switch pad to L1 on `SW_3V3`;
3. L1 to C2 and U1 output pads on `+3V3`.

Each segment uses the existing segment de-duplication and keeps a fixed
clearance from pads on other nets. The generic routing remains responsible
for other safe same-net connections and cannot override an explicit segment.

The generated board gains one GND zone on `F.Cu`, bounded by the existing
`Edge.Cuts` rectangle with a 0.5 mm inset. It uses the existing 0.15 mm
clearance rule and connects all eligible GND pads after KiCad fills the zone.

## Error Handling and Safety

If a named power component or required pad is absent, the explicit power
router emits no segment for that connection and the existing generic routing
continues. It must never invent nets, connect different nets, or route
outside the board outline. A supported-profile board with incomplete power
footprints is still a draft and must continue to be reviewed through KiCad
DRC.

## Acceptance Criteria

- Generated ESP32-S3 and STM32 profile boards contain the placement intent,
  explicit VBUS/`SW_3V3`/`+3V3` segments, and one F.Cu GND zone.
- Existing generic drafts remain unchanged when no board profile is selected.
- Segment spans remain bounded and segments respect the existing other-net
  pad keep-out checks.
- Official KiCad 10.0.3 PCB DRC reports zero violations for both regenerated
  profiles.
- Both profiles have fewer unconnected items than the recorded baseline of
  40 (ESP32-S3) and 37 (STM32), or the implementation is rejected and
  investigated before it is accepted.
- The readiness status remains `ready-for-prototype-review` or `blocked`; no
  release-ready claim is introduced.

## Testing

Tests first verify the observable board text: deterministic power-component
placement, a GND zone, and explicit power-net segments. The new tests must
fail before changing production code. After the minimal implementation makes
them pass, the full Node suite and official KiCad DRC runs validate the two
generated supported profiles.

## Non-Goals

- no unrestricted autorouting;
- no high-speed USB differential-pair routing;
- no full signal routing;
- no Gerber, drill, BOM, sourcing, or simulation evidence;
- no release-quality or manufacturer-orderability claim.
