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

const BMS_CELL_COUNT = 16;
const ADBMS6830_BMS_PROFILE_ID = 'adbms6830-16s-bms-example';

const BMS_RELEASE_GATES = [
  {
    id: 'production-symbols',
    status: 'pending',
    reason: 'An exact ADBMS6830 symbol and package variant must be matched to the selected Analog Devices orderable part.'
  },
  {
    id: 'sourcing',
    status: 'pending',
    reason: 'Exact ADBMS6830, connector, resistor, capacitor, NPN, and balancing-part orderability has not been verified.'
  },
  {
    id: 'datasheet-pin-review',
    status: 'pending',
    reason: 'Cell-input, balance, VREG, reference, GPIO, and isoSPI pin mapping must be checked against the exact ADBMS6830 revision.'
  },
  {
    id: 'safety-review',
    status: 'pending',
    reason: 'Cell chemistry, pack limits, fuse/protection FETs, charger behavior, creepage, fault handling, and balancing thermal limits are not designed here.'
  },
  {
    id: 'simulation',
    status: 'pending',
    reason: 'Cell-input filtering, VREG startup, balancing current, thermistor behavior, and fault cases need simulation or calculation evidence.'
  },
  {
    id: 'layout-drc',
    status: 'pending',
    reason: 'The BMS example is schematic-only; high-voltage layout, isolation, DRC, Gerbers, and manufacturing constraints are not generated.'
  }
];

