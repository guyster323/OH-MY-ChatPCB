import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

import { boardPadGeometry } from './pad-geometry.js';

const KICAD_COORDINATE_SCALE = 1;
const BOARD_LOCAL_TRACE_MAX_MM = 8;
const BOARD_TRACE_PAD_KEEP_OUT_MM = 0.8;
const BOARD_SAME_FOOTPRINT_PAD_KEEP_OUT_MM = 0.45;
const BOARD_CROSS_FOOTPRINT_TRACE_MAX_MM = 30;
const BOARD_CROSS_FOOTPRINT_TRACE_PAD_KEEP_OUT_MM = 1.0;
const SCHEMATIC_GRID_COLUMNS = 5;
const SCHEMATIC_GRID_ROW_SPACING_MM = 45.72;
const PROFILE_BOARD_PLACEMENTS = {
  J4: { x: 18, y: 65, rotation: 0 }, C3: { x: 35, y: 55, rotation: 0 },
  U1: { x: 52, y: 55, rotation: 0 }, J6: { x: 135, y: 95, rotation: 0 }, L1: { x: 64, y: 68, rotation: 0 },
  C2: { x: 78, y: 54, rotation: 0 }, R1: { x: 12, y: 82, rotation: 0 }, R2: { x: 36, y: 82, rotation: 0 }
};
const PROFILE_POWER_PATHS = [
  ['SW_3V3', ['U1', 'L1'], { relaxSameFootprint: true }],
  ['+3V3', ['L1', 'C2'], { relaxSameFootprint: false }]
];
const PROFILE_SIGNAL_PATHS = [
  ['CC1', ['J4', 'R1'], { route: 'usb-c-escape', relaxSameFootprint: true }],
  ['CC2', ['J4', 'R2'], { route: 'usb-c-escape', relaxSameFootprint: true }],
  ['SCL', ['J2', 'R4'], { anchors: [{ x: 47, y: 39 }, { x: 70, y: 39 }, { x: 90, y: 60 }, { x: 113, y: 60 }] }],
  ['SDA', ['J2', 'R5'], { anchors: [{ x: 42, y: 45.54 }, { x: 42, y: 65 }, { x: 44, y: 90 }, { x: 26, y: 90 }] }]
];
const BOARD_OUTLINE = { minX: 10, minY: 10, maxX: 160, maxY: 120 };
const BOARD_ROUTE_ESCAPE_OFFSETS_MM = [2, 4, 6, 8, 10, 12, 16];

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
      },
      board: {
        design_settings: {
          rules: {
            min_clearance: 0.15,
            min_hole_clearance: 0.15,
            min_hole_to_hole: 0.25,
            min_through_hole_diameter: 0.2,
            min_track_width: 0.15,
            min_via_diameter: 0.5
          }
        }
      }
    },
    null,
    2
  )}\n`;
}

export function renderKiCadBoard({ baseName, schematic, boardProfile }) {
  const profileMode = Boolean(boardProfile?.id);
  const components = schematic.components.filter((component) => component.footprint);
  const netIds = boardNetIdsFor(components);
  const padCentersByNet = new Map();
  const netDeclarations = [...netIds.entries()].map(([name, id]) => `  (net ${id} "${escapeSchText(name)}")`).join('\n');
  const footprints = components
    .map((component, index) => {
      const placement = boardPlacementFor(component, index, profileMode);
      return renderBoardFootprint(component, placement.x, placement.y, placement.rotation, netIds, padCentersByNet);
    })
    .join('\n');
  const segments = renderBoardSegments(padCentersByNet, netIds, profileMode);
  const groundZone = renderGroundZone(netIds, profileMode);

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
${netDeclarations}
  (gr_rect
    (start 10 10)
    (end 160 120)
    (stroke
      (width 0.1)
      (type default)
    )
    (fill none)
    (layer "Edge.Cuts")
    (uuid "${randomUUID()}")
  )
${footprints}
${segments}
${groundZone}
)`;
}

function renderGroundZone(netIds, profileMode) {
  const groundNetId = netIds.get('GND');
  if (!profileMode || !groundNetId) {
    return '';
  }

  const inset = 0.5;
  const x0 = BOARD_OUTLINE.minX + inset;
  const y0 = BOARD_OUTLINE.minY + inset;
  const x1 = BOARD_OUTLINE.maxX - inset;
  const y1 = BOARD_OUTLINE.maxY - inset;

  return `  (zone
    (net ${groundNetId})
    (net_name "GND")
    (layer "F.Cu")
    (uuid "${randomUUID()}")
    (hatch edge 0.5)
    (connect_pads yes
      (clearance 0.3)
    )
    (min_thickness 0.25)
    (filled_areas_thickness no)
    (fill
      (thermal_gap 0.5)
      (thermal_bridge_width 0.5)
    )
    (polygon
      (pts
        (xy ${sch(x0)} ${sch(y0)})
        (xy ${sch(x1)} ${sch(y0)})
        (xy ${sch(x1)} ${sch(y1)})
        (xy ${sch(x0)} ${sch(y1)})
      )
    )
  )`;
}

