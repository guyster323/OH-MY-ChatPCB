const SUPPORTED_PROFILES = [
  {
    id: 'esp32-s3-usbc-sensor',
    family: 'ESP32-S3',
    part: 'ESP32-S3-WROOM-1-N8R2',
    mcuPart: {
      ref: 'U2',
      role: 'mcu-module',
      libId: 'ChatPCB:ESP32_S3_WROOM_1',
      value: 'ESP32-S3-WROOM-1-N8R2',
      footprint: 'RF_Module:ESP32-S3-WROOM-1'
    },
    debugPartRole: 'esp32-usb-jtag-header',
    debug: {
      defaultProtocol: 'esp32-usb-jtag',
      nets: ['USB_DP', 'USB_DN', 'MTMS', 'MTCK', 'MTDI', 'MTDO'],
      swdMappingNote:
        'SWD request was mapped to ESP32-S3 USB-JTAG/JTAG nets because ESP32-S3 does not expose ARM SWD.'
    },
    profileNote: 'Using supported ESP32-S3 USB-C sensor profile with USB-JTAG/JTAG debug assumptions.'
  },
  {
    id: 'stm32-usbc-sensor',
    family: 'STM32',
    part: 'STM32G0B1CBT6',
    mcuPart: {
      ref: 'U2',
      role: 'mcu',
      libId: 'ChatPCB:STM32G0B1CBT6',
      value: 'STM32G0B1CBT6',
      footprint: 'Package_QFP:LQFP-48_7x7mm_P0.5mm'
    },
    debugPartRole: 'swd-header',
    debug: {
      defaultProtocol: 'swd',
      nets: ['SWDIO', 'SWCLK', 'NRST']
    },
    profileNote: 'Using supported STM32 USB-C sensor profile with ARM SWD debug assumptions.'
  }
];

const PROFILE_INTERFACES = [
  { kind: 'usb', pins: ['VBUS', 'USB_DP', 'USB_DN', 'GND', 'CC1', 'CC2'] },
  { kind: 'i2c', pins: ['SCL', 'SDA', '+3V3', 'GND'] },
  { kind: 'spi', pins: ['SCK', 'MOSI', 'MISO', 'CS', '+3V3', 'GND'] },
  { kind: 'uart', pins: ['TX', 'RX', '+3V3', 'GND'] },
  { kind: 'gpio', pins: ['GPIO0', 'GPIO1', 'GPIO2', '+3V3', 'GND'] }
];

const COMMON_PRODUCTION_PARTS = [
  part('J1', 'power-input-header', 'Connector_Generic:Conn_01x02', 'POWER_INPUT', 'Connector_PinHeader_2.54mm:PinHeader_1x02_P2.54mm_Vertical'),
  part('U1', '3v3-regulator', 'Regulator_Linear:TC1262-33', 'TC1262-33', 'Package_TO_SOT_SMD:SOT-223-3_TabPin2', {
    requirements: ['Fixed 3.3V output', '500mA rail budget', 'Thermal margin review before release'],
    simulation: true
  }),
  part('SW1', 'reset-button', 'Switch:SW_Push', 'RESET_BUTTON', 'Button_Switch_SMD:Panasonic_EVQPUJ_EVQPUA'),
  part('SW2', 'boot-button', 'Switch:SW_Push', 'BOOT_BUTTON', 'Button_Switch_SMD:Panasonic_EVQPUJ_EVQPUA'),
  part('D1', 'status-led', 'Device:LED', 'STATUS_LED', 'LED_SMD:LED_0603_1608Metric'),
  part('J2', 'i2c-sensor-header', 'Connector_Generic:Conn_01x04', 'I2C_CONNECTOR', 'Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical'),
  part('J3', 'uart-debug-header', 'Connector_Generic:Conn_01x04', 'UART_HEADER', 'Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical'),
  part('J4', 'usb-c-connector', 'Connector:USB_C_Receptacle_USB2.0_16P', 'USB_C_CONNECTOR', 'Connector_USB:USB_C_Receptacle_HRO_TYPE-C-31-M-12', {
    requirements: ['USB-C sink connector', 'USB 2.0 data pins', 'CC pulldown compatibility']
  }),
  part('J5', 'spi-header', 'Connector_Generic:Conn_01x06', 'SPI_HEADER', 'Connector_PinHeader_2.54mm:PinHeader_1x06_P2.54mm_Vertical'),
  part('J6', 'gpio-header', 'Connector_Generic:Conn_01x05', 'GPIO_HEADER', 'Connector_PinHeader_2.54mm:PinHeader_1x05_P2.54mm_Vertical'),
  part('C1', 'local-decoupling-capacitor', 'Device:C', '100nF', 'Capacitor_SMD:C_0603_1608Metric', { simulation: true }),
  part('C2', 'bulk-rail-capacitor', 'Device:C', '10uF', 'Capacitor_SMD:C_0603_1608Metric', { simulation: true }),
  part('R1', 'usb-c-cc1-pulldown', 'Device:R', '5.1k', 'Resistor_SMD:R_0603_1608Metric', { simulation: true }),
  part('R2', 'usb-c-cc2-pulldown', 'Device:R', '5.1k', 'Resistor_SMD:R_0603_1608Metric', { simulation: true }),
  part('R3', 'status-led-resistor', 'Device:R', '1k', 'Resistor_SMD:R_0603_1608Metric', { simulation: true }),
  part('R4', 'i2c-scl-pullup', 'Device:R', '4.7k', 'Resistor_SMD:R_0603_1608Metric', { simulation: true }),
  part('R5', 'i2c-sda-pullup', 'Device:R', '4.7k', 'Resistor_SMD:R_0603_1608Metric', { simulation: true })
];

