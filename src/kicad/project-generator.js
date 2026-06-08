import { randomUUID } from 'node:crypto';

const KICAD_COORDINATE_SCALE = 1;

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

export function buildMcuSchematicAst(spec) {
  const mcuConnectedPins = ['+3V3', 'GND', ...interfaceNetNames(spec), 'RESET', 'BOOT'];
  const components = [
    component('J1', 'ChatPCB:POWER_INPUT', 'USB-C / external power input.', 'Connector_PinHeader_2.54mm:PinHeader_1x02_P2.54mm_Vertical'),
    component('U1', 'ChatPCB:REGULATOR_3V3', 'Regulates VBUS into the +3V3 rail used by MCU and peripherals.', 'Package_TO_SOT_SMD:SOT-223-3_TabPin2'),
    component('U2', 'ChatPCB:MCU_PLACEHOLDER', `${spec.mcu.family} controller placeholder with named MCU nets for review.`, 'Package_QFP:LQFP-48_7x7mm_P0.5mm', {
      connectedPins: mcuConnectedPins
    }),
    component('SW1', 'ChatPCB:RESET_BUTTON', 'Momentary reset input for the MCU RESET net.', 'Button_Switch_SMD:Panasonic_EVQPUJ_EVQPUA'),
    component('SW2', 'ChatPCB:BOOT_BUTTON', 'Momentary boot/BOOTSEL input for the MCU BOOT net.', 'Button_Switch_SMD:Panasonic_EVQPUJ_EVQPUA'),
    component('D1', 'ChatPCB:STATUS_LED', 'Status LED with current limiting represented in the SPICE fixture.', 'LED_SMD:LED_0603_1608Metric')
  ];

  if (spec.interfaces.some((iface) => iface.kind === 'i2c')) {
    components.push(
      component('J2', 'ChatPCB:I2C_CONNECTOR', 'I2C sensor connector exposing SCL, SDA, +3V3, and GND.', 'Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical')
    );
  }

  if (spec.interfaces.some((iface) => iface.kind === 'uart')) {
    components.push(
      component('J3', 'ChatPCB:UART_HEADER', 'UART debug header exposing TX, RX, +3V3, and GND.', 'Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical')
    );
  }

  return {
    components,
    nets: ['VBUS', '+3V3', 'GND', ...interfaceNetNames(spec), 'RESET', 'BOOT'].map((name) => ({
      name,
      explanation: explainNet(name)
    }))
  };
}

