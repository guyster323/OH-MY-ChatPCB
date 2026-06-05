import { randomUUID } from 'node:crypto';

export function renderKiCadProject(baseName) {
  return `${JSON.stringify(
    {
      meta: {
        filename: `${baseName}.kicad_pro`,
        version: 1
      },
      schematic: {
        drawing: {
          default_line_thickness: 6,
          default_text_size: 50
        }
      },
      chatpcb: {
        generator: 'OH-MY-ChatPCB',
        status: 'review-draft'
      }
    },
    null,
    2
  )}\n`;
}

export function renderKiCadSchematic({ baseName, spec }) {
  const uuid = randomUUID();
  const notes = [
    `ChatPCB generated MCU peripheral draft: ${spec.title}`,
    `MCU family: ${spec.mcu.family}`,
    `Power rails: ${spec.power.rails.map((rail) => `${rail.name}=${rail.voltage}V`).join(', ')}`,
    `Interfaces: ${spec.interfaces.map((iface) => iface.kind.toUpperCase()).join(', ')}`,
    `Peripherals: ${spec.peripherals.map((peripheral) => peripheral.kind).join(', ')}`,
    'Review all symbols, footprints, net labels, and design rules before production.'
  ];

  return `(kicad_sch
  (version 20250114)
  (generator "eeschema")
  (generator_version "9.0")
  (uuid "${uuid}")
  (paper "A4")
  (title_block
    (title "${escapeSchText(baseName)}")
  )
  (lib_symbols)
${notes.map((note, index) => renderText(note, 25.4, 25.4 + index * 7.62)).join('\n')}
  (sheet_instances
    (path "/"
      (page "1")
    )
  )
)\n`;
}

export function renderSpiceFixture(spec) {
  const hasLed = spec.peripherals.some((peripheral) => peripheral.kind === 'status-led');
  const hasButton = spec.peripherals.some((peripheral) => peripheral.kind.includes('button'));

  return [
    `* OH-MY-ChatPCB SPICE fixture for ${spec.title}`,
    '* This validates simple analog support circuitry, not MCU firmware behavior.',
    'VVBUS vbus 0 DC 5',
    'RREG vbus v3v3 1',
    'DREG v3v3 0 DCLAMP',
    '.model DCLAMP D(BV=3.3 IBV=1m)',
    hasLed ? 'RLED v3v3 led 1000' : '* RLED omitted: no status LED requested',
    hasLed ? 'DLED led 0 DRED' : '* DLED omitted: no status LED requested',
    hasLed ? '.model DRED D(Vfwd=1.9)' : '* LED model omitted',
    hasButton ? 'RBUTTON v3v3 button 10000' : '* RBUTTON omitted: no button requested',
    hasButton ? 'CBUTTON button 0 100n' : '* CBUTTON omitted: no button requested',
    '.op',
    '.tran 1m 20m',
    '.end',
    ''
  ].join('\n');
}

function renderText(text, x, y) {
  return `  (text "${escapeSchText(text)}"
    (at ${x.toFixed(2)} ${y.toFixed(2)} 0)
    (effects (font (size 1.27 1.27)) (justify left))
    (uuid "${randomUUID()}")
  )`;
}

function escapeSchText(value) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
