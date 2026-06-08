import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

const KICAD_COORDINATE_SCALE = 1;
const SCHEMATIC_GRID_COLUMNS = 5;
const SCHEMATIC_GRID_ROW_SPACING_MM = 45.72;

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

export function renderKiCadBoard({ baseName, schematic }) {
  const components = schematic.components.filter((component) => component.footprint);
  const footprints = components
    .map((component, index) => renderBoardFootprint(component, 25 + (index % 5) * 22, 25 + Math.floor(index / 5) * 18))
    .join('\n');

  return `(kicad_pcb
  (version 20240108)
  (generator "pcbnew")
  (generator_version "10.0")
  (general
    (thickness 1.6)
  )
  (paper "A4")
  (title_block
    (title "${escapeSchText(baseName)}")
  )
  (layers
    (0 "F.Cu" signal)
    (31 "B.Cu" signal)
    (32 "B.Adhes" user)
    (33 "F.Adhes" user)
    (34 "B.Paste" user)
    (35 "F.Paste" user)
    (36 "B.SilkS" user)
    (37 "F.SilkS" user)
    (38 "B.Mask" user)
    (39 "F.Mask" user)
    (44 "Edge.Cuts" user)
  )
  (setup
    (pad_to_mask_clearance 0)
  )
  (gr_rect
    (start 10 10)
    (end 110 80)
    (stroke
      (width 0.1)
      (type default)
    )
    (fill none)
    (layer "Edge.Cuts")
    (uuid "${randomUUID()}")
  )
${footprints}
)`;
}