export function renderKiCadSchematic({ baseName, spec, schematic = buildMcuSchematicAst(spec) }) {
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
  (version 20260306)
  (generator "eeschema")
  (generator_version "10.0")
  (uuid "${uuid}")
  (paper "A4")
  (title_block
    (title "${escapeSchText(baseName)}")
  )
${renderLibSymbols()}
${notes.map((note, index) => renderText(note, 25.4, 25.4 + index * 7.62)).join('\n')}
${schematic.components.map((item, index) => renderPlacedComponent(item, 38.1 + (index % 4) * 38.1, 88.9 + Math.floor(index / 4) * 33.02, baseName)).join('\n')}
  (sheet_instances
    (path "/"
      (page "1")
    )
  )
)\n`;
}

export function renderProjectSymbolTable() {
  return `(sym_lib_table
  (version 7)
  (lib
    (name "ChatPCB")
    (type "KiCad")
    (uri "\${KIPRJMOD}/chatpcb.kicad_sym")
    (options "")
    (descr "Project-local ChatPCB generated fixture symbols")
  )
)\n`;
}

export function renderProjectSymbolLibrary() {
  return `(kicad_symbol_lib
  (version 20241209)
  (generator "chatpcb")
  (generator_version "0.1")
${fixtureSymbols().map(([id, referencePrefix, value]) => renderLibSymbol(id, referencePrefix, value, symbolPinsFor(id), { projectLibrary: true })).join('\n')}
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

function component(ref, libId, explanation, footprint, { connectedPins } = {}) {
  return {
    ref,
    libId,
    value: libId.split(':')[1],
    footprint,
    explanation,
    connectedPins
  };
}

function interfaceNetNames(spec) {
  const names = [];

  if (spec.interfaces.some((iface) => iface.kind === 'i2c')) {
    names.push('SCL', 'SDA');
  }

  if (spec.interfaces.some((iface) => iface.kind === 'uart')) {
    names.push('TX', 'RX');
  }

  return names;
}

function explainNet(name) {
  switch (name) {
    case 'VBUS':
      return 'Primary 5V input rail.';
    case '+3V3':
      return 'Regulated 3.3V rail for MCU and peripherals.';
    case 'GND':
      return 'Common return reference for generated circuitry.';
    case 'SCL':
      return 'I2C clock between MCU and sensor connector.';
    case 'SDA':
      return 'I2C data between MCU and sensor connector.';
    case 'TX':
      return 'UART transmit signal for debug header.';
    case 'RX':
      return 'UART receive signal for debug header.';
    case 'RESET':
      return 'MCU reset input controlled by reset button.';
    case 'BOOT':
      return 'MCU boot mode input controlled by boot button.';
    default:
      return `${name} generated net.`;
  }
}

function renderLibSymbols() {
  return `  (lib_symbols
${fixtureSymbols().map(([id, referencePrefix, value]) => renderLibSymbol(id, referencePrefix, value, symbolPinsFor(id))).join('\n')}
  )`;
}

function fixtureSymbols() {
  return [
    ['ChatPCB:POWER_INPUT', 'J', 'POWER_INPUT'],
    ['ChatPCB:REGULATOR_3V3', 'U', 'REGULATOR_3V3'],
    ['ChatPCB:MCU_PLACEHOLDER', 'U', 'MCU_PLACEHOLDER'],
    ['ChatPCB:RESET_BUTTON', 'SW', 'RESET_BUTTON'],
    ['ChatPCB:BOOT_BUTTON', 'SW', 'BOOT_BUTTON'],
    ['ChatPCB:STATUS_LED', 'D', 'STATUS_LED'],
    ['ChatPCB:I2C_CONNECTOR', 'J', 'I2C_CONNECTOR'],
    ['ChatPCB:UART_HEADER', 'J', 'UART_HEADER']
  ];
}

function renderLibSymbol(id, referencePrefix, value, pins, { projectLibrary = false } = {}) {
  const symbolName = projectLibrary ? value : id;
  const indent = projectLibrary ? '  ' : '    ';

  return `${indent}(symbol "${escapeSchText(symbolName)}"
      (pin_names (offset ${sch(1.016)}))
      (exclude_from_sim no)
      (in_bom yes)
      (on_board yes)
      (property "Reference" "${referencePrefix}" (at ${sch(0)} ${sch(7.62)} 0)
        (effects (font (size ${sch(1.27)} ${sch(1.27)})))
      )
      (property "Value" "${escapeSchText(value)}" (at ${sch(0)} ${sch(-7.62)} 0)
        (effects (font (size ${sch(1.27)} ${sch(1.27)})))
      )
      (property "Footprint" "" (at ${sch(0)} ${sch(-10.16)} 0)
        (effects (font (size ${sch(1.27)} ${sch(1.27)})) hide)
      )
      (symbol "${escapeSchText(value)}_0_1"
        (rectangle (start ${sch(-7.62)} ${sch(6.35)}) (end ${sch(7.62)} ${sch(-6.35)})
          (stroke (width ${sch(0.254)}) (type default))
          (fill (type background))
        )
      )
      (symbol "${escapeSchText(value)}_1_1"
${pins.map((pinName, index) => renderLibPin(pinName, index)).join('\n')}
      )
    )`;
}

function renderLibPin(pinName, index) {
  const leftSide = index % 2 === 0;
  const y = 5.08 - Math.floor(index / 2) * 2.54;
  const x = leftSide ? -12.7 : 12.7;
  const rotation = leftSide ? 0 : 180;

  return `        (pin passive line (at ${sch(x)} ${sch(y)} ${rotation}) (length ${sch(5.08)})
          (name "${escapeSchText(pinName)}" (effects (font (size ${sch(1.27)} ${sch(1.27)}))))
          (number "${index + 1}" (effects (font (size ${sch(1.27)} ${sch(1.27)}))))
        )`;
}

function renderPlacedComponent(componentModel, x, y, baseName) {
  const connectedPins = new Set(componentModel.connectedPins ?? symbolPinsFor(componentModel.libId));

  return [
    renderSymbolInstance(componentModel, x, y, baseName),
    ...symbolPinsFor(componentModel.libId).flatMap((pinName, index) => {
      if (connectedPins.has(pinName)) {
        return renderPinNetStub(pinName, x, y, index);
      }

      const point = pinConnectionPoint(x, y, index);
      return renderNoConnect(point.x, point.y);
    })
  ].join('\n');
}

function renderSymbolInstance(componentModel, x, y, baseName) {
  const uuid = randomUUID();

  return `  (symbol
    (lib_id "${escapeSchText(componentModel.libId)}")
    (at ${sch(x)} ${sch(y)} 0)
    (unit 1)
    (exclude_from_sim no)
    (in_bom yes)
    (on_board yes)
    (dnp no)
    (uuid "${uuid}")
    (property "Reference" "${escapeSchText(componentModel.ref)}" (at ${sch(x)} ${sch(y - 10.16)} 0)
      (effects (font (size ${sch(1.27)} ${sch(1.27)})))
    )
    (property "Value" "${escapeSchText(componentModel.value)}" (at ${sch(x)} ${sch(y + 10.16)} 0)
      (effects (font (size ${sch(1.27)} ${sch(1.27)})))
    )
    (property "Footprint" "${escapeSchText(componentModel.footprint)}" (at ${sch(x)} ${sch(y + 12.70)} 0)
      (effects (font (size ${sch(1.27)} ${sch(1.27)})) hide)
    )
    (instances
      (project "${escapeSchText(baseName)}"
        (path "/${uuid}"
          (reference "${escapeSchText(componentModel.ref)}")
          (unit 1)
        )
      )
    )
  )`;
}

function symbolPinsFor(libId) {
  switch (libId) {
    case 'ChatPCB:POWER_INPUT':
      return ['VBUS', 'GND'];
    case 'ChatPCB:REGULATOR_3V3':
      return ['VBUS', 'GND', '+3V3'];
    case 'ChatPCB:MCU_PLACEHOLDER':
      return ['+3V3', 'GND', 'SCL', 'SDA', 'TX', 'RX', 'RESET', 'BOOT'];
    case 'ChatPCB:RESET_BUTTON':
      return ['RESET', 'GND'];
    case 'ChatPCB:BOOT_BUTTON':
      return ['BOOT', 'GND'];
    case 'ChatPCB:STATUS_LED':
      return ['+3V3', 'GND'];
    case 'ChatPCB:I2C_CONNECTOR':
      return ['SCL', 'SDA', '+3V3', 'GND'];
    case 'ChatPCB:UART_HEADER':
      return ['TX', 'RX', '+3V3', 'GND'];
    default:
      return [];
  }
}

function pinConnectionPoint(symbolX, symbolY, pinIndex) {
  const leftSide = pinIndex % 2 === 0;
  return {
    x: symbolX + (leftSide ? -12.7 : 12.7),
    y: symbolY - 5.08 + Math.floor(pinIndex / 2) * 2.54,
    rotation: leftSide ? 0 : 180
  };
}

function renderPinNetStub(pinName, symbolX, symbolY, pinIndex) {
  const start = pinConnectionPoint(symbolX, symbolY, pinIndex);
  const labelX = start.x + (start.rotation === 0 ? -5.08 : 5.08);
  const end = { x: labelX, y: start.y };

  return [
    renderWire(start, end),
    renderLabel(pinName, end.x, end.y, start.rotation)
  ];
}

function renderWire(start, end) {
  return `  (wire
    (pts (xy ${sch(start.x)} ${sch(start.y)}) (xy ${sch(end.x)} ${sch(end.y)}))
    (stroke (width 0) (type default))
    (uuid "${randomUUID()}")
  )`;
}

function renderText(text, x, y) {
  return `  (text "${escapeSchText(text)}"
    (at ${sch(x)} ${sch(y)} 0)
    (effects (font (size ${sch(1.27)} ${sch(1.27)})) (justify left))
    (uuid "${randomUUID()}")
  )`;
}

function renderLabel(name, x, y, rotation = 0) {
  return `  (label "${escapeSchText(name)}"
    (at ${sch(x)} ${sch(y)} ${rotation})
    (effects (font (size ${sch(1.27)} ${sch(1.27)})) (justify left))
    (uuid "${randomUUID()}")
  )`;
}

function renderNoConnect(x, y) {
  return `  (no_connect
    (at ${sch(x)} ${sch(y)})
    (uuid "${randomUUID()}")
  )`;
}

function escapeSchText(value) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function sch(value) {
  return (value * KICAD_COORDINATE_SCALE).toFixed(2);
}
