const FAMILY_PATTERNS = [
  ['STM32', /\bstm32\b/i],
  ['RP2040', /\brp2040\b|\braspberry\s*pi\s*pico\b/i],
  ['ESP32-S3', /\besp32[\s-]?s3\b/i],
  ['ESP32', /\besp32\b/i],
  ['ATmega', /\batmega|arduino\s*nano|arduino\s*uno/i]
];

const INTERFACE_PATTERNS = [
  ['i2c', /\bi2c\b|\biic\b/i],
  ['spi', /\bspi\b/i],
  ['uart', /\buart\b|serial|debug\s*header/i],
  ['usb', /\busb\b|usb-c|type-c/i],
  ['gpio', /\bgpio\b/i]
];

export function normalizeCircuitSpec(prompt, options = {}) {
  if (typeof prompt !== 'string' || prompt.trim().length === 0) {
    throw new Error('Circuit prompt is required.');
  }

  const normalized = prompt.trim();
  const family = detectFirst(FAMILY_PATTERNS, normalized) ?? options.defaultMcuFamily ?? 'Generic MCU';
  const interfaces = detectInterfaces(normalized);
  const peripherals = detectPeripherals(normalized);
  const rails = detectRails(normalized);

  return {
    kind: 'mcu-peripheral',
    title: options.title ?? titleFromPrompt(normalized),
    sourcePrompt: normalized,
    mcu: {
      family,
      package: options.package ?? 'unspecified',
      role: 'main-controller'
    },
    power: {
      input: /usb-c|type-c/i.test(normalized) ? 'USB-C' : 'external',
      rails
    },
    interfaces,
    peripherals,
    simulationGoals: simulationGoalsFor(rails, peripherals)
  };
}

function detectFirst(patterns, value) {
  const match = patterns.find(([, pattern]) => pattern.test(value));
  return match?.[0];
}

function detectInterfaces(prompt) {
  const interfaces = INTERFACE_PATTERNS.filter(([, pattern]) => pattern.test(prompt)).map(([kind]) => ({
    kind,
    pins: defaultPinsFor(kind)
  }));

  return interfaces.length > 0 ? interfaces : [{ kind: 'gpio', pins: ['GPIO0', 'GPIO1'] }];
}

function detectPeripherals(prompt) {
  const peripherals = [];

  if (/reset|rst/i.test(prompt)) {
    peripherals.push({ kind: 'reset-button', debounce: 'rc-optional' });
  }

  if (/boot|bootsel/i.test(prompt)) {
    peripherals.push({ kind: 'boot-button', debounce: 'rc-optional' });
  }

  if (/led|status/i.test(prompt)) {
    peripherals.push({ kind: 'status-led', currentLimit: '1k' });
  }

  if (/sensor|connector|header/i.test(prompt)) {
    peripherals.push({ kind: 'sensor-connector', pitch: '2.54mm' });
  }

  return peripherals.length > 0 ? peripherals : [{ kind: 'expansion-header', pitch: '2.54mm' }];
}

function detectRails(prompt) {
  const rails = [{ name: 'VBUS', voltage: 5, source: 'input' }];

  if (/3\.3|3v3|\+3v3|mcu|sensor|stm32|rp2040|esp32/i.test(prompt)) {
    rails.push({ name: '+3V3', voltage: 3.3, source: 'regulator' });
  }

  if (/1\.8|1v8|\+1v8/i.test(prompt)) {
    rails.push({ name: '+1V8', voltage: 1.8, source: 'regulator' });
  }

  return rails;
}

function simulationGoalsFor(rails, peripherals) {
  const goals = [];

  if (rails.some((rail) => rail.name === '+3V3')) {
    goals.push('3v3-rail-operating-point');
  }

  if (peripherals.some((peripheral) => peripheral.kind === 'status-led')) {
    goals.push('status-led-current-limit');
  }

  if (peripherals.some((peripheral) => peripheral.kind.includes('button'))) {
    goals.push('button-rc-transition');
  }

  return goals.length > 0 ? goals : ['power-rail-operating-point'];
}