function boardPlacementFor(componentModel, index, profileMode) {
  return profileMode && PROFILE_BOARD_PLACEMENTS[componentModel.ref]
    ? PROFILE_BOARD_PLACEMENTS[componentModel.ref]
    : { x: 25 + (index % 5) * 22, y: 25 + Math.floor(index / 5) * 18, rotation: 0 };
}

export function buildMcuSchematicAst(spec) {
  if (spec.boardProfile?.kind === 'bms') {
    return buildBmsSchematicAst(spec);
  }

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

export function buildBmsSchematicAst(spec) {
  const components = [];
  const cellTaps = Array.from({ length: 17 }, (_value, index) => `PACK_B${index}`);
  const pinConnections = adbms6830PinConnections();

  components.push(
    component('U1', 'ChatPCB:ADBMS6830', 'ADBMS6830 16-channel battery stack monitor example; exact package and pin revision review is required.', '', {
      value: 'ADBMS6830',
      pins: pinConnections.map((pin) => pin.name),
      pinNets: Object.fromEntries(pinConnections.map((pin, index) => [String(index + 1), pin.net])),
      connectedPins: unique(pinConnections.map((pin) => pin.net))
    }),
    component('J1', 'ChatPCB:BMS_CELL_CONNECTOR', '16S cell-tap connector. PACK_B0 is pack negative and PACK_B16 is pack positive in this example.', 'Connector_PinHeader_2.54mm:PinHeader_1x17_P2.54mm_Vertical', {
      value: '16S_CELL_TAPS',
      pins: cellTaps,
      pinNets: Object.fromEntries(cellTaps.map((net, index) => [String(index + 1), net])),
      connectedPins: cellTaps
    }),
    component('J2', 'Connector_Generic:Conn_01x06', 'isoSPI host/chain connector exposing both A/B differential pairs and local references.', 'Connector_PinHeader_2.54mm:PinHeader_1x06_P2.54mm_Vertical', {
      value: 'ISOSPI_HOST',
      pins: ['ISOPA', 'ISOMA', 'ISOPB', 'ISOMB', 'VREG', 'PACK_B0'],
      pinNets: { 1: 'ISOPA', 2: 'ISOMA', 3: 'ISOPB', 4: 'ISOMB', 5: 'VREG', 6: 'PACK_B0' },
      connectedPins: ['ISOPA', 'ISOMA', 'ISOPB', 'ISOMB', 'VREG', 'PACK_B0']
    }),
    component('J4', 'Connector_Generic:Conn_01x06', 'Temperature connector for four 10k NTC channels, VREF2, and pack-negative reference.', 'Connector_PinHeader_2.54mm:PinHeader_1x06_P2.54mm_Vertical', {
      value: 'TEMPERATURE_INPUTS',
      pins: ['TEMP1', 'TEMP2', 'TEMP3', 'TEMP4', 'VREF2', 'PACK_B0'],
      pinNets: { 1: 'TEMP1', 2: 'TEMP2', 3: 'TEMP3', 4: 'TEMP4', 5: 'VREF2', 6: 'PACK_B0' },
      connectedPins: ['TEMP1', 'TEMP2', 'TEMP3', 'TEMP4', 'VREF2', 'PACK_B0']
    })
  );

  for (let index = 1; index <= 16; index += 1) {
    const previousFilterNet = index === 1 ? 'PACK_B0' : `FILTER_C${index - 1}`;
    components.push(
      component(`R${index}`, 'Device:R', `200R cell-input filter resistor for C${index}.`, 'Resistor_SMD:R_0603_1608Metric', {
        value: '200R',
        pins: [`PACK_B${index}`, `FILTER_C${index}`],
        pinNets: { 1: `PACK_B${index}`, 2: `FILTER_C${index}` },
        connectedPins: [`PACK_B${index}`, `FILTER_C${index}`]
      }),
      component(`C${index}`, 'Device:C', `10nF differential filter capacitor for cell ${index}.`, 'Capacitor_SMD:C_0603_1608Metric', {
        value: '10nF',
        pins: [`FILTER_C${index}`, previousFilterNet],
        pinNets: { 1: `FILTER_C${index}`, 2: previousFilterNet },
        connectedPins: [`FILTER_C${index}`, previousFilterNet]
      }),
      component(`RB${index}`, 'Device:R', `1k example passive balancing resistor for cell ${index}; verify population and thermal limits.`, 'Resistor_SMD:R_1206_3216Metric', {
        value: '1k',
        pins: [`PACK_B${index}`, `BAL_S${index}P`],
        pinNets: { 1: `PACK_B${index}`, 2: `BAL_S${index}P` },
        connectedPins: [`PACK_B${index}`, `BAL_S${index}P`]
      })
    );
  }

  components.push(
    component('Q1', 'ChatPCB:BMS_NPN', 'External NPN pass transistor for the ADBMS6830 DRIVE/VREG example network.', 'Package_TO_SOT_SMD:SOT-23', {
      value: 'NPN_PASS',
      pins: ['B', 'C', 'E'],
      pinNets: { 1: 'VREG_BASE', 2: 'VREG_COLLECTOR', 3: 'VREG_PASS' },
      connectedPins: ['VREG_BASE', 'VREG_COLLECTOR', 'VREG_PASS']
    }),
    component('R17', 'Device:R', 'DRIVE pin filter resistor.', 'Resistor_SMD:R_0603_1608Metric', {
      value: '10R',
      pins: ['VREG_DRIVE', 'VREG_BASE'],
      pinNets: { 1: 'VREG_DRIVE', 2: 'VREG_BASE' },
      connectedPins: ['VREG_DRIVE', 'VREG_BASE']
    }),
    component('R18', 'Device:R', 'VREG collector transient filter resistor.', 'Resistor_SMD:R_0603_1608Metric', {
      value: '330R',
      pins: ['PACK_B16', 'VREG_COLLECTOR'],
      pinNets: { 1: 'PACK_B16', 2: 'VREG_COLLECTOR' },
      connectedPins: ['PACK_B16', 'VREG_COLLECTOR']
    }),
    component('C17', 'Device:C', 'DRIVE pin filter capacitor.', 'Capacitor_SMD:C_0603_1608Metric', {
      value: '10nF',
      pins: ['VREG_BASE', 'PACK_B0'],
      pinNets: { 1: 'VREG_BASE', 2: 'PACK_B0' },
      connectedPins: ['VREG_BASE', 'PACK_B0']
    }),
    component('C18', 'Device:C', 'VREG collector transient filter capacitor.', 'Capacitor_SMD:C_0603_1608Metric', {
      value: '10nF',
      pins: ['VREG_COLLECTOR', 'PACK_B0'],
      pinNets: { 1: 'VREG_COLLECTOR', 2: 'PACK_B0' },
      connectedPins: ['VREG_COLLECTOR', 'PACK_B0']
    }),
    component('FB1', 'Device:L', 'Ferrite bead between the NPN emitter and VREG reservoir.', 'Inductor_SMD:L_0603_1608Metric', {
      value: 'VREG_FERRITE',
      pins: ['VREG_PASS', 'VREG'],
      pinNets: { 1: 'VREG_PASS', 2: 'VREG' },
      connectedPins: ['VREG_PASS', 'VREG']
    }),
    component('C19', 'Device:C', 'VREG reservoir capacitor.', 'Capacitor_SMD:C_0603_1608Metric', {
      value: '1uF',
      pins: ['VREG', 'PACK_B0'],
      pinNets: { 1: 'VREG', 2: 'PACK_B0' },
      connectedPins: ['VREG', 'PACK_B0']
    }),
    component('C20', 'Device:C', 'VREF1 bypass capacitor; no DC load is assigned in this example.', 'Capacitor_SMD:C_0603_1608Metric', {
      value: '1uF',
      pins: ['VREF1', 'PACK_B0'],
      pinNets: { 1: 'VREF1', 2: 'PACK_B0' },
      connectedPins: ['VREF1', 'PACK_B0']
    }),
    component('C21', 'Device:C', 'VREF2 bypass capacitor for thermistor reference.', 'Capacitor_SMD:C_0603_1608Metric', {
      value: '1uF',
      pins: ['VREF2', 'PACK_B0'],
      pinNets: { 1: 'VREF2', 2: 'PACK_B0' },
      connectedPins: ['VREF2', 'PACK_B0']
    })
  );

  for (let index = 1; index <= 4; index += 1) {
    components.push(
      component(`R${19 + index}`, 'Device:R', `10k pull-up for TEMP${index} from VREF2.`, 'Resistor_SMD:R_0603_1608Metric', {
        value: '10k',
        pins: ['VREF2', `TEMP${index}`],
        pinNets: { 1: 'VREF2', 2: `TEMP${index}` },
        connectedPins: ['VREF2', `TEMP${index}`]
      }),
      component(`R${23 + index}`, 'Device:R', `10k NTC example for TEMP${index}.`, 'Resistor_SMD:R_0603_1608Metric', {
        value: 'NTC_10k',
        pins: [`TEMP${index}`, 'PACK_B0'],
        pinNets: { 1: `TEMP${index}`, 2: 'PACK_B0' },
        connectedPins: [`TEMP${index}`, 'PACK_B0']
      })
    );
  }

  return {
    components,
    nets: unique(components.flatMap((item) => Object.values(item.pinNets ?? {}))).map((name) => ({
      name,
      explanation: explainNet(name)
    }))
  };
}

function adbms6830PinConnections() {
  const pins = [{ name: 'V+', net: 'PACK_B16' }];

  for (let index = 1; index <= 16; index += 1) {
    pins.push({ name: `C${index}`, net: `FILTER_C${index}` });
  }

  for (let index = 1; index <= 16; index += 1) {
    pins.push({ name: `S${index}N`, net: `PACK_B${index - 1}` });
    pins.push({ name: `S${index}P`, net: `BAL_S${index}P` });
  }

  pins.push(
    { name: 'IPA', net: 'ISOPA' },
    { name: 'IMA', net: 'ISOMA' },
    { name: 'CSB', net: null },
    { name: 'SCK', net: null },
    { name: 'SDI', net: null },
    { name: 'SDO', net: null },
    { name: 'ISOMD', net: 'VREG' },
    { name: 'IPB', net: 'ISOPB' },
    { name: 'IMB', net: 'ISOMB' },
    { name: 'DRIVE', net: 'VREG_DRIVE' },
    { name: 'NC', net: null },
    { name: 'V-', net: 'PACK_B0' },
    { name: 'VREF2', net: 'VREF2' },
    { name: 'VREG', net: 'VREG' },
    { name: 'VREF1', net: 'VREF1' }
  );

  for (let index = 1; index <= 10; index += 1) {
    pins.push({ name: `GPIO${index}`, net: index <= 4 ? `TEMP${index}` : null });
  }

  pins.push({ name: 'EP', net: 'PACK_B0' });
  return pins;
}

export function renderKiCadSchematic({ baseName, spec, schematic = buildMcuSchematicAst(spec) }) {
  const uuid = randomUUID();
  const notes = spec.boardProfile?.kind === 'bms'
    ? [
        `ChatPCB generated BMS example: ${spec.title}`,
        'IC: ADBMS6830 16-channel battery monitor; exact package and pin revision review is pending.',
        'Example assumption: one 16S Li-ion stack, 3.7V nominal and 4.2V full-charge per cell.',
        'Cell inputs use 200R filters and 10nF differential capacitors; balancing uses 1k example resistors.',
        'The example includes four 10k NTC channels, an NPN VREG pass stage, and bidirectional isoSPI.',
        'Monitoring/balancing example only: no charger, fuse, contactor, protection FET, or safety certification is included.',
        'Review the exact Analog Devices datasheet, cell chemistry, protection strategy, isolation, thermal, and layout before energizing.'
      ]
    : [
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
  if (spec.boardProfile?.kind === 'bms') {
    return [
      `* OH-MY-ChatPCB SPICE fixture for ${spec.title}`,
      '* This is a topology placeholder only; it does not model cells, balancing, protection, isolation, faults, or safety behavior.',
      '* Do not use this netlist as battery-connection or production evidence.',
      '.end',
      ''
    ].join('\n');
  }

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
  if (/^PACK_B\d+$/.test(name)) {
    return 'Battery-stack cell tap in the 16S example; verify connector order and pack polarity before connection.';
  }

  if (/^FILTER_C\d+$/.test(name)) {
    return 'Filtered ADBMS6830 cell measurement node.';
  }

  if (/^BAL_S\d+P$/.test(name)) {
    return 'ADBMS6830 passive-balance positive-side example node.';
  }

  if (/^TEMP\d+$/.test(name)) {
    return '10k NTC temperature-sense node referenced to VREF2.';
  }

  if (/^ISOP[AB]$|^ISOM[AB]$/.test(name)) {
    return 'ADBMS6830 bidirectional isoSPI differential signal.';
  }

  if (/^VREG(_|$)|^VREF[12]$/.test(name)) {
    return 'ADBMS6830 local supply or reference node; verify exact datasheet load and bypass requirements.';
  }

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

function renderBoardFootprint(componentModel, x, y, rotation, netIds, padCentersByNet = null) {
  const embedded = renderEmbeddedBoardFootprint(componentModel, x, y, rotation, netIds, padCentersByNet);
  if (embedded) {
    return embedded;
  }

  const uuid = randomUUID();

  return `  (footprint "${escapeSchText(componentModel.footprint)}"
    (layer "F.Cu")
    (uuid "${uuid}")
    (at ${x} ${y} ${rotation})
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

function renderEmbeddedBoardFootprint(componentModel, x, y, rotation, netIds, padCentersByNet = null) {
  const [library, footprintName] = componentModel.footprint.split(':');
  if (!library || !footprintName) {
    return null;
  }

  const footprintPath = officialFootprintPath(library, footprintName);
  if (!footprintPath) {
    return null;
  }

  try {
    const source = readFileSync(footprintPath, 'utf8');
    return indentBoardFootprintBlock(transformBoardFootprintBlock(source, componentModel, x, y, rotation, library, footprintName, netIds, padCentersByNet));
  } catch {
    return null;
  }
}

function boardNetIdsFor(components) {
  const netNames = unique(components.flatMap((componentModel) => Object.values(componentModel.pinNets ?? {})));
  return new Map(netNames.map((name, index) => [name, index + 1]));
}

function officialFootprintPath(library, footprintName) {
  const candidates = [
    process.env.KICAD_FOOTPRINT_DIR,
    'C:/Users/windo/AppData/Local/Programs/KiCad/10.0/share/kicad/footprints',
    'C:/Program Files/KiCad/10.0/share/kicad/footprints'
  ].filter(Boolean);

  return candidates.map((dir) => `${dir}/${library}.pretty/${footprintName}.kicad_mod`).find((file) => existsSync(file)) ?? null;
}

function transformBoardFootprintBlock(source, componentModel, x, y, rotation, library, footprintName, netIds, padCentersByNet = null) {
  const lines = source.trim().split(/\r?\n/);
  const transformed = [];
  let insertedAt = false;

  for (const line of lines) {
    let nextLine = line
      .replace(`(footprint "${footprintName}"`, `(footprint "${escapeSchText(boardFootprintIdentifier(library, footprintName))}"`)
      .replace(/\(property "Reference" "[^"]+"/, `(property "Reference" "${escapeSchText(componentModel.ref)}"`)
      .replace(/\(property "Value" "[^"]+"/, `(property "Value" "${escapeSchText(componentModel.value)}"`)
      .replace(/\(uuid "[^"]+"\)/g, () => `(uuid "${randomUUID()}")`);

    transformed.push(nextLine);

    if (!insertedAt && /^\s*\(layer "F\.Cu"\)/.test(nextLine)) {
      transformed.push(`\t(at ${x} ${y} ${rotation})`);
      insertedAt = true;
    }
  }

  if (!insertedAt) {
    transformed.splice(1, 0, `\t(at ${x} ${y} ${rotation})`);
  }

  return injectBoardPadNets(transformed.join('\n'), componentModel, netIds, { ref: componentModel.ref, x, y, rotation }, padCentersByNet);
}

function boardFootprintIdentifier(library, footprintName) {
  if (library === 'RF_Module') {
    return footprintName;
  }

  return `${library}:${footprintName}`;
}

function injectBoardPadNets(block, componentModel, netIds, footprintPosition = { x: 0, y: 0 }, padCentersByNet = null) {
  return block.replace(/(\n[ \t]*\(pad "([^"]*)"[\s\S]*?)(\n[ \t]*\))/g, (match, prefix, pinNumber, closing) => {
    const netName = componentModel.pinNets?.[pinNumber];
    const netId = netIds.get(netName);
    recordBoardPadCenter(padCentersByNet, netName, prefix, footprintPosition);
    if (!netName || !netId) {
      return match;
    }

    if (/\n[ \t]*\(net \d+ "/.test(prefix)) {
      return match;
    }

    return `${prefix}\n\t\t(net ${netId} "${escapeSchText(netName)}")${closing}`;
  });
}

function recordBoardPadCenter(padCentersByNet, netName, padBlock, footprintPosition) {
  if (!padCentersByNet) {
    return;
  }

  const geometry = boardPadGeometry(padBlock, footprintPosition);
  if (!geometry) {
    return;
  }
  const centers = padCentersByNet.get(netName) ?? [];
  centers.push({
    ...geometry
  });
  padCentersByNet.set(netName, centers);
}

function renderBoardSegments(padCentersByNet, netIds, profileMode) {
  const segments = [];
  const segmentKeys = new Set();
  const acceptedSegments = [];
  const allCenters = [...padCentersByNet.entries()].flatMap(([netName, centers]) => centers.map((center) => ({ ...center, netName })));

  if (profileMode) {
    renderProfilePowerSegments(segments, segmentKeys, acceptedSegments, padCentersByNet, netIds, allCenters);
  }

  for (const [netName, centers] of padCentersByNet.entries()) {
    const netId = netIds.get(netName);
    const uniqueCenters = uniqueBoardPadCenters(centers);
    if (!netId || uniqueCenters.length < 2) {
      continue;
    }

    for (const localCenters of boardPadCenterGroupsByRef(uniqueCenters)) {
      const sorted = localCenters.toSorted((a, b) => a.x - b.x || a.y - b.y);
      for (let index = 1; index < sorted.length; index += 1) {
        const start = sorted[index - 1];
        const end = sorted[index];
        if (
          sameBoardPoint(start, end) ||
          boardPointDistance(start, end) > BOARD_LOCAL_TRACE_MAX_MM ||
          segmentRunsNearOtherNetPad(start, end, netName, allCenters)
        ) {
          continue;
        }

        addBoardSegment(segments, segmentKeys, acceptedSegments, start, end, netName, netId, allCenters);
      }
    }

    addCrossFootprintBoardSegments(segments, segmentKeys, acceptedSegments, uniqueCenters, netName, netId, allCenters);
  }

  return segments.join('\n');
}

function renderProfilePowerSegments(segments, segmentKeys, acceptedSegments, padCentersByNet, netIds, allCenters) {
  renderProfileNamedPathSegments(segments, segmentKeys, acceptedSegments, padCentersByNet, netIds, allCenters, PROFILE_POWER_PATHS);
  renderProfileNamedPathSegments(segments, segmentKeys, acceptedSegments, padCentersByNet, netIds, allCenters, PROFILE_SIGNAL_PATHS);
}

function renderProfileNamedPathSegments(segments, segmentKeys, acceptedSegments, padCentersByNet, netIds, allCenters, paths) {
  for (const [netName, references, options = {}] of paths) {
    const netId = netIds.get(netName);
    if (!netId) {
      continue;
    }

    for (let index = 1; index < references.length; index += 1) {
      const startCenters = (padCentersByNet.get(netName) ?? []).filter((center) => center.ref === references[index - 1]);
      const endCenters = (padCentersByNet.get(netName) ?? []).filter((center) => center.ref === references[index]);
      addBestSafeRoute(segments, segmentKeys, acceptedSegments, startCenters, endCenters, netName, netId, allCenters, options);
    }
  }
}

function addBestSafeRoute(segments, segmentKeys, acceptedSegments, startCenters, endCenters, netName, netId, allCenters, options = {}) {
  let best = null;

  for (const start of startCenters) {
    for (const end of endCenters) {
      for (const path of candidateRoutePolylines(start, end, options)) {
        const legs = polylineLegs(path);
        if (
          !legsEverySegmentSafe(legs, segmentKeys, acceptedSegments, netName, netId, allCenters, {
            keepOutMm: BOARD_CROSS_FOOTPRINT_TRACE_PAD_KEEP_OUT_MM,
            relaxSameFootprint: options.relaxSameFootprint === true
          })
        ) {
          continue;
        }

        const length = legs.reduce((sum, [first, second]) => sum + boardPointDistance(first, second), 0);
        if (!best || length < best.length) {
          best = { legs, length, from: start, to: end };
        }
      }
    }
  }

  if (!best) {
    return null;
  }

  for (const [start, end] of best.legs) {
    addBoardSegment(segments, segmentKeys, acceptedSegments, start, end, netName, netId, allCenters, {
      keepOutMm: BOARD_CROSS_FOOTPRINT_TRACE_PAD_KEEP_OUT_MM,
      relaxSameFootprint: options.relaxSameFootprint === true
    });
  }

  return best;
}

function candidateRoutePolylines(start, end, options = {}) {
  if (Array.isArray(options.anchors)) {
    return [[start, ...options.anchors, end]].filter((path) => path.every(isInsideBoardOutline));
  }

  const paths = options.route === 'usb-c-escape' ? [] : [
    [start, end],
    [start, { x: end.x, y: start.y }, end],
    [start, { x: start.x, y: end.y }, end]
  ];

  for (const offset of BOARD_ROUTE_ESCAPE_OFFSETS_MM) {
    for (const sign of [-1, 1]) {
      const dy = offset * sign;
      const dx = offset * sign;
      paths.push([start, { x: start.x, y: start.y + dy }, { x: end.x, y: end.y + dy }, end]);
      paths.push([start, { x: start.x + dx, y: start.y }, { x: end.x + dx, y: end.y }, end]);
    }

    const busY = Math.min(start.y, end.y) - offset;
    const busYHigh = Math.max(start.y, end.y) + offset;
    const busX = Math.min(start.x, end.x) - offset;
    const busXHigh = Math.max(start.x, end.x) + offset;
    paths.push([start, { x: start.x, y: busY }, { x: end.x, y: busY }, end]);
    paths.push([start, { x: start.x, y: busYHigh }, { x: end.x, y: busYHigh }, end]);
    paths.push([start, { x: busX, y: start.y }, { x: busX, y: end.y }, end]);
    paths.push([start, { x: busXHigh, y: start.y }, { x: busXHigh, y: end.y }, end]);
  }

  return paths.filter((path) => path.every(isInsideBoardOutline));
}

function polylineLegs(path) {
  const legs = [];
  for (let index = 1; index < path.length; index += 1) {
    const start = path[index - 1];
    const end = path[index];
    if (sameBoardPoint(start, end)) {
      continue;
    }

    if (boardPointDistance(start, end) > BOARD_CROSS_FOOTPRINT_TRACE_MAX_MM) {
      return null;
    }

    legs.push([start, end]);
  }

  return legs.length > 0 ? legs : null;
}

function legsEverySegmentSafe(legs, segmentKeys, acceptedSegments, netName, netId, allCenters, options) {
  if (!legs) {
    return false;
  }

  const pendingKeys = new Set(segmentKeys);
  const pendingAccepted = [...acceptedSegments];
  for (const [start, end] of legs) {
    if (!canAddBoardSegment(pendingKeys, pendingAccepted, start, end, netName, netId, allCenters, options)) {
      return false;
    }

    pendingKeys.add(boardSegmentKey(start, end, netId));
    pendingAccepted.push({ start, end, netName });
  }

  return true;
}

function isInsideBoardOutline(point) {
  return point.x >= BOARD_OUTLINE.minX && point.x <= BOARD_OUTLINE.maxX && point.y >= BOARD_OUTLINE.minY && point.y <= BOARD_OUTLINE.maxY;
}

function addCrossFootprintBoardSegments(segments, segmentKeys, acceptedSegments, centers, netName, netId, allCenters) {
  const connected = [centers[0]];
  const remaining = centers.slice(1);

  while (remaining.length > 0) {
    const best = nearestSafeBoardSegment(connected, remaining, netName, allCenters);
    if (!best) {
      return;
    }

    const start = connected[best.connectedIndex];
    const end = remaining.splice(best.remainingIndex, 1)[0];
    connected.push(end);
    addBoardSegment(segments, segmentKeys, acceptedSegments, start, end, netName, netId, allCenters);
  }
}

function nearestSafeBoardSegment(connected, remaining, netName, allCenters) {
  let best = null;

  for (let connectedIndex = 0; connectedIndex < connected.length; connectedIndex += 1) {
    for (let remainingIndex = 0; remainingIndex < remaining.length; remainingIndex += 1) {
      const start = connected[connectedIndex];
      const end = remaining[remainingIndex];
      const distance = boardPointDistance(start, end);
      if (
        sameBoardPoint(start, end) ||
        distance > BOARD_CROSS_FOOTPRINT_TRACE_MAX_MM ||
        segmentRunsNearOtherNetPad(start, end, netName, allCenters, { keepOutMm: BOARD_CROSS_FOOTPRINT_TRACE_PAD_KEEP_OUT_MM })
      ) {
        continue;
      }

      if (!best || distance < best.distance) {
        best = { connectedIndex, remainingIndex, distance };
      }
    }
  }

  return best;
}

function uniqueBoardPadCenters(centers) {
  const seen = new Set();
  return centers.filter((center) => {
    const key = `${center.ref ?? ''}:${sch(center.x)}:${sch(center.y)}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function boardPadCenterGroupsByRef(centers) {
  const groups = new Map();
  for (const center of centers) {
    const key = center.ref ?? '';
    const group = groups.get(key) ?? [];
    group.push(center);
    groups.set(key, group);
  }

  return [...groups.values()].filter((group) => group.length >= 2);
}

function sameBoardPoint(a, b) {
  return sch(a.x) === sch(b.x) && sch(a.y) === sch(b.y);
}

function boardPointDistance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function segmentRunsNearOtherNetPad(start, end, netName, allCenters, options = {}) {
  const keepOutMm = options.keepOutMm ?? BOARD_TRACE_PAD_KEEP_OUT_MM;
  return allCenters.some((center) => {
    if (center.netName === netName) {
      return false;
    }

    const keepOut =
      options.relaxSameFootprint && center.ref && (center.ref === start.ref || center.ref === end.ref)
        ? BOARD_SAME_FOOTPRINT_PAD_KEEP_OUT_MM
        : keepOutMm;
    return distanceFromPointToSegment(center, start, end) < keepOut;
  });
}

function distanceFromPointToSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    return boardPointDistance(point, start);
  }

  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  const projection = {
    x: start.x + t * dx,
    y: start.y + t * dy
  };
  return boardPointDistance(point, projection);
}

function canAddBoardSegment(segmentKeys, acceptedSegments, start, end, netName, netId, allCenters, options = {}) {
  const key = boardSegmentKey(start, end, netId);
  if (segmentKeys.has(key)) {
    return true;
  }

  if (
    sameBoardPoint(start, end) ||
    boardPointDistance(start, end) > BOARD_CROSS_FOOTPRINT_TRACE_MAX_MM ||
    segmentRunsNearOtherNetPad(start, end, netName, allCenters, options) ||
    acceptedSegments.some((segment) => segment.netName !== netName && boardSegmentsIntersect(start, end, segment.start, segment.end))
  ) {
    return false;
  }

  return true;
}

function addBoardSegment(segments, segmentKeys, acceptedSegments, start, end, netName, netId, allCenters, options = {}) {
  const key = boardSegmentKey(start, end, netId);
  if (segmentKeys.has(key) || !canAddBoardSegment(segmentKeys, acceptedSegments, start, end, netName, netId, allCenters, options)) {
    return;
  }

  segmentKeys.add(key);
  acceptedSegments.push({ start, end, netName });
  segments.push(renderBoardSegment(start, end, netId));
}

function boardSegmentsIntersect(firstStart, firstEnd, secondStart, secondEnd) {
  const orientation = (start, end, point) => (end.x - start.x) * (point.y - start.y) - (end.y - start.y) * (point.x - start.x);
  const firstStartOrientation = orientation(firstStart, firstEnd, secondStart);
  const firstEndOrientation = orientation(firstStart, firstEnd, secondEnd);
  const secondStartOrientation = orientation(secondStart, secondEnd, firstStart);
  const secondEndOrientation = orientation(secondStart, secondEnd, firstEnd);
  const epsilon = 1e-9;
  const isBetween = (value, start, end) => value >= Math.min(start, end) - epsilon && value <= Math.max(start, end) + epsilon;
  const isOnSegment = (start, end, point) =>
    Math.abs(orientation(start, end, point)) <= epsilon && isBetween(point.x, start.x, end.x) && isBetween(point.y, start.y, end.y);

  return (
    (firstStartOrientation > epsilon && firstEndOrientation < -epsilon || firstStartOrientation < -epsilon && firstEndOrientation > epsilon) &&
      (secondStartOrientation > epsilon && secondEndOrientation < -epsilon || secondStartOrientation < -epsilon && secondEndOrientation > epsilon) ||
    isOnSegment(firstStart, firstEnd, secondStart) ||
    isOnSegment(firstStart, firstEnd, secondEnd) ||
    isOnSegment(secondStart, secondEnd, firstStart) ||
    isOnSegment(secondStart, secondEnd, firstEnd)
  );
}

function boardSegmentKey(start, end, netId) {
  const points = [`${sch(start.x)}:${sch(start.y)}`, `${sch(end.x)}:${sch(end.y)}`].sort();
  return `${netId}:${points[0]}:${points[1]}`;
}

function renderBoardSegment(start, end, netId) {
  return `  (segment
    (start ${sch(start.x)} ${sch(start.y)})
    (end ${sch(end.x)} ${sch(end.y)})
    (width 0.15)
    (layer "F.Cu")
    (net ${netId})
    (uuid "${randomUUID()}")
  )`;
}

function indentBoardFootprintBlock(block) {
  return block
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
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
    ['ChatPCB:ADBMS6830', 'U', 'ADBMS6830'],
    ['ChatPCB:BMS_CELL_CONNECTOR', 'J', '16S_CELL_TAPS'],
    ['ChatPCB:BMS_NPN', 'Q', 'NPN_PASS'],
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
    case 'ChatPCB:ADBMS6830':
      return adbms6830PinConnections().map((pin) => pin.name);
    case 'ChatPCB:BMS_CELL_CONNECTOR':
      return Array.from({ length: 17 }, (_value, index) => `PACK_B${index}`);
    case 'ChatPCB:BMS_NPN':
      return ['B', 'C', 'E'];
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
