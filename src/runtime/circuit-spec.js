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
const DISCRETE_LED_BOARD_WORDS = /\b(?:button|reset|boot|regulator|connector|header|i2c|spi|uart|gpio|display|lcd|battery|switch|buzzer|motor|relay)\b|버튼|리셋|커넥터|헤더|레귤레이터|디스플레이/i;
const DISCRETE_PROFILE_KINDS = new Set(['battery-monitor', 'isolated-dcdc', 'bms']);
const MAX_DISCRETE_LEDS = 8;
const TYPICAL_LED_CURRENT_MA = 10;
const E24_MANTISSA = [1, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2, 2.2, 2.4, 2.7, 3, 3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1];
const ENGLISH_LED_COUNTS = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12
};
const KOREAN_LED_COUNTS = [
  ['하나', 1],
  ['한', 1],
  ['둘', 2],
  ['두', 2],
  ['셋', 3],
  ['세', 3],
  ['넷', 4],
  ['네', 4],
  ['다섯', 5],
  ['여섯', 6],
  ['일곱', 7],
  ['여덟', 8],
  ['아홉', 9],
  ['열', 10]
];
const LED_COLOR_SPECS = [
  { id: 'red', label: 'Red', prose: 'red', vf: 2, patterns: [/빨간/, /빨강/, /적색/, /붉은/, /\bred\b/i] },
  { id: 'yellow', label: 'Yellow', prose: 'yellow', vf: 2.1, patterns: [/노란/, /노랑/, /황색/, /옐로/, /\byellow\b/i] },
  { id: 'green', label: 'Green', prose: 'green', vf: 2.2, patterns: [/초록/, /녹색/, /그린/, /\bgreen\b/i] },
  { id: 'blue', label: 'Blue', prose: 'blue', vf: 3, patterns: [/파란/, /파랑/, /청색/, /블루/, /\bblue\b/i] },
  { id: 'white', label: 'White', prose: 'white', vf: 3.2, patterns: [/하얀/, /흰/, /백색/, /화이트/, /\bwhite\b/i] }
];

function isSimpleDiscreteLedPrompt(prompt) {
  const hasLed = /\bleds?\b|엘이디|발광|네오\s*픽셀|neopixel|ws2812|ws2811|sk6812|apa102|\brgb\b/i.test(prompt);
  return hasLed && !DISCRETE_LED_EXCLUDE.test(prompt) && !DISCRETE_LED_BOARD_WORDS.test(prompt);
}

function parseExplicitResistanceOhms(prompt) {
  const kiloWithUnit = prompt.match(/(\d+(?:\.\d+)?)\s*k\s*(?:옴|ohms?|Ω)/i);
  if (kiloWithUnit) return Number(kiloWithUnit[1]) * 1000;
  const kiloBare = prompt.match(/(\d+(?:\.\d+)?)\s*k(?:\s*r\b)?/i);
  if (kiloBare && /저항|resistor/i.test(prompt)) return Number(kiloBare[1]) * 1000;
  const plain = prompt.match(/(\d+(?:\.\d+)?)\s*(?:옴|ohms?|Ω)/i)
    ?? prompt.match(/(\d+(?:\.\d+)?)\s*r\b/i);
  if (plain) return Number(plain[1]);
  return null;
}

function parseSupplyVolts(prompt) {
  const matches = [];
  for (const match of prompt.matchAll(/(\d+)\s*v\s*(\d+)/gi)) {
    matches.push({ index: match.index, volts: Number(`${match[1]}.${match[2]}`) });
  }
  for (const match of prompt.matchAll(/(\d+(?:\.\d+)?)\s*(?:v\b|볼트)/gi)) {
    matches.push({ index: match.index, volts: Number(match[1]) });
  }
  matches.sort((left, right) => left.index - right.index);
  const first = matches.find((item) => Number.isFinite(item.volts) && item.volts > 0);
  return first ? first.volts : null;
}

function supplyNetName(volts) {
  if (Math.abs(volts - 3.3) < 0.05) return '+3V3';
  if (Number.isInteger(volts)) return `+${volts}V`;
  const [whole, fraction = ''] = String(volts).split('.');
  return `+${whole}V${fraction}`;
}