const RELEASE_GATES = [
  {
    id: 'production-symbols',
    status: 'complete',
    reason:
      'Supported profile support components use production KiCad symbols; profile MCU symbols remain project-local only when an exact official KiCad symbol is unavailable.'
  },
  {
    id: 'sourcing',
    status: 'pending',
    reason: 'JLCPCB/LCSC orderability needs a live sourcing check for every exact component.'
  },
  {
    id: 'datasheet-pin-review',
    status: 'pending',
    reason: 'MCU, regulator, USB-C, reset, boot, and debug pins need datasheet-level review before release.'
  },
  {
    id: 'simulation',
    status: 'pending',
    reason: 'Power, LED current, reset/boot, and I2C pull-up assumptions need simulation or calculation evidence.'
  },
  {
    id: 'layout-drc',
    status: 'pending',
    reason: 'PCB layout DRC, Gerbers, drill files, and manufacturer constraints are not generated yet.'
  }
];

export function applyBoardProfile(spec) {
  const profile = findSupportedProfile(spec);
  if (!profile) {
    return spec;
  }

  const requestedProtocol = /swd/i.test(spec.sourcePrompt ?? '') ? 'swd' : profile.debug.defaultProtocol;
  const implementedProtocol =
    requestedProtocol === 'swd' && profile.debug.defaultProtocol !== 'swd' ? profile.debug.defaultProtocol : requestedProtocol;

  return {
    ...spec,
    boardProfile: {
      id: profile.id,
      family: profile.family,
      releaseTarget: 'prototype-review',
      assumptions: [
        'USB-C is wired as a 5V sink with USB 2.0 data where supported.',
        '3.3V rail budget is 500mA before final regulator thermal and sourcing review.',
        'JLCPCB orderability requires a live sourcing check before release.'
      ],
      releaseGates: RELEASE_GATES.map((gate) => ({ ...gate })),
      releaseEvidence: {
        status: 'incomplete',
        requiredChecks: ['sourcing', 'datasheet', 'simulation', 'layoutDrc'],
        calculations: calculationEvidence()
      },
      productionParts: productionPartsFor(profile)
    },
    mcu: {
      ...spec.mcu,
      package: profile.part
    },
    debug: {
      requestedProtocol,
      implementedProtocol,
      nets: profile.debug.nets,
      note: requestedProtocol === 'swd' && profile.debug.swdMappingNote ? profile.debug.swdMappingNote : profile.profileNote
    },
    interfaces: mergeInterfaces(spec.interfaces, PROFILE_INTERFACES),
    peripherals: mergePeripherals(spec.peripherals, [
      { kind: 'reset-button', debounce: 'rc-optional' },
      { kind: 'status-led', currentLimit: '1k' },
      { kind: 'sensor-connector', pitch: '2.54mm' },
      { kind: 'decoupling-network', strategy: 'bulk-plus-local-0.1uF' },
      { kind: 'usb-c-cc-pulldowns', value: '5.1k' },
      { kind: 'status-led-resistor', value: '1k' },
      { kind: 'i2c-pullups', value: '4.7k' }
    ])
  };
}