const COMMON_PRODUCTION_PARTS = [
  part('J1', 'power-input-header', 'Connector_Generic:Conn_01x02', 'POWER_INPUT', 'Connector_PinHeader_2.54mm:PinHeader_1x02_P2.54mm_Vertical'),
  part('U1', '3v3-buck-regulator', 'Regulator_Switching:TPS62177DQC', 'TPS62177DQC', 'Package_SON:WSON-10-1EP_2x3mm_P0.5mm_EP0.84x2.4mm_ThermalVias', {
    requirements: ['Fixed 3.3V output', '500mA rail budget', 'Buck topology selected to avoid linear regulator thermal loss'],
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
  part('C3', 'buck-input-capacitor', 'Device:C', '10uF', 'Capacitor_SMD:C_0603_1608Metric', { simulation: true }),
  part('L1', 'buck-inductor', 'Device:L', '2.2uH', 'Inductor_SMD:L_0805_2012Metric', { simulation: true }),
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
  const bmsProfile = applyAdbms6830Profile(spec);
  if (bmsProfile) {
    return bmsProfile;
  }

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
        '3.3V rail budget is 500mA and uses a fixed 3.3V buck regulator profile before final sourcing review.',
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

function applyAdbms6830Profile(spec) {
  const prompt = spec.sourcePrompt ?? '';
  if (!/adbms[\s-]?6830/i.test(prompt)) {
    return null;
  }

  const cellTaps = Array.from({ length: BMS_CELL_COUNT + 1 }, (_value, index) => `PACK_B${index}`);
  return {
    ...spec,
    kind: 'battery-monitor',
    mcu: {
      family: 'ADBMS6830',
      package: 'ADBMS6830',
      role: '16-channel-battery-monitor'
    },
    power: {
      input: 'battery-stack',
      rails: [
        { name: 'PACK_STACK', voltage: 67.2, source: '16S Li-ion example maximum' },
        { name: 'VREG', voltage: 5, source: 'ADBMS6830 local pass-transistor example' },
        { name: 'VREF1', voltage: 3, source: 'ADBMS6830 reference output' },
        { name: 'VREF2', voltage: 3, source: 'ADBMS6830 thermistor reference output' }
      ]
    },
    interfaces: [
      { kind: 'cell-taps', pins: cellTaps },
      { kind: 'isoSPI', pins: ['ISOPA', 'ISOMA', 'ISOPB', 'ISOMB'] },
      { kind: 'temperature', pins: ['TEMP1', 'TEMP2', 'TEMP3', 'TEMP4'] }
    ],
    peripherals: [
      { kind: 'cell-input-filters', cellCount: BMS_CELL_COUNT, resistor: '200R', capacitor: '10nF' },
      { kind: 'passive-cell-balancing', cellCount: BMS_CELL_COUNT, resistor: '1k' },
      { kind: 'ntc-temperature-sensing', channelCount: 4, nominalResistance: '10k' },
      { kind: 'vreg-pass-transistor', topology: 'DRIVE-controlled NPN with ferrite and reservoir capacitor' },
      { kind: 'isoSPI-daisy-chain', ports: 2 }
    ],
    simulationGoals: ['cell-input-filter-response', 'passive-balance-current-estimate', 'vreg-pass-network'],
    boardProfile: {
      id: ADBMS6830_BMS_PROFILE_ID,
      kind: 'bms',
      family: 'ADBMS6830',
      part: 'ADBMS6830',
      cellCount: BMS_CELL_COUNT,
      cellChemistry: 'Li-ion example assumption',
      releaseTarget: 'example-review',
      pcbDraft: false,
      pinMapStatus: 'unverified-example-only',
      assumptions: [
        'This example assumes one 16S Li-ion stack: 3.7V nominal and 4.2V full-charge per cell.',
        'The 59.2V nominal and 67.2V full-charge values are example calculations, not a validated pack specification.',
        'The example monitors cells and shows passive balancing paths; it does not implement charger, fuse, contactor, or over-current/over-voltage protection.',
        'The ADBMS6830 product page lists 72-/80-lead package options; the exact orderable package and pinout must be selected before fabrication.',
        'The 1kΩ balance resistor is a conservative example value and is not a final thermal or balancing-time decision.'
      ],
      releaseGates: BMS_RELEASE_GATES.map((gate) => ({ ...gate })),
      releaseEvidence: {
        status: 'incomplete',
        requiredChecks: ['safetyReview', 'sourcing', 'datasheet', 'simulation', 'layoutDrc'],
        calculations: bmsCalculationEvidence()
      },
      productionParts: productionPartsForBms()
    }
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

function productionPartsForBms() {
  const parts = [
    part('U1', '16-channel-battery-monitor', 'ChatPCB:ADBMS6830', 'ADBMS6830', '', {
      requirements: [
        'Measure up to 16 series cells',
        'Use the exact Analog Devices package/orderable variant',
        'Connect exposed pad and all V− pins to the pack-negative reference'
      ],
      simulation: true
    }),
    part('J1', '16s-cell-tap-header', 'Connector_Generic:Conn_01x17', '16S_CELL_TAPS', 'Connector_PinHeader_2.54mm:PinHeader_1x17_P2.54mm_Vertical', {
      requirements: ['Expose PACK_B0 through PACK_B16 in ascending cell-stack order']
    }),
    part('J2', 'isoSPI-header', 'Connector_Generic:Conn_01x06', 'ISOSPI_HOST', 'Connector_PinHeader_2.54mm:PinHeader_1x06_P2.54mm_Vertical', {
      requirements: ['Expose both bidirectional isoSPI port pairs and local reference']
    }),
    part('J4', 'temperature-header', 'Connector_Generic:Conn_01x06', 'TEMPERATURE_INPUTS', 'Connector_PinHeader_2.54mm:PinHeader_1x06_P2.54mm_Vertical', {
      requirements: ['Expose four 10k NTC channels, VREF2, and pack-negative reference']
    }),
    part('Q1', 'vreg-pass-transistor', 'ChatPCB:BMS_NPN', 'NPN_PASS', 'Package_TO_SOT_SMD:SOT-23', {
      requirements: ['Provide sufficient beta and thermal dissipation for the exact VREG load']
    }),
    part('FB1', 'vreg-ferrite-bead', 'Device:L', 'VREG_FERRITE', 'Inductor_SMD:L_0603_1608Metric')
  ];

  for (let index = 1; index <= BMS_CELL_COUNT; index += 1) {
    parts.push(
      part(`R${index}`, 'cell-input-filter-resistor', 'Device:R', '200R', 'Resistor_SMD:R_0603_1608Metric', {
        requirements: ['Place at the ADBMS6830 cell-input pin; confirm shared-pin and depopulation rules'],
        simulation: true
      }),
      part(`C${index}`, 'cell-input-differential-filter', 'Device:C', '10nF', 'Capacitor_SMD:C_0603_1608Metric', {
        requirements: ['Differential filter capacitor between adjacent filtered cell taps'],
        simulation: true
      }),
      part(`RB${index}`, 'passive-balance-resistor', 'Device:R', '1k', 'Resistor_SMD:R_1206_3216Metric', {
        requirements: ['Example cell discharge resistor; verify balancing current and thermal rise before population'],
        simulation: true
      })
    );
  }

  parts.push(
    part('R17', 'drive-pin-filter-resistor', 'Device:R', '10R', 'Resistor_SMD:R_0603_1608Metric', { simulation: true }),
    part('R18', 'vreg-collector-filter-resistor', 'Device:R', '330R', 'Resistor_SMD:R_0603_1608Metric', { simulation: true }),
    part('C17', 'drive-pin-filter-capacitor', 'Device:C', '10nF', 'Capacitor_SMD:C_0603_1608Metric', { simulation: true }),
    part('C18', 'vreg-collector-filter-capacitor', 'Device:C', '10nF', 'Capacitor_SMD:C_0603_1608Metric', { simulation: true }),
    part('C19', 'vreg-reservoir-capacitor', 'Device:C', '1uF', 'Capacitor_SMD:C_0603_1608Metric', { simulation: true }),
    part('C20', 'vref1-bypass-capacitor', 'Device:C', '1uF', 'Capacitor_SMD:C_0603_1608Metric', { simulation: true }),
    part('C21', 'vref2-bypass-capacitor', 'Device:C', '1uF', 'Capacitor_SMD:C_0603_1608Metric', { simulation: true })
  );

  for (let index = 1; index <= 4; index += 1) {
    parts.push(
      part(`R${19 + index}`, 'ntc-pullup-resistor', 'Device:R', '10k', 'Resistor_SMD:R_0603_1608Metric', { simulation: true }),
      part(`R${23 + index}`, 'ntc-thermistor', 'Device:R', 'NTC_10k', 'Resistor_SMD:R_0603_1608Metric', { simulation: true })
    );
  }

  return parts.map((item) => withReleaseChecks(item));
}

function bmsCalculationEvidence() {
  return [
    {
      id: 'pack-voltage-envelope',
      status: 'warning',
      subjectRefs: ['U1', 'J1'],
      assumptions: ['16 series Li-ion cells', '3.7V nominal per cell', '4.2V full-charge per cell'],
      equation: '16 * 3.7V = 59.2V nominal; 16 * 4.2V = 67.2V full-charge',
      result: 'Illustrative 16S pack envelope is 59.2V nominal and 67.2V at full charge.',
      releaseImpact: 'Confirm chemistry, cell count, ADBMS6830 V+ limits, connector sequencing, and pack protection before energizing.'
    },
    {
      id: 'cell-input-filter',
      status: 'warning',
      subjectRefs: ['U1'],
      assumptions: ['200R cell-input filter resistance', '10nF differential filter capacitance'],
      equation: 'fc = 1 / (2*pi*200R*10nF) = 79.6kHz',
      result: 'The example uses the 200R/10nF input-filter values described in the related ADI monitor application guidance.',
      releaseImpact: 'Verify the exact ADBMS6830 revision, shared-resistor rules, depopulated-cell behavior, and measurement error before release.'
    },
    {
      id: 'passive-balance-current',
      status: 'warning',
      subjectRefs: ['U1', 'RB1', 'RB16'],
      assumptions: ['4.2V cell', '1k example balance resistor', '4R internal switch resistance as a related monitor reference'],
      equation: '4.2V / (1000R + 4R) = 4.18mA',
      result: 'The example balance branch is intentionally low-current; it is not a final balancing-time or thermal design.',
      releaseImpact: 'Confirm the exact ADBMS6830 switch specification, resistor pulse rating, cell chemistry, and required balancing time.'
    },
    {
      id: 'vreg-pass-network',
      status: 'warning',
      subjectRefs: ['U1', 'Q1', 'R17', 'R18', 'C17', 'C18', 'C19'],
      assumptions: ['DRIVE-controlled NPN pass stage', '10R/10nF DRIVE filter', '330R/10nF collector filter', '1uF VREG reservoir'],
      equation: 'VREG and transistor dissipation require the actual stack voltage, load, beta, and thermal design',
      result: 'The example includes the documented pass-transistor topology but does not prove startup, regulation, or thermal margins.',
      releaseImpact: 'Validate the exact ADBMS6830 VREG/DRIVE requirements and NPN choice under all pack and communication conditions.'
    }
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
      id: 'regulator-topology-selection',
      status: 'pass',
      subjectRefs: ['U1', 'L1', 'C2', 'C3'],
      assumptions: ['5V USB-C input', '3.3V output', '500mA rail budget', 'linear regulator would dissipate 0.85W'],
      equation: 'Pldo = (5.0V - 3.3V) * 0.5A',
      result: 'Buck topology selected because the equivalent 0.85W LDO thermal load is too high for an unreleased compact sensor board.',
      releaseImpact: 'Improves the default circuit topology; release still needs sourced buck BOM, datasheet layout review, and PCB DRC.'
    },
    {
      id: 'buck-loss-estimate',
      status: 'warning',
      subjectRefs: ['U1', 'L1', 'C2', 'C3'],
      assumptions: ['3.3V output', '500mA rail budget', '90% provisional buck efficiency'],
      equation: '(3.3V * 0.5A) * (1 / 0.90 - 1)',
      result: '183mW estimated converter loss at the provisional 500mA rail budget.',
      releaseImpact: 'Thermal risk is reduced versus an LDO, but release still needs datasheet efficiency curves, layout, and sourced inductor/capacitor checks.'
    },
    {
      id: 'regulator-thermal-budget',
      status: 'pass',
      subjectRefs: ['U1', 'L1'],
      assumptions: ['5V USB-C input', '3.3V output', '500mA rail budget', 'TPS62177DQC fixed 3.3V buck regulator profile'],
      equation: '(5.0V - 3.3V) * 0.5A',
      result: '0.85W LDO loss avoided by the buck regulator topology.',
      releaseImpact: 'No longer a schematic-level thermal blocker; release remains gated by sourced BOM, datasheet, layout, and DRC evidence.'
    }
  ];
}

function findSupportedProfile(spec) {
  const prompt = spec.sourcePrompt ?? '';
  const explicit = /release\s+profile|supported\s+profile|release-quality|release quality/i.test(prompt);
  if (explicit) {
    return SUPPORTED_PROFILES.find((profile) => spec.mcu?.family === profile.family) ?? null;
  }

  if (/jlcpcb|orderable|manufactur/i.test(prompt)) {
    return null;
  }

  if (spec.mcu?.family === 'ESP32-S3' && looksLikeSupportedSensorBoard(prompt)) {
    return SUPPORTED_PROFILES.find((profile) => profile.id === 'esp32-s3-usbc-sensor') ?? null;
  }

  return null;
}

function looksLikeSupportedSensorBoard(prompt) {
  const hasSensor = /sensor|센서/i.test(prompt);
  const hasUsb = /usb|usb-c|type-c/i.test(prompt);
  const hasRail = /3\.3|3v3|\+3v3|전원|regulator/i.test(prompt);
  return hasSensor && (hasUsb || hasRail);
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
