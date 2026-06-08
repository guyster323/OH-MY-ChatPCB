const SUPPORTED_PROFILES = [
  {
    id: 'esp32-s3-usbc-sensor',
    family: 'ESP32-S3',
    part: 'ESP32-S3-WROOM-1-N8R2',
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
      ]
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
      { kind: 'usb-c-cc-pulldowns', value: '5.1k' }
    ])
  };
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
