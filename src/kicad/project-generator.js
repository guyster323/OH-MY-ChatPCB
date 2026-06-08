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
  const mcuConnectedPins = unique(['+3V3', 'GND', ...interfaceNetNames(spec), ...(spec.debug?.nets ?? []), 'RESET', 'BOOT']);
  const mcuLibId = mcuSymbolFor(spec);
  const components = [
    component('J1', 'ChatPCB:POWER_INPUT', 'USB-C / external power input.', 'Connector_PinHeader_2.54mm:PinHeader_1x02_P2.54mm_Vertical'),
    component('U1', 'ChatPCB:REGULATOR_3V3', 'Regulates VBUS into the +3V3 rail used by MCU and peripherals.', 'Package_TO_SOT_SMD:SOT-223-3_TabPin2'),
    component('U2', mcuLibId, `${spec.mcu.package} controller/module with named MCU nets for review.`, mcuFootprintFor(spec), {
      value: spec.mcu.package === 'unspecified' ? 'MCU_PLACEHOLDER' : spec.mcu.package,
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

  if (spec.interfaces.some((iface) => iface.kind === 'usb')) {
    components.push(
      component('J4', 'ChatPCB:USB_C_CONNECTOR', 'USB-C sink connector with VBUS, USB data, CC pins, and GND.', 'Connector_USB:USB_C_Receptacle_HRO_TYPE-C-31-M-12')
    );
  }

  if (spec.interfaces.some((iface) => iface.kind === 'spi')) {
    components.push(
      component('J5', 'ChatPCB:SPI_HEADER', 'SPI expansion header exposing SCK, MOSI, MISO, CS, +3V3, and GND.', 'Connector_PinHeader_2.54mm:PinHeader_1x06_P2.54mm_Vertical')
    );
  }

  if (spec.interfaces.some((iface) => iface.kind === 'gpio')) {
    components.push(
      component('J6', 'ChatPCB:GPIO_HEADER', 'GPIO expansion header exposing GPIO0, GPIO1, GPIO2, +3V3, and GND.', 'Connector_PinHeader_2.54mm:PinHeader_1x05_P2.54mm_Vertical')
    );
  }

  if (spec.debug?.nets?.length > 0) {
    components.push(
      component('J7', 'ChatPCB:DEBUG_HEADER', `${spec.debug.implementedProtocol.toUpperCase()} debug header for ${spec.mcu.family}.`, 'Connector_PinHeader_2.54mm:PinHeader_2x05_P2.54mm_Vertical', {
        connectedPins: [...spec.debug.nets, '+3V3', 'GND', 'RESET', 'BOOT']
      })
    );
  }

  if (spec.peripherals.some((peripheral) => peripheral.kind === 'decoupling-network')) {
    components.push(
      component('C1', 'ChatPCB:DECOUPLING_CAP', 'Local 0.1uF decoupling capacitor near MCU 3.3V pins.', 'Capacitor_SMD:C_0603_1608Metric', { value: '100nF' }),
      component('C2', 'ChatPCB:DECOUPLING_CAP', 'Bulk 10uF capacitor on the 3.3V rail.', 'Capacitor_SMD:C_0603_1608Metric', { value: '10uF' })
    );
  }

  if (spec.peripherals.some((peripheral) => peripheral.kind === 'usb-c-cc-pulldowns')) {
    components.push(
      component('R1', 'ChatPCB:CC_RESISTOR', 'USB-C sink pulldown on CC1.', 'Resistor_SMD:R_0603_1608Metric', { value: '5.1k' }),
      component('R2', 'ChatPCB:CC_RESISTOR', 'USB-C sink pulldown on CC2.', 'Resistor_SMD:R_0603_1608Metric', { value: '5.1k' })
    );
  }

  return {
    components,
    nets: unique(['VBUS', '+3V3', 'GND', ...interfaceNetNames(spec), ...(spec.debug?.nets ?? []), 'RESET', 'BOOT']).map((name) => ({
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
${renderLibSymbols(schematic.components.map((item) => item.libId))}
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

function component(ref, libId, explanation, footprint, { connectedPins, value } = {}) {
  return {
    ref,
    libId,
    value: value ?? libId.split(':')[1],
    footprint,
    explanation,
    connectedPins
  };
}

function interfaceNetNames(spec) {
  return unique((spec.interfaces ?? []).flatMap((iface) => (iface.pins ?? []).filter((pin) => !['+3V3', 'GND', 'VBUS'].includes(pin))));
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
    case 'USB_DP':
    case 'D+':
      return 'USB 2.0 positive data signal.';
    case 'USB_DN':
    case 'D-':
      return 'USB 2.0 negative data signal.';
    case 'CC1':
    case 'CC2':
      return 'USB-C configuration channel sink pulldown net.';
    case 'SCK':
    case 'MOSI':
    case 'MISO':
    case 'CS':
      return 'SPI expansion signal.';
    case 'GPIO0':
    case 'GPIO1':
    case 'GPIO2':
    case 'GPIO':
      return 'General-purpose expansion signal.';
    case 'SWDIO':
    case 'SWCLK':
    case 'NRST':
      return 'ARM SWD debug signal.';
    case 'MTMS':
    case 'MTCK':
    case 'MTDI':
    case 'MTDO':
      return 'ESP32 JTAG debug signal.';
    case 'RESET':
      return 'MCU reset input controlled by reset button.';
    case 'BOOT':
      return 'MCU boot mode input controlled by boot button.';
    default:
      return `${name} generated net.`;
  }
}

function renderLibSymbols(usedLibIds) {
  const used = new Set(usedLibIds);
  return `  (lib_symbols
${fixtureSymbols()
  .filter(([id]) => used.has(id))
  .map(([id, referencePrefix, value]) => renderLibSymbol(id, referencePrefix, value, symbolPinsFor(id)))
  .join('\n')}
  )`;
}

function fixtureSymbols() {
  return [
    ['ChatPCB:POWER_INPUT', 'J', 'POWER_INPUT'],
    ['ChatPCB:REGULATOR_3V3', 'U', 'REGULATOR_3V3'],
    ['ChatPCB:MCU_PLACEHOLDER', 'U', 'MCU_PLACEHOLDER'],
    ['ChatPCB:ESP32_S3_WROOM_1', 'U', 'ESP32_S3_WROOM_1_N8R2'],
    ['ChatPCB:STM32G0B1CBT6', 'U', 'STM32G0B1CBT6'],
    ['ChatPCB:RESET_BUTTON', 'SW', 'RESET_BUTTON'],
    ['ChatPCB:BOOT_BUTTON', 'SW', 'BOOT_BUTTON'],
    ['ChatPCB:STATUS_LED', 'D', 'STATUS_LED'],
    ['ChatPCB:I2C_CONNECTOR', 'J', 'I2C_CONNECTOR'],
    ['ChatPCB:UART_HEADER', 'J', 'UART_HEADER'],
    ['ChatPCB:USB_C_CONNECTOR', 'J', 'USB_C_CONNECTOR'],
    ['ChatPCB:SPI_HEADER', 'J', 'SPI_HEADER'],
    ['ChatPCB:GPIO_HEADER', 'J', 'GPIO_HEADER'],
    ['ChatPCB:DEBUG_HEADER', 'J', 'DEBUG_HEADER'],
    ['ChatPCB:DECOUPLING_CAP', 'C', 'DECOUPLING_CAP'],
    ['ChatPCB:CC_RESISTOR', 'R', 'CC_RESISTOR']
  ];
}

function renderLibSymbol(id, referencePrefix, value, pins, { projectLibrary = false } = {}) {
  const symbolName = projectLibrary ? id.split(':').at(-1) : id;
  const unitBaseName = symbolName.includes(':') ? symbolName.split(':').at(-1) : symbolName;
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
      (symbol "${escapeSchText(unitBaseName)}_0_1"
        (rectangle (start ${sch(-7.62)} ${sch(6.35)}) (end ${sch(7.62)} ${sch(-6.35)})
          (stroke (width ${sch(0.254)}) (type default))
          (fill (type background))
        )
      )
      (symbol "${escapeSchText(unitBaseName)}_1_1"
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
    case 'ChatPCB:ESP32_S3_WROOM_1':
    case 'ChatPCB:STM32G0B1CBT6':
      return ['+3V3', 'GND', 'SCL', 'SDA', 'TX', 'RX', 'USB_DP', 'USB_DN', 'SCK', 'MOSI', 'MISO', 'CS', 'GPIO0', 'GPIO1', 'GPIO2', 'SWDIO', 'SWCLK', 'NRST', 'MTMS', 'MTCK', 'MTDI', 'MTDO', 'RESET', 'BOOT'];
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
    case 'ChatPCB:USB_C_CONNECTOR':
      return ['VBUS', 'USB_DP', 'USB_DN', 'GND', 'CC1', 'CC2'];
    case 'ChatPCB:SPI_HEADER':
      return ['SCK', 'MOSI', 'MISO', 'CS', '+3V3', 'GND'];
    case 'ChatPCB:GPIO_HEADER':
      return ['GPIO0', 'GPIO1', 'GPIO2', '+3V3', 'GND'];
    case 'ChatPCB:DEBUG_HEADER':
      return ['SWDIO', 'SWCLK', 'NRST', 'MTMS', 'MTCK', 'MTDI', 'MTDO', '+3V3', 'GND', 'RESET', 'BOOT'];
    case 'ChatPCB:DECOUPLING_CAP':
      return ['+3V3', 'GND'];
    case 'ChatPCB:CC_RESISTOR':
      return ['CC1', 'GND', 'CC2'];
    default:
      return [];
  }
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function mcuSymbolFor(spec) {
  switch (spec.boardProfile?.id) {
    case 'esp32-s3-usbc-sensor':
      return 'ChatPCB:ESP32_S3_WROOM_1';
    case 'stm32-usbc-sensor':
      return 'ChatPCB:STM32G0B1CBT6';
    default:
      return 'ChatPCB:MCU_PLACEHOLDER';
  }
}

function mcuFootprintFor(spec) {
  switch (spec.boardProfile?.id) {
    case 'esp32-s3-usbc-sensor':
      return 'RF_Module:ESP32-S3-WROOM-1';
    case 'stm32-usbc-sensor':
      return 'Package_QFP:LQFP-48_7x7mm_P0.5mm';
    default:
      return 'Package_QFP:LQFP-48_7x7mm_P0.5mm';
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