function productionPartsFor(profile) {
  return [
    withReleaseChecks(profile.mcuPart),
    ...COMMON_PRODUCTION_PARTS.map((item) => withReleaseChecks(item)),
    withReleaseChecks(
      part('J7', profile.debugPartRole, 'Connector_Generic:Conn_02x05_Odd_Even', 'DEBUG_HEADER', 'Connector_PinHeader_2.54mm:PinHeader_2x05_P2.54mm_Vertical', {
        requirements: profile.debug.nets.map((net) => `Expose ${net}`)
      })
    )
  ];
}

function part(ref, role, libId, value, footprint, { requirements = [], simulation = false } = {}) {
  return {
    ref,
    role,
    libId,
    value,
    footprint,
    requirements,
    needsSimulationEvidence: simulation
  };
}

function withReleaseChecks(item) {
  const releaseChecks = {
    sourcing: {
      status: 'pending',
      reason: 'Live JLCPCB/LCSC orderability has not been verified.'
    },
    datasheet: {
      status: 'pending',
      reason: 'Datasheet pin, rating, and footprint compatibility review has not been recorded.'
    }
  };

  if (item.needsSimulationEvidence) {
    releaseChecks.simulation = {
      status: 'pending',
      reason: 'Electrical calculation or simulation evidence has not been recorded.'
    };
  }

  const { needsSimulationEvidence, ...productionPart } = item;
  return {
    ...productionPart,
    releaseChecks
  };
}

function calculationEvidence() {
  return [
    {
      id: 'status-led-current',
      status: 'pass',
      subjectRefs: ['D1', 'R3'],
      assumptions: ['3.3V rail', '2.0V nominal LED forward voltage', '1k series resistor'],
      equation: '(3.3V - 2.0V) / 1000 ohm',
      result: '1.3mA nominal status LED current.',
      releaseImpact: 'Suitable as a low-current indicator assumption before final LED datasheet review.'
    },
    {
      id: 'usb-c-cc-pulldown-current',
      status: 'pass',
      subjectRefs: ['R1', 'R2', 'J4'],
      assumptions: ['5V VBUS', '5.1k pulldown on each USB-C CC pin'],
      equation: '5V / 5100 ohm',
      result: '0.98mA nominal current per asserted CC pulldown path.',
      releaseImpact: 'Confirms the generated CC resistor value is internally consistent with a USB-C sink intent.'
    },
    {
      id: 'i2c-pullup-rise-time',
      status: 'warning',
      subjectRefs: ['R4', 'R5', 'J2'],
      assumptions: ['4.7k pull-up', '100pF estimated bus capacitance', '0.8473 * R * C first-order rise-time estimate'],
      equation: '0.8473 * 4700 ohm * 100pF',
      result: '398ns estimated I2C rise time; acceptable for 100kHz standard-mode assumptions, but fast-mode needs bus capacitance review.',
      releaseImpact: 'Prototype review can proceed; release needs actual bus capacitance and target I2C speed.'
    },
    {
      id: 'regulator-thermal-budget',
      status: 'blocker',
      subjectRefs: ['U1'],
      assumptions: ['5V USB-C input', '3.3V output', '500mA rail budget'],
      equation: '(5.0V - 3.3V) * 0.5A',
      result: '0.85W regulator dissipation at full rail budget.',
      releaseImpact: 'Release is blocked until package thermal resistance, copper area, ambient temperature, and sourced regulator variant are reviewed.'
    }
  ];
}

function findSupportedProfile(spec) {
  const prompt = spec.sourcePrompt ?? '';
  if (!/release\s+profile|supported\s+profile|release-quality|release quality/i.test(prompt)) {
    return null;
  }

  return SUPPORTED_PROFILES.find((profile) => spec.mcu?.family === profile.family) ?? null;
}

function mergeInterfaces(existing = [], additions = []) {
  const byKind = new Map(existing.map((iface) => [iface.kind, iface]));

  for (const iface of additions) {
    byKind.set(iface.kind, iface);
  }

  return [...byKind.values()];
}

function mergePeripherals(existing = [], additions = []) {
  const byKind = new Map(existing.map((peripheral) => [peripheral.kind, peripheral]));

  for (const peripheral of additions) {
    byKind.set(peripheral.kind, peripheral);
  }

  return [...byKind.values()];
}
