# Pad-Safe Generic Routing Design

## Goal

Eliminate remaining DRC violations by making generic routing accept a segment only
when it is clear of every different-net pad, including no-net pads.

## Cause

The restored generic router currently checks pad centers but allows routes that
cross or approach no-net pads in J7 and crosses +3V3/GND paths near J3.

## Design

Use one shared route-safety predicate for both generic and profile-power
segments. It rejects a candidate when its centerline is within the applicable
keep-out of any pad whose net differs from the candidate net; pads with no net
are treated as different-net obstacles. It also rejects a candidate if it
intersects an already accepted segment on a different net. Accepted segments
are recorded with endpoints and net name so later candidates can be checked.

Retain the 30 mm maximum span, same-net behavior, J4 zero rotation, no GND
zone, and all profile placements. Unsafe candidates are omitted rather than
rerouted.

## Acceptance

Fresh KiCad 10.0.3 DRC reports zero violations for ESP32-S3 and STM32, with
unconnected counts no higher than 40 and 37. The project remains a
prototype-review draft.