function formatOhms(ohms) {
  if (!Number.isFinite(ohms) || ohms <= 0) return null;
  const rounded = Math.round(ohms);
  if (rounded >= 1000) {
    const kilo = rounded / 1000;
    const text = Number.isInteger(kilo) ? String(kilo) : String(Math.round(kilo * 10) / 10);
    return `${text}kΩ`;
  }
  return `${rounded}Ω`;
}

function formatVolts(volts) {
  const rounded = Math.round(Number(volts) * 1000) / 1000;
  return String(rounded);
}

function parseLedCount(prompt) {
  const afterLed = prompt.match(/(?:leds?|엘이디|발광(?:\s*다이오드)?)\D{0,16}?(\d+)\s*개/i);
  if (afterLed) return Number(afterLed[1]);
  const beforeLed = prompt.match(/(\d+)\s*개(?:의)?\s*(?:leds?|엘이디|발광)/i);
  if (beforeLed) return Number(beforeLed[1]);
  const englishDigit = prompt.match(/\b(\d+)\s*(?:x\s*)?leds?\b/i);
  if (englishDigit) return Number(englishDigit[1]);
  const englishWord = prompt.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b(?:\s+\w+){0,3}\s+leds?\b/i);
  if (englishWord) return ENGLISH_LED_COUNTS[englishWord[1].toLowerCase()];
  const words = [...KOREAN_LED_COUNTS].sort((left, right) => right[0].length - left[0].length);
  for (const [word, count] of words) {
    const after = new RegExp(`(?:leds?|엘이디|발광)[^\\d]{0,12}${word}\\s*개`, 'i');
    if (after.test(prompt)) return count;
    const before = new RegExp(`${word}\\s*개(?:의)?\\s*(?:leds?|엘이디|발광)`, 'i');
    if (before.test(prompt)) return count;
  }
  return 1;
}

function findLedColors(prompt) {
  const found = [];
  for (const color of LED_COLOR_SPECS) {
    let index = -1;
    for (const pattern of color.patterns) {
      const match = prompt.match(pattern);
      if (match && (index < 0 || match.index < index)) index = match.index;
    }
    if (index >= 0) found.push({ ...color, index });
  }
  found.sort((left, right) => left.index - right.index);
  return found.map(({ index, patterns, ...color }) => color);
}

function unsupportedLedFeatures(prompt) {
  const items = [];
  if (/\brgb\b|풀\s*컬러|풀컬러|네오\s*픽셀|neopixel|addressable|어드레서블|ws2812|ws2811|sk6812|apa102|삼색|3\s*색|다색|led\s*matrix|매트릭스|charlieplex/i.test(prompt)) {
    items.push({
      id: 'rgb',
      message: 'Unsupported: RGB, addressable, and matrix LEDs are not supported by the discrete LED generator. A simple indicator LED was drafted instead.'
    });
  }
  if (/\bpwm\b|펄스\s*폭|밝기\s*조절|밝기조절|디밍|\bdimm|\bfade\b|페이딩/i.test(prompt)) {
    items.push({
      id: 'pwm',
      message: 'Unsupported: PWM, dimming, and brightness control are not supported by the discrete LED generator. The draft is a static series LED.'
    });
  }
  return items;
}

function roundUpE24(ohms) {
  if (!(ohms > 0)) return null;
  const exponent = Math.floor(Math.log10(ohms));
  const decade = 10 ** exponent;
  const mantissa = ohms / decade;
  let pick = E24_MANTISSA.find((value) => value + 1e-9 >= mantissa);
  let exp = exponent;
  if (!pick) {
    pick = E24_MANTISSA[0];
    exp += 1;
  }
  return Math.round(pick * (10 ** exp));
}

function resistorFromSupply({ supplyVolts, vf, colorLabel, assumed }) {
  const rawOhms = (Math.round(supplyVolts * 1000) - Math.round(vf * 1000)) / TYPICAL_LED_CURRENT_MA;
  if (!(rawOhms > 0)) {
    return {
      vf,
      resistanceOhms: 1000,
      resistorValue: '1kΩ',
      incompatible: true,
      summary: `Unsupported: supply ${formatVolts(supplyVolts)}V is not above the typical ${colorLabel} LED Vf of ${formatVolts(vf)}V, so a series current cannot be calculated. A 1kΩ placeholder resistor was used.`
    };
  }
  const resistanceOhms = roundUpE24(rawOhms);
  const resistorValue = formatOhms(resistanceOhms);
  const formula = `(${formatVolts(supplyVolts)}V - ${formatVolts(vf)}V) / ${TYPICAL_LED_CURRENT_MA}mA = ${formatOhms(rawOhms)}`;
  const rounding = formatOhms(rawOhms) === resistorValue
    ? ''
    : `, rounded up to the next E24 value ${resistorValue}`;
  const prefix = assumed
    ? `No LED color was given, so the draft assumes a typical red LED Vf of ${formatVolts(vf)}V. `
    : '';
  return {
    vf,
    resistanceOhms,
    resistorValue,
    incompatible: false,
    summary: `${prefix}Series resistor ${resistorValue} was calculated as ${formula}${rounding} for a ${colorLabel} LED (typical Vf ${formatVolts(vf)}V).`
  };
}