function defaultPinsFor(kind) {
  switch (kind) {
    case 'i2c':
      return ['SCL', 'SDA', '+3V3', 'GND'];
    case 'spi':
      return ['SCK', 'MOSI', 'MISO', 'CS', '+3V3', 'GND'];
    case 'uart':
      return ['TX', 'RX', '+3V3', 'GND'];
    case 'usb':
      return ['VBUS', 'USB_DP', 'USB_DN', 'GND', 'CC1', 'CC2'];
    default:
      return ['GPIO', '+3V3', 'GND'];
  }
}

function titleFromPrompt(prompt) {
  return prompt
    .replace(/\s+/g, ' ')
    .slice(0, 72)
    .replace(/[.。]+$/, '');
}

const DISCRETE_LED_EXCLUDE = /\besp32\b|\bstm32\b|\brp2040\b|\bnrf52\b|\batmega\b|\barduino\b|\bmcu\b|마이크로\s*컨트롤러|\bbms\b|adbms|ltc681|센서|sensor|\busb-?c\b|\busb\b/i;
const DISCRETE_PROFILE_KINDS = new Set(['battery-monitor', 'isolated-dcdc', 'bms']);

function isSimpleDiscreteLedPrompt(prompt) {
  const hasLed = /\bled\b|엘이디|발광/i.test(prompt);
  const hasResistor = /저항|resistor|\d+(?:\.\d+)?\s*(?:k\s*)?(?:옴|ohms?|Ω|r\b)/i.test(prompt);
  return hasLed && hasResistor && !DISCRETE_LED_EXCLUDE.test(prompt);
}

function parseResistanceOhms(prompt) {
  const kilo = prompt.match(/(\d+(?:\.\d+)?)\s*k(?:\s*(?:옴|ohms?|Ω|r\b))?/i);
  if (kilo && /저항|resistor|옴|ohm|Ω|\d+(?:\.\d+)?\s*k/i.test(prompt)) {
    return Number(kilo[1]) * 1000;
  }
  const plain = prompt.match(/(\d+(?:\.\d+)?)\s*(?:옴|ohms?|Ω)/i)
    ?? prompt.match(/(\d+(?:\.\d+)?)\s*r\b/i);
  if (plain) return Number(plain[1]);
  if (/저항|resistor/i.test(prompt)) return 330;
  return null;
}

function parseSupplyVolts(prompt) {
  const match = prompt.match(/(\d+(?:\.\d+)?)\s*v\b/i);
  return match ? Number(match[1]) : null;
}

function supplyNetName(volts) {
  if (Math.abs(volts - 3.3) < 0.05) return '+3V3';
  if (Number.isInteger(volts)) return `+${volts}V`;
  const [whole, fraction] = String(volts).split('.');
  return `+${whole}V${fraction}`;
}

function formatOhms(ohms) {
  if (!Number.isFinite(ohms) || ohms <= 0) return null;
  if (ohms >= 1000) {
    const kilo = ohms / 1000;
    const text = Number.isInteger(kilo) ? String(kilo) : String(Math.round(kilo * 10) / 10);
    return `${text}kΩ`;
  }
  return `${Number.isInteger(ohms) ? ohms : ohms}Ω`;
}

export function parseDiscreteLedRequest(prompt) {
  const text = String(prompt ?? '');
  if (!isSimpleDiscreteLedPrompt(text)) return null;
  const resistanceOhms = parseResistanceOhms(text);
  if (!Number.isFinite(resistanceOhms) || resistanceOhms <= 0) return null;
  const supplyVolts = parseSupplyVolts(text) ?? 5;
  if (!Number.isFinite(supplyVolts) || supplyVolts <= 0) return null;
  const resistorValue = formatOhms(resistanceOhms);
  if (!resistorValue) return null;
  return {
    resistanceOhms,
    resistorValue,
    supplyVolts,
    supplyNet: supplyNetName(supplyVolts)
  };
}

export function applyDiscreteLedSpec(spec) {
  if (!spec || typeof spec !== 'object') return spec;
  if (spec.boardProfile?.id) return spec;
  if (DISCRETE_PROFILE_KINDS.has(spec.kind) || DISCRETE_PROFILE_KINDS.has(spec.boardProfile?.kind)) return spec;
  const parsed = parseDiscreteLedRequest(spec.sourcePrompt ?? '');
  if (!parsed) return spec;
  return {
    ...spec,
    kind: 'discrete-led',
    discrete: parsed
  };
}