export function buildMcuSchematicAst(spec) {
  const profileMode = Boolean(spec.boardProfile?.id);
  const mcuConnectedPins = unique(['+3V3', 'GND', ...interfaceNetNames(spec), ...(spec.debug?.nets ?? []), 'RESET', 'BOOT']);
  const mcuLibId = mcuSymbolFor(spec);
  const components = [
    component('J1', profileMode ? 'Connector_Generic:Conn_01x02' : 'ChatPCB:POWER_INPUT', 'USB-C / external power input.', 'Connector_PinHeader_2.54mm:PinHeader_1x02_P2.54mm_Vertical', {
      value: profileMode ? 'POWER_INPUT' : undefined,
      pins: ['VBUS', 'GND'],
      connectedPins: ['VBUS', 'GND'],
      pinNets: profileMode ? { 1: 'VBUS', 2: 'GND' } : undefined
    }),
    component('U1', profileMode ? 'Regulator_Switching:TPS62177DQC' : 'ChatPCB:REGULATOR_3V3', 'Regulates VBUS into the +3V3 rail used by MCU and peripherals.', profileMode ? 'Package_SON:WSON-10-1EP_2x3mm_P0.5mm_EP0.84x2.4mm_ThermalVias' : 'Package_TO_SOT_SMD:SOT-223-3_TabPin2', {
      value: profileMode ? 'TPS62177DQC' : undefined,
      pins: profileMode ? ['GND', 'VBUS', 'VBUS', 'NC', '+3V3', 'GND', 'PG', 'VBUS', 'SW_3V3', '+3V3', 'GND'] : ['VBUS', 'GND', '+3V3'],
      connectedPins: profileMode ? ['GND', 'VBUS', '+3V3', 'SW_3V3'] : ['GND', 'VBUS', '+3V3'],
      pinNets: profileMode
        ? { 1: 'GND', 2: 'VBUS', 3: 'VBUS', 5: '+3V3', 6: 'GND', 8: 'VBUS', 9: 'SW_3V3', 10: '+3V3', 11: 'GND' }
        : undefined
    }),
    component('U2', mcuLibId, `${spec.mcu.package} controller/module with named MCU nets for review.`, mcuFootprintFor(spec), {
      value: spec.mcu.package === 'unspecified' ? 'MCU_PLACEHOLDER' : spec.mcu.package,
      connectedPins: mcuConnectedPins
    }),
    component('SW1', profileMode ? 'Switch:SW_Push' : 'ChatPCB:RESET_BUTTON', 'Momentary reset input for the MCU RESET net.', 'Button_Switch_SMD:Panasonic_EVQPUJ_EVQPUA', {
      value: profileMode ? 'RESET_BUTTON' : undefined,
      pins: ['RESET', 'GND'],
      connectedPins: ['RESET', 'GND'],
      pinNets: profileMode ? { 1: 'RESET', 2: 'GND' } : undefined
    }),
    component('SW2', profileMode ? 'Switch:SW_Push' : 'ChatPCB:BOOT_BUTTON', 'Momentary boot/BOOTSEL input for the MCU BOOT net.', 'Button_Switch_SMD:Panasonic_EVQPUJ_EVQPUA', {
      value: profileMode ? 'BOOT_BUTTON' : undefined,
      pins: ['BOOT', 'GND'],
      connectedPins: ['BOOT', 'GND'],
      pinNets: profileMode ? { 1: 'BOOT', 2: 'GND' } : undefined
    }),
    component('D1', profileMode ? 'Device:LED' : 'ChatPCB:STATUS_LED', 'Status LED with current limiting represented in the SPICE fixture.', 'LED_SMD:LED_0603_1608Metric', {
      value: profileMode ? 'STATUS_LED' : undefined,
      pins: ['+3V3', 'GND'],
      connectedPins: ['+3V3', 'GND'],
      pinNets: profileMode ? { 1: 'GND', 2: '+3V3' } : undefined
    })
  ];

  if (spec.interfaces.some((iface) => iface.kind === 'i2c')) {
    components.push(
      component('J2', profileMode ? 'Connector_Generic:Conn_01x04' : 'ChatPCB:I2C_CONNECTOR', 'I2C sensor connector exposing SCL, SDA, +3V3, and GND.', 'Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical', {
        value: profileMode ? 'I2C_CONNECTOR' : undefined,
        pins: ['SCL', 'SDA', '+3V3', 'GND'],
        connectedPins: ['SCL', 'SDA', '+3V3', 'GND'],
        pinNets: profileMode ? { 1: 'SCL', 2: 'SDA', 3: '+3V3', 4: 'GND' } : undefined
      })
    );
  }

  if (spec.interfaces.some((iface) => iface.kind === 'uart')) {
    components.push(
      component('J3', profileMode ? 'Connector_Generic:Conn_01x04' : 'ChatPCB:UART_HEADER', 'UART debug header exposing TX, RX, +3V3, and GND.', 'Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical', {
        value: profileMode ? 'UART_HEADER' : undefined,
        pins: ['TX', 'RX', '+3V3', 'GND'],
        connectedPins: ['TX', 'RX', '+3V3', 'GND'],
        pinNets: profileMode ? { 1: 'TX', 2: 'RX', 3: '+3V3', 4: 'GND' } : undefined
      })
    );
  }

  if (spec.interfaces.some((iface) => iface.kind === 'usb')) {
    components.push(
      component('J4', profileMode ? 'Connector:USB_C_Receptacle_USB2.0_16P' : 'ChatPCB:USB_C_CONNECTOR', 'USB-C sink connector with VBUS, USB data, CC pins, and GND.', 'Connector_USB:USB_C_Receptacle_HRO_TYPE-C-31-M-12', {
        value: profileMode ? 'USB_C_CONNECTOR' : undefined,
        pins: ['VBUS', 'USB_DP', 'USB_DN', 'GND', 'CC1', 'CC2'],
        connectedPins: ['VBUS', 'USB_DP', 'USB_DN', 'GND', 'CC1', 'CC2'],
        pinNets: profileMode
          ? {
              A1: 'GND',
              A4: 'VBUS',
              A5: 'CC1',
              A6: 'USB_DP',
              A7: 'USB_DN',
              A9: 'VBUS',
              A12: 'GND',
              B1: 'GND',
              B4: 'VBUS',
              B5: 'CC2',
              B6: 'USB_DP',
              B7: 'USB_DN',
              B9: 'VBUS',
              B12: 'GND'
            }
          : undefined
      })
    );
  }

  if (spec.interfaces.some((iface) => iface.kind === 'spi')) {
    components.push(
      component('J5', profileMode ? 'Connector_Generic:Conn_01x06' : 'ChatPCB:SPI_HEADER', 'SPI expansion header exposing SCK, MOSI, MISO, CS, +3V3, and GND.', 'Connector_PinHeader_2.54mm:PinHeader_1x06_P2.54mm_Vertical', {
        value: profileMode ? 'SPI_HEADER' : undefined,
        pins: ['SCK', 'MOSI', 'MISO', 'CS', '+3V3', 'GND'],
        connectedPins: ['SCK', 'MOSI', 'MISO', 'CS', '+3V3', 'GND'],
        pinNets: profileMode ? { 1: 'SCK', 2: 'MOSI', 3: 'MISO', 4: 'CS', 5: '+3V3', 6: 'GND' } : undefined
      })
    );
  }

  if (spec.interfaces.some((iface) => iface.kind === 'gpio')) {
    components.push(
      component('J6', profileMode ? 'Connector_Generic:Conn_01x05' : 'ChatPCB:GPIO_HEADER', 'GPIO expansion header exposing GPIO0, GPIO1, GPIO2, +3V3, and GND.', 'Connector_PinHeader_2.54mm:PinHeader_1x05_P2.54mm_Vertical', {
        value: profileMode ? 'GPIO_HEADER' : undefined,
        pins: ['GPIO0', 'GPIO1', 'GPIO2', '+3V3', 'GND'],
        connectedPins: ['GPIO0', 'GPIO1', 'GPIO2', '+3V3', 'GND'],
        pinNets: profileMode ? { 1: 'GPIO0', 2: 'GPIO1', 3: 'GPIO2', 4: '+3V3', 5: 'GND' } : undefined
      })
    );
  }

  if (spec.debug?.nets?.length > 0) {
    components.push(
      component('J7', profileMode ? 'Connector_Generic:Conn_02x05_Odd_Even' : 'ChatPCB:DEBUG_HEADER', `${spec.debug.implementedProtocol.toUpperCase()} debug header for ${spec.mcu.family}.`, 'Connector_PinHeader_2.54mm:PinHeader_2x05_P2.54mm_Vertical', {
        value: profileMode ? 'DEBUG_HEADER' : undefined,
        pins: [...spec.debug.nets, '+3V3', 'GND', 'RESET', 'BOOT'],
        connectedPins: [...spec.debug.nets, '+3V3', 'GND', 'RESET', 'BOOT'],
        pinNets: profileMode
          ? Object.fromEntries([...spec.debug.nets, '+3V3', 'GND', 'RESET', 'BOOT'].map((net, index) => [String(index + 1), net]))
          : undefined
      })
    );
  }

  if (spec.peripherals.some((peripheral) => peripheral.kind === 'decoupling-network')) {
    components.push(
      component('C1', profileMode ? 'Device:C' : 'ChatPCB:DECOUPLING_CAP', 'Local 0.1uF decoupling capacitor near MCU 3.3V pins.', 'Capacitor_SMD:C_0603_1608Metric', { value: '100nF', pins: ['+3V3', 'GND'], connectedPins: ['+3V3', 'GND'], pinNets: profileMode ? { 1: '+3V3', 2: 'GND' } : undefined }),
      component('C2', profileMode ? 'Device:C' : 'ChatPCB:DECOUPLING_CAP', 'Buck output 10uF capacitor on the 3.3V rail.', 'Capacitor_SMD:C_0603_1608Metric', { value: '10uF', pins: ['+3V3', 'GND'], connectedPins: ['+3V3', 'GND'], pinNets: profileMode ? { 1: '+3V3', 2: 'GND' } : undefined }),
      ...(profileMode
        ? [
            component('C3', 'Device:C', 'Buck input 10uF capacitor on VBUS.', 'Capacitor_SMD:C_0603_1608Metric', { value: '10uF', pins: ['VBUS', 'GND'], connectedPins: ['VBUS', 'GND'], pinNets: { 1: 'VBUS', 2: 'GND' } }),
            component('L1', 'Device:L', 'Buck inductor between switch node and +3V3 output.', 'Inductor_SMD:L_0805_2012Metric', { value: '2.2uH', pins: ['SW_3V3', '+3V3'], connectedPins: ['SW_3V3', '+3V3'], pinNets: { 1: 'SW_3V3', 2: '+3V3' } })
          ]
        : [])
    );
  }

  if (spec.peripherals.some((peripheral) => peripheral.kind === 'usb-c-cc-pulldowns')) {
    components.push(
      component('R1', profileMode ? 'Device:R' : 'ChatPCB:CC_RESISTOR', 'USB-C sink pulldown on CC1.', 'Resistor_SMD:R_0603_1608Metric', { value: '5.1k', pins: ['CC1', 'GND'], connectedPins: ['CC1', 'GND'], pinNets: profileMode ? { 1: 'CC1', 2: 'GND' } : undefined }),
      component('R2', profileMode ? 'Device:R' : 'ChatPCB:CC_RESISTOR', 'USB-C sink pulldown on CC2.', 'Resistor_SMD:R_0603_1608Metric', { value: '5.1k', pins: ['CC2', 'GND'], connectedPins: ['CC2', 'GND'], pinNets: profileMode ? { 1: 'CC2', 2: 'GND' } : undefined })
    );
  }

  if (spec.peripherals.some((peripheral) => peripheral.kind === 'status-led-resistor')) {
    components.push(
      component('R3', profileMode ? 'Device:R' : 'ChatPCB:LED_RESISTOR', 'Status LED series resistor for a bounded indicator current.', 'Resistor_SMD:R_0603_1608Metric', {
        pins: ['+3V3', 'GND'],
        connectedPins: ['+3V3', 'GND'],
        pinNets: profileMode ? { 1: '+3V3', 2: 'GND' } : undefined,
        value: '1k'
      })
    );
  }

  if (spec.peripherals.some((peripheral) => peripheral.kind === 'i2c-pullups')) {
    components.push(
      component('R4', profileMode ? 'Device:R' : 'ChatPCB:I2C_PULLUP', 'I2C SCL pull-up resistor to +3V3.', 'Resistor_SMD:R_0603_1608Metric', {
        value: '4.7k',
        pins: ['+3V3', 'SCL'],
        connectedPins: ['+3V3', 'SCL'],
        pinNets: profileMode ? { 1: '+3V3', 2: 'SCL' } : undefined
      }),
      component('R5', profileMode ? 'Device:R' : 'ChatPCB:I2C_PULLUP', 'I2C SDA pull-up resistor to +3V3.', 'Resistor_SMD:R_0603_1608Metric', {
        value: '4.7k',
        pins: ['+3V3', 'SDA'],
        connectedPins: ['+3V3', 'SDA'],
        pinNets: profileMode ? { 1: '+3V3', 2: 'SDA' } : undefined
      })
    );
  }

  if (profileMode) {
    components.push(
      component('#FLG1', 'power:PWR_FLAG', 'ERC power source marker for the externally supplied USB-C VBUS rail.', '', {
        value: 'PWR_FLAG',
        pins: ['VBUS'],
        connectedPins: ['VBUS'],
        pinNets: { 1: 'VBUS' }
      }),
      component('#FLG2', 'power:PWR_FLAG', 'ERC power source marker for the board ground reference.', '', {
        value: 'PWR_FLAG',
        pins: ['GND'],
        connectedPins: ['GND'],
        pinNets: { 1: 'GND' }
      })
    );
  }

  return {
    components,
    nets: unique(['VBUS', '+3V3', 'GND', ...interfaceNetNames(spec), ...(spec.debug?.nets ?? []), 'RESET', 'BOOT', ...components.flatMap((item) => item.connectedPins ?? [])]).map((name) => ({
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
${schematic.components.map((item, index) => renderPlacedComponent(item, 38.1 + (index % SCHEMATIC_GRID_COLUMNS) * 38.1, 88.9 + Math.floor(index / SCHEMATIC_GRID_COLUMNS) * SCHEMATIC_GRID_ROW_SPACING_MM, baseName)).join('\n')}
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

export function renderProjectSymbolLibrary(usedLibIds = fixtureSymbols().map(([id]) => id)) {
  const used = new Set(usedLibIds);
  return `(kicad_symbol_lib
  (version 20241209)
  (generator "chatpcb")
  (generator_version "0.1")
${fixtureSymbols()
  .filter(([id]) => used.has(id))
  .map(([id, referencePrefix, value]) => renderLibSymbol(id, referencePrefix, value, symbolPinsFor(id), { projectLibrary: true }))
  .join('\n')}
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

function component(ref, libId, explanation, footprint, { connectedPins, pinNets, pins, value } = {}) {
  return {
    ref,
    libId,
    value: value ?? libId.split(':')[1],
    footprint,
    explanation,
    pins,
    pinNets,
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
  const fixtureBlocks = fixtureSymbols()
    .filter(([id]) => used.has(id))
    .map(([id, referencePrefix, value]) => renderLibSymbol(id, referencePrefix, value, symbolPinsFor(id)));
  const officialBlocks = officialCacheDependenciesFor([...used])
    .map((libId) => renderOfficialCachedSymbol(libId))
    .filter(Boolean);

  return `  (lib_symbols
${[...fixtureBlocks, ...officialBlocks].join('\n')}
  )`;
}

function renderBoardFootprint(componentModel, x, y) {
  const uuid = randomUUID();

  return `  (footprint "${escapeSchText(componentModel.footprint)}"
    (layer "F.Cu")
    (uuid "${uuid}")
    (at ${sch(x)} ${sch(y)} 0)
    (property "Reference" "${escapeSchText(componentModel.ref)}"
      (at 0 -2 0)
      (layer "F.SilkS")
      (effects (font (size 1 1) (thickness 0.15)))
    )
    (property "Value" "${escapeSchText(componentModel.value)}"
      (at 0 2 0)
      (layer "F.Fab")
      (effects (font (size 1 1) (thickness 0.15)))
    )
  )`;
}

function officialCacheDependenciesFor(usedLibIds) {
  const dependencies = [];
  for (const libId of usedLibIds) {
    if (officialPinDefinitionsFor(libId).length > 0) {
      dependencies.push(libId);
    }
  }
  return unique(dependencies);
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
    ['ChatPCB:CC_RESISTOR', 'R', 'CC_RESISTOR'],
    ['ChatPCB:LED_RESISTOR', 'R', 'LED_RESISTOR'],
    ['ChatPCB:I2C_PULLUP', 'R', 'I2C_PULLUP']
  ];
}

function renderOfficialCachedSymbol(libId) {
  const [library, symbolName] = libId.split(':');
  if (!library || !symbolName) {
    return null;
  }

  const libraryPath = officialSymbolLibraryPath(library);
  if (!libraryPath) {
    return null;
  }

  try {
    const source = readFileSync(libraryPath, 'utf8');
    const block = extractSymbolBlock(source, symbolName);
    return indentOfficialSymbolBlock(transformOfficialSymbolBlock(block, library, symbolName));
  } catch {
    return null;
  }
}

function officialSymbolLibraryPath(library) {
  const candidates = [
    process.env.KICAD_SYMBOL_DIR,
    'C:/Users/windo/AppData/Local/Programs/KiCad/10.0/share/kicad/symbols',
    'C:/Program Files/KiCad/10.0/share/kicad/symbols'
  ].filter(Boolean);

  return candidates.map((dir) => `${dir}/${library}.kicad_sym`).find((file) => existsSync(file)) ?? null;
}

function extractSymbolBlock(source, symbolName) {
  const start = source.indexOf(`(symbol "${symbolName}"`);
  if (start < 0) {
    throw new Error(`Symbol ${symbolName} not found.`);
  }

  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === '(') {
      depth += 1;
    } else if (source[index] === ')') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }

  throw new Error(`Symbol ${symbolName} is unterminated.`);
}

function transformOfficialSymbolBlock(block, library, symbolName) {
  return block.replace(`(symbol "${symbolName}"`, `(symbol "${library}:${symbolName}"`);
}

function indentOfficialSymbolBlock(block) {
  return block
    .split(/\r?\n/)
    .map((line) => `    ${line.replace(/\t/g, '  ')}`)
    .join('\n');
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
  const pins = componentModel.pins ?? symbolPinsFor(componentModel.libId);
  const pinSlots = pinDefinitionsFor(componentModel.libId, pins);
  const connectedPins = new Set(componentModel.connectedPins ?? pins);

  return [
    renderSymbolInstance(componentModel, x, y, baseName),
    ...pinSlots.flatMap((pinDef, index) => {
      const netName = componentModel.pinNets?.[pinDef.number] ?? pins[index];
      if (netName && connectedPins.has(netName)) {
        return renderPinNetStub(netName, x, y, pinDef);
      }

      const point = pinConnectionPoint(x, y, pinDef);
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

function pinDefinitionsFor(libId, fallbackPins) {
  const official = officialPinDefinitionsFor(libId);
  return official.length > 0 ? official : generatedPinDefinitions(fallbackPins);
}

function officialPinDefinitionsFor(libId) {
  switch (libId) {
    case 'Connector_Generic:Conn_01x02':
      return [
        pinDef('1', -5.08, 0, 0),
        pinDef('2', -5.08, -2.54, 0)
      ];
    case 'Regulator_Linear:TC1262-33':
      return [pinDef('1', -7.62, 0, 0), pinDef('2', 0, -7.62, 90), pinDef('3', 7.62, 0, 180)];
    case 'Regulator_Switching:TPS62177DQC':
      return [
        pinDef('1', 0, -12.7, 90),
        pinDef('2', -10.16, 7.62, 0),
        pinDef('3', -10.16, 5.08, 0),
        pinDef('4', -5.08, -12.7, 90),
        pinDef('5', 10.16, 2.54, 180),
        pinDef('6', 2.54, -12.7, 90),
        pinDef('7', -10.16, -5.08, 0),
        pinDef('8', -10.16, 0, 0),
        pinDef('9', 10.16, 7.62, 180),
        pinDef('10', 10.16, 5.08, 180),
        pinDef('11', -2.54, -12.7, 90)
      ];
    case 'power:PWR_FLAG':
      return [pinDef('1', 0, 0, 90)];
    case 'Switch:SW_Push':
      return [pinDef('1', -5.08, 0, 0), pinDef('2', 5.08, 0, 180)];
    case 'Device:LED':
      return [pinDef('1', -3.81, 0, 0), pinDef('2', 3.81, 0, 180)];
    case 'Connector_Generic:Conn_01x04':
      return [pinDef('1', -5.08, 2.54, 0), pinDef('2', -5.08, 0, 0), pinDef('3', -5.08, -2.54, 0), pinDef('4', -5.08, -5.08, 0)];
    case 'Connector_Generic:Conn_01x05':
      return [
        pinDef('1', -5.08, 5.08, 0),
        pinDef('2', -5.08, 2.54, 0),
        pinDef('3', -5.08, 0, 0),
        pinDef('4', -5.08, -2.54, 0),
        pinDef('5', -5.08, -5.08, 0)
      ];
    case 'Connector_Generic:Conn_01x06':
      return [
        pinDef('1', -5.08, 5.08, 0),
        pinDef('2', -5.08, 2.54, 0),
        pinDef('3', -5.08, 0, 0),
        pinDef('4', -5.08, -2.54, 0),
        pinDef('5', -5.08, -5.08, 0),
        pinDef('6', -5.08, -7.62, 0)
      ];
    case 'Connector_Generic:Conn_02x05_Odd_Even':
      return [
        pinDef('1', -5.08, 5.08, 0),
        pinDef('2', 7.62, 5.08, 180),
        pinDef('3', -5.08, 2.54, 0),
        pinDef('4', 7.62, 2.54, 180),
        pinDef('5', -5.08, 0, 0),
        pinDef('6', 7.62, 0, 180),
        pinDef('7', -5.08, -2.54, 0),
        pinDef('8', 7.62, -2.54, 180),
        pinDef('9', -5.08, -5.08, 0),
        pinDef('10', 7.62, -5.08, 180)
      ];
    case 'Device:C':
    case 'Device:L':
    case 'Device:R':
      return [pinDef('1', 0, 3.81, 270), pinDef('2', 0, -3.81, 90)];
    case 'Connector:USB_C_Receptacle_USB2.0_16P':
      return [
        pinDef('A1', 0, -22.86, 90),
        pinDef('A4', 15.24, 15.24, 180),
        pinDef('A5', 15.24, 10.16, 180),
        pinDef('A6', 15.24, -2.54, 180),
        pinDef('A7', 15.24, 2.54, 180),
        pinDef('A8', 15.24, -12.7, 180),
        pinDef('A9', 15.24, 15.24, 180),
        pinDef('A12', 0, -22.86, 90),
        pinDef('B1', 0, -22.86, 90),
        pinDef('B4', 15.24, 15.24, 180),
        pinDef('B5', 15.24, 7.62, 180),
        pinDef('B6', 15.24, -5.08, 180),
        pinDef('B7', 15.24, 0, 180),
        pinDef('B8', 15.24, -15.24, 180),
        pinDef('B9', 15.24, 15.24, 180),
        pinDef('B12', 0, -22.86, 90),
        pinDef('SH', -7.62, -22.86, 90)
      ];
    default:
      return [];
  }
}

function generatedPinDefinitions(pins) {
  return pins.map((_, index) => {
    const leftSide = index % 2 === 0;
    return pinDef(String(index + 1), leftSide ? -12.7 : 12.7, 5.08 - Math.floor(index / 2) * 2.54, leftSide ? 0 : 180);
  });
}

function pinDef(number, x, y, rotation) {
  return { number, x, y, rotation };
}

function symbolPinsFor(libId) {
  switch (libId) {
    case 'ChatPCB:POWER_INPUT':
    case 'Connector_Generic:Conn_01x02':
      return ['VBUS', 'GND'];
    case 'ChatPCB:REGULATOR_3V3':
    case 'Regulator_Linear:TC1262-33':
    case 'Regulator_Switching:TPS62177DQC':
      return ['VBUS', 'GND', '+3V3'];
    case 'power:PWR_FLAG':
      return ['VBUS'];
    case 'ChatPCB:MCU_PLACEHOLDER':
    case 'ChatPCB:ESP32_S3_WROOM_1':
    case 'ChatPCB:STM32G0B1CBT6':
      return ['+3V3', 'GND', 'SCL', 'SDA', 'TX', 'RX', 'USB_DP', 'USB_DN', 'SCK', 'MOSI', 'MISO', 'CS', 'GPIO0', 'GPIO1', 'GPIO2', 'SWDIO', 'SWCLK', 'NRST', 'MTMS', 'MTCK', 'MTDI', 'MTDO', 'RESET', 'BOOT'];
    case 'ChatPCB:RESET_BUTTON':
    case 'Switch:SW_Push':
      return ['RESET', 'GND'];
    case 'ChatPCB:BOOT_BUTTON':
      return ['BOOT', 'GND'];
    case 'ChatPCB:STATUS_LED':
    case 'Device:LED':
      return ['+3V3', 'GND'];
    case 'ChatPCB:I2C_CONNECTOR':
    case 'Connector_Generic:Conn_01x04':
      return ['SCL', 'SDA', '+3V3', 'GND'];
    case 'ChatPCB:UART_HEADER':
      return ['TX', 'RX', '+3V3', 'GND'];
    case 'ChatPCB:USB_C_CONNECTOR':
    case 'Connector:USB_C_Receptacle_USB2.0_16P':
      return ['VBUS', 'USB_DP', 'USB_DN', 'GND', 'CC1', 'CC2'];
    case 'ChatPCB:SPI_HEADER':
    case 'Connector_Generic:Conn_01x06':
      return ['SCK', 'MOSI', 'MISO', 'CS', '+3V3', 'GND'];
    case 'ChatPCB:GPIO_HEADER':
    case 'Connector_Generic:Conn_01x05':
      return ['GPIO0', 'GPIO1', 'GPIO2', '+3V3', 'GND'];
    case 'ChatPCB:DEBUG_HEADER':
      return ['SWDIO', 'SWCLK', 'NRST', 'MTMS', 'MTCK', 'MTDI', 'MTDO', '+3V3', 'GND', 'RESET', 'BOOT'];
    case 'Connector_Generic:Conn_02x05_Odd_Even':
      return ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
    case 'ChatPCB:DECOUPLING_CAP':
    case 'Device:C':
      return ['+3V3', 'GND'];
    case 'Device:L':
      return ['SW_3V3', '+3V3'];
    case 'ChatPCB:CC_RESISTOR':
      return ['CC1', 'GND', 'CC2'];
    case 'ChatPCB:LED_RESISTOR':
    case 'Device:R':
      return ['+3V3', 'GND'];
    case 'ChatPCB:I2C_PULLUP':
      return ['+3V3', 'SCL', 'SDA'];
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

function pinConnectionPoint(symbolX, symbolY, pinDef) {
  return {
    x: symbolX + pinDef.x,
    y: symbolY - pinDef.y,
    rotation: pinDef.rotation
  };
}

function renderPinNetStub(pinName, symbolX, symbolY, pinDef) {
  const start = pinConnectionPoint(symbolX, symbolY, pinDef);
  const end = labelPointFromPin(start);

  return [
    renderWire(start, end),
    renderLabel(pinName, end.x, end.y, start.rotation)
  ];
}

function labelPointFromPin(pin) {
  switch (pin.rotation) {
    case 90:
      return { x: pin.x, y: pin.y + 5.08 };
    case 180:
      return { x: pin.x + 5.08, y: pin.y };
    case 270:
      return { x: pin.x, y: pin.y - 5.08 };
    default:
      return { x: pin.x - 5.08, y: pin.y };
  }
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