function buildDiscreteReviewNotes({ color, ledValue, resistorExplicit, resistorValue, quantityCapped, requestedCount, count, calculation, unsupported }) {
  const notes = [];
  if (calculation?.incompatible) {
    notes.push({ code: 'discrete-led-unsupported-vf', message: calculation.summary });
  } else if (resistorExplicit) {
    const colorText = color ? ` for ${ledValue}` : '';
    notes.push({
      code: 'discrete-led',
      message: `Discrete LED draft keeps the requested series resistor ${resistorValue}${colorText}; confirm it for the LED forward voltage and current before release.`
    });
  } else {
    notes.push({ code: 'discrete-led', message: calculation.summary });
  }
  if (quantityCapped) {
    notes.push({
      code: 'discrete-led-quantity-capped',
      message: `Requested ${requestedCount} LEDs; the discrete LED generator is capped at ${count}. Extra LEDs were not generated.`
    });
  }
  for (const item of unsupported) {
    notes.push({ code: `discrete-led-unsupported-${item.id}`, message: item.message });
  }
  return notes;
}

export function parseDiscreteLedRequest(prompt) {
  const text = String(prompt ?? '');
  if (!isSimpleDiscreteLedPrompt(text)) return null;
  const supplyVolts = parseSupplyVolts(text) ?? 5;
  if (!Number.isFinite(supplyVolts) || supplyVolts <= 0) return null;
  const colors = findLedColors(text);
  const color = colors[0] ?? null;
  const assumedColor = !color;
  const vfColor = color ?? LED_COLOR_SPECS[0];
  const explicitOhms = parseExplicitResistanceOhms(text);
  const resistorExplicit = Number.isFinite(explicitOhms) && explicitOhms > 0;
  const calculation = resistorExplicit
    ? null
    : resistorFromSupply({
      supplyVolts,
      vf: vfColor.vf,
      colorLabel: vfColor.prose,
      assumed: assumedColor
    });
  const resistanceOhms = resistorExplicit ? explicitOhms : calculation.resistanceOhms;
  const resistorValue = formatOhms(resistanceOhms);
  if (!resistorValue) return null;
  const requestedCount = Math.max(1, parseLedCount(text));
  const count = Math.min(MAX_DISCRETE_LEDS, requestedCount);
  const unsupported = unsupportedLedFeatures(text);
  if (colors.length > 1) {
    const names = colors.map((item) => item.prose).join(', ');
    unsupported.push({
      id: 'mixed-color',
      message: `Unsupported: multiple LED colors (${names}) in one draft are not supported. The draft uses ${colors[0].prose} for every LED.`
    });
  }
  const ledValue = color ? `LED ${color.label}` : 'LED';
  const parsed = {
    count,
    requestedCount,
    quantityCapped: requestedCount > count,
    color: color ? { id: color.id, label: color.label, vf: color.vf } : null,
    assumedColor,
    ledValue,
    resistanceOhms,
    resistorValue,
    resistorExplicit,
    supplyVolts,
    supplyNet: supplyNetName(supplyVolts),
    calculation,
    unsupported
  };
  return {
    ...parsed,
    reviewNotes: buildDiscreteReviewNotes(parsed)
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
    interfaces: [],
    peripherals: Array.from({ length: parsed.count }, () => ({
      kind: 'status-led',
      color: parsed.color?.id ?? null,
      currentLimit: parsed.resistorValue
    })),
    power: {
      input: 'external',
      rails: [{ name: parsed.supplyNet, voltage: parsed.supplyVolts, source: 'input' }]
    },
    discrete: parsed
  };
}
