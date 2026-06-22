# Source Notes

Checked on 2026-06-22.

## KiCad

- Source: https://www.kicad.org/download/windows/
- Relevant fact: Windows stable release listed `Current Version: 10.0.4`.
- Implementation impact: ChatPCB3 should target KiCad 10.0.4 or newer stable
  when the fork work begins, not the locally installed KiCad 9.0 tree.

## Freerouting

- Source: https://github.com/freerouting/freerouting/releases
- Relevant fact: latest observed release was `Freerouting v2.2.4`.
- Implementation impact: the autorouter contract records `v2.2.4` as the
  expected bundled version for the first slice, and models DSN input plus SES
  output.

## JLCPCB

- Source: https://jlcpcb.com/help/article/bill-of-materials-for-pcb-assembly
- Relevant fact: JLCPCB BOM guidance lists component description/value,
  reference designator, package/footprint, and related part information.
- Source: https://jlcpcb.com/help/article/pcb-assembly-faqs
- Relevant fact: assembly orders require Gerber, BOM, and CPL / pick-and-place
  files.
- Source: https://jlcpcb.com/help/article/how-to-generate-the-bom-and-centroid-file-from-kicad
- Relevant fact: the KiCad 10 guide describes production files including
  Gerber zip, `bom.csv`, and `positions.csv`.
