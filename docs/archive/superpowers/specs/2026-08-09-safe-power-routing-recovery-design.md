# Safe Power-Routing Recovery Design

## Goal

Recover the supported ESP32-S3 and STM32 PCB drafts to zero KiCad DRC
violations without claiming that routing or manufacturing is complete. This
increment replaces the unsafe direct-route and unfilled-zone behavior added by
the rejected power-routing attempt.

## Confirmed Root Causes

KiCad 10.0.3 DRC comparison established these facts:

- the previous generator produced zero violations with 40 ESP32-S3 and 37
  STM32 unconnected items;
- rotating the embedded HRO USB-C footprint to 90 degrees causes its adjacent
  SMD pad geometry to violate clearance, shorting, and solder-mask checks;
- excluding all pads on a route endpoint component allows a VBUS track to
  cross C3's GND pad;
- emitting only a zone definition does not create filled copper connectivity
  for the generated board during this DRC workflow.

## Scope

- keep J4 at the left board edge but render its embedded footprint at zero
  rotation;
- remove the profile-only GND zone from generated drafts;
- restore the existing generic bounded same-net routing behavior for supported
  profiles;
- make direct profile-power routing reject every other-net pad, including pads
  on either endpoint footprint;
- retain only an explicit power segment when it passes the 30 mm limit and
  1.0 mm pad keep-out test against all other-net pads;
- update the test contract to prove unrotated J4, absence of a GND zone, and
  safe-routing behavior.

## Non-Goals

- no automatic connection of every duplicate USB-C pad;
- no filled copper-pour serialization;
- no USB, I2C, UART, SPI, GPIO, reset/boot, or debug routing;
- no reduction promise below the prior 40/37 unconnected baseline;
- no production, release-ready, or manufacturer-orderability claim.

## Acceptance Criteria

- Fresh ESP32-S3 and STM32 profile boards produce zero official KiCad 10.0.3
  DRC violations.
- The output has no F.Cu GND zone and J4 uses (at 18 65 0).
- No generated direct power segment passes within 1.0 mm of a pad on a
  different net, including pads on its start or end component.
- The generic router remains active for supported and generic boards.
- Both profile boards have no more than the earlier baseline unconnected-item
  counts: 40 for ESP32-S3 and 37 for STM32.
- The project remains ready-for-prototype-review or blocked.

## Testing

A test first changes the existing contract from the unsafe J4 rotation/zone
expectation to the safe output. It fails against the current implementation.
The renderer change is then minimal: change J4 rotation, remove zone emission,
restore generic routing, and tighten profile-power pad filtering. Official
KiCad DRC supplies the final acceptance evidence.

