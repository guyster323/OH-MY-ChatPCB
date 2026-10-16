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

const DISCRETE_LED_EXCLUDE = /\besp32\b|\bstm32\b|\brp2040\b|\bnrf52\b|\batmega\b|\barduino\b|\bmcu\b|마이크로\s*컨트롤러|\bbms\b|adbms|ltc681|센서|sensor|\busb-?c\b|\busb\b|\bbattery\s+monitor\b|\bbattery\s+management\b|배터리\s*모니터|배터리\s*관리/i;
const DISCRETE_LED_BOARD_WORDS = /\b(?:button|reset|boot|regulator|connector|header|i2c|spi|uart|gpio|display|lcd|switch|buzzer|motor|relay)\b|버튼|리셋|커넥터|헤더|레귤레이터|디스플레이/i;
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

const RESISTANCE_MULTIPLIER = { r: 1, k: 1000, m: 1_000_000 };
const POT_BEFORE = /(?:\bpots?\b|\bpotentiometers?\b|가변\s*저항)\s*$/i;
const POT_AFTER = /^[\s,.:;/-]*(?:Ω|옴|ohms?)?\s*(?:\bpots?\b|\bpotentiometers?\b|가변\s*저항)/i;
const FORWARD_VOLTAGE = /\bvf\b|\bforward\b|순방향/i;
const SUPPLY_VOLTAGE = /\bsupply\b|\bpower\b|\bbattery\b|\brail\b|전원|배터리/i;
const ON_AT_VOLTAGE = /\b(?:on|at)\s+(?:(?:a|an|the)\s+)?$/i;

function isPotentiometerResistor(prompt, start, end) {
  const before = prompt.slice(Math.max(0, start - 48), start);
  const after = prompt.slice(end, end + 48);
  return POT_BEFORE.test(before) || POT_AFTER.test(after);
}

function firstAcceptedOhms(prompt, source, flags, toOhms) {
  const regex = new RegExp(source, flags.includes('g') ? flags : `${flags}g`);
  for (const match of prompt.matchAll(regex)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (isPotentiometerResistor(prompt, start, end)) continue;
    const ohms = toOhms(match);
    if (Number.isFinite(ohms) && ohms > 0) return ohms;
  }
  return null;
}

function rkmToOhms(whole, fraction, letter) {
  const multiplier = RESISTANCE_MULTIPLIER[String(letter).toLowerCase()];
  if (!multiplier) return null;
  const scale = 10 ** fraction.length;
  return (Number(whole) * scale + Number(fraction)) * multiplier / scale;
}

function isBareNumberExcluded(after) {
  if (/^\s*(?:[kKmM]\s*)?(?:volts?|vdc|vac|v|볼트)(?:\s*\/\s*a\.?c\.?)?(?:\b|\d)/i.test(after)) return true;
  if (/^,\d{1,2}\s*(?:[kKmM]\s*)?(?:volts?|vdc|vac|v|볼트)/i.test(after)) return true;
  if (/^\s*(?:m\s*a|ma|milli\s*amps?|milliamps?|amp(?:ere)?s?|암페어|밀리\s*암페어)\b/i.test(after)) return true;
  if (/^\s*(?:x\s*)?(?:leds?|엘이디|발광(?:\s*다이오드)?)\b/i.test(after)) return true;
  if (/^\s*개/.test(after)) return true;
  return false;
}

// A bare number is a series resistor only in an LED prompt. Voltages, counts, and currents are not.
function parseExplicitResistanceOhms(prompt) {
  const rkm = firstAcceptedOhms(
    prompt,
    '(?<![\\w.])(\\d+)([rRkKmM])(\\d+)(?![\\w])',
    'g',
    (match) => rkmToOhms(match[1], match[3], match[2])
  );
  if (rkm != null) return rkm;

  const withUnit = firstAcceptedOhms(
    prompt,
    '(\\d+(?:\\.\\d+)?)\\s*([rRkKmM])?\\s*(?:옴|ohms?|Ω)',
    'gi',
    (match) => Number(match[1]) * (match[2] ? RESISTANCE_MULTIPLIER[match[2].toLowerCase()] : 1)
  );
  if (withUnit != null) return withUnit;

  const suffixed = firstAcceptedOhms(
    prompt,
    '(?<![\\w.])(\\d+(?:\\.\\d+)?)\\s*([rRkKmM])(?:\\s*[rR]\\b|\\b)(?![A-Za-z])',
    'g',
    (match) => Number(match[1]) * RESISTANCE_MULTIPLIER[match[2].toLowerCase()]
  );
  if (suffixed != null) return suffixed;

  const bare = firstAcceptedOhms(
    prompt,
    '(?<![\\w.])(\\d+\\.\\d+|\\d+)(?![\\w]|\\.\\d)',
    'g',
    (match) => (isBareNumberExcluded(prompt.slice((match.index ?? 0) + match[0].length)) ? null : Number(match[1]))
  );
  return bare;
}

const VOLTAGE_UNIT = '(?:[Vv][Oo][Ll][Tt][Ss]?|[Vv][Dd][Cc]|[Vv][Aa][Cc]|[Vv]|볼트)';
const VOLTAGE_TOKEN = new RegExp(
  `([+\\-\\u2212])?(\\d+(?:[.,]\\d+)?)\\s*([kKmM])?\\s*${VOLTAGE_UNIT}(?:\\s*/\\s*[Aa]\\.?[Cc]\\.?)?(?![A-Za-z])`,
  'g'
);
const UNCOVERED_VOLTAGE = [
  '\\d+(?:[.,]\\d+)?\\s*[kKmM]?\\s*(?:volts|volt|vdc|vac|v|볼트)[A-Za-z]+',
  '\\d+(?:,\\d+){2,}\\s*[kKmM]?\\s*(?:volts|volt|vdc|vac|v|볼트)(?![A-Za-z])',
  '(?<![A-Za-z0-9.,])(?:volts|volt|vdc|vac|kv|mv|볼트)(?![A-Za-z])'
];

function roundVolts(volts) {
  if (!Number.isFinite(volts)) return volts;
  return Math.round(volts * 1000) / 1000;
}

function voltageScale(multiplier) {
  if (!multiplier) return 1;
  if (multiplier === 'k' || multiplier === 'K') return 1000;
  if (multiplier === 'm') return 0.001;
  if (multiplier === 'M') return 1_000_000;
  return null;
}

// 3,3 is 3.3. A thousands separator such as 1,000 is not a voltage we will guess.
function parseVoltageNumber(raw) {
  if (/^\d+$/.test(raw)) return Number(raw);
  if (/^\d+\.\d+$/.test(raw)) return Number(raw);
  const comma = /^(\d+),(\d+)$/.exec(raw);
  if (!comma) return null;
  if (comma[2].length === 1 || comma[2].length === 2) return Number(`${comma[1]}.${comma[2]}`);
  return null;
}

function leadingSign(prompt, index) {
  let cursor = index;
  while (cursor > 0 && /\s/.test(prompt[cursor - 1])) cursor -= 1;
  if (cursor === 0) return null;
  const sign = prompt[cursor - 1];
  if (sign !== '+' && sign !== '-' && sign !== '\u2212') return null;
  if (cursor > 1 && /[\w.]/.test(prompt[cursor - 2])) return null;
  return { index: cursor - 1, negative: sign !== '+' };
}

function rememberVoltage(tokens, spans, index, end, volts) {
  if (spans.some((span) => index < span.end && end > span.index)) return;
  spans.push({ index, end });
  if (Number.isFinite(volts)) tokens.push({ index, end, volts });
}

function spanCovers(spans, start, end) {
  return spans.some((span) => start >= span.index && end <= span.end);
}

function hasUncoveredVoltage(prompt, spans) {
  return UNCOVERED_VOLTAGE.some((source) => {
    for (const match of prompt.matchAll(new RegExp(source, 'gi'))) {
      const start = match.index ?? 0;
      if (!spanCovers(spans, start, start + match[0].length)) return true;
    }
    return false;
  });
}

function scanSupplyVoltages(prompt) {
  const tokens = [];
  const spans = [];
  let unparseable = false;
  // 3V3 and 5v0 are one token. A space, another digit, or a resistor suffix belongs to the next value.
  for (const match of prompt.matchAll(/(\d+)v(\d)(?![\dk])/gi)) {
    let index = match.index ?? 0;
    let volts = Number(`${match[1]}.${match[2]}`);
    const sign = leadingSign(prompt, index);
    if (sign) {
      index = sign.index;
      if (sign.negative) volts = -volts;
    }
    rememberVoltage(tokens, spans, index, (match.index ?? 0) + match[0].length, roundVolts(volts));
  }
  for (const match of prompt.matchAll(new RegExp(VOLTAGE_TOKEN.source, 'g'))) {
    let index = match.index ?? 0;
    const end = index + match[0].length;
    let negative = false;
    if (match[1]) {
      const before = index > 0 ? prompt[index - 1] : '';
      if (before && /[\w.]/.test(before)) index += match[1].length;
      else negative = match[1] !== '+';
    }
    const parsed = parseVoltageNumber(match[2]);
    const scale = voltageScale(match[3]);
    if (parsed == null || scale == null) {
      if (!spanCovers(spans, index, end)) unparseable = true;
      continue;
    }
    const volts = roundVolts(parsed * scale) * (negative ? -1 : 1);
    const covered = spanCovers(spans, index, end);
    rememberVoltage(tokens, spans, index, end, volts);
    if (!covered && !Number.isFinite(volts)) unparseable = true;
  }
  if (hasUncoveredVoltage(prompt, spans)) unparseable = true;
  tokens.sort((left, right) => left.index - right.index);
  return { tokens, unparseable };
}

function voltageWindow(prompt, item, found) {
  const previous = found.filter((other) => other.end <= item.index).at(-1);
  const next = found.find((other) => other.index >= item.end);
  const start = Math.max(previous ? previous.end : 0, item.index - 32);
  const end = Math.min(next ? next.index : prompt.length, item.end + 32);
  return {
    before: prompt.slice(start, item.index),
    after: prompt.slice(item.end, end)
  };
}

function closestContextGap(before, after, pattern) {
  let best = Number.POSITIVE_INFINITY;
  for (const match of before.matchAll(new RegExp(pattern.source, 'gi'))) {
    best = Math.min(best, before.length - (match.index + match[0].length));
  }
  for (const match of after.matchAll(new RegExp(pattern.source, 'gi'))) {
    best = Math.min(best, match.index);
  }
  return best;
}

function contextOwned(gaps, index) {
  const gap = gaps[index];
  return Number.isFinite(gap) && gap <= 32 && gaps.every((other, otherIndex) => otherIndex === index || !(other < gap));
}

// Prefer a voltage tied to the supply. An LED forward voltage is never the rail.
function classifySupplyVoltages(prompt, found) {
  const windows = found.map((item) => voltageWindow(prompt, item, found));
  const forwardGaps = windows.map(({ before, after }) => closestContextGap(before, after, FORWARD_VOLTAGE));
  const supplyGaps = windows.map(({ before, after }) => closestContextGap(before, after, SUPPLY_VOLTAGE));
  return found.map((item, index) => {
    const onAt = ON_AT_VOLTAGE.test(windows[index].before);
    const forwardOwned = contextOwned(forwardGaps, index);
    const supplyOwned = contextOwned(supplyGaps, index);
    const forward = forwardOwned && !onAt && !(supplyOwned && supplyGaps[index] < forwardGaps[index]);
    return {
      ...item,
      forward,
      supply: !forward && (onAt || supplyOwned)
    };
  });
}

function mentionsLedColor(text) {
  return LED_COLOR_SPECS.some((color) => color.patterns.some((pattern) => pattern.test(text)));
}

// Unlabeled voltages stay in the pool. A color-adjacent value is the LED Vf, not a
// second rail, only when another voltage is already marked as the supply.
function supplyCandidates(prompt, found) {
  const labeled = classifySupplyVoltages(prompt, found);
  const explicitSupply = labeled.some((item) => item.supply);
  return labeled.filter((item) => {
    if (item.forward) return false;
    if (item.supply) return true;
    if (!explicitSupply) return true;
    const window = voltageWindow(prompt, item, found);
    return !mentionsLedColor(`${window.before}\n${window.after}`);
  }).sort((left, right) => left.index - right.index);
}

function distinctSupplyVolts(candidates) {
  const seen = new Set();
  const volts = [];
  for (const item of candidates) {
    const key = formatVolts(item.volts);
    if (seen.has(key)) continue;
    seen.add(key);
    volts.push(item.volts);
  }
  return volts;
}

function pickSupplyVolts(prompt, found) {
  return supplyCandidates(prompt, found)[0]?.volts ?? null;
}

// One labeled forward voltage replaces the color default for every channel.
// Two different labeled values stay on the color defaults instead of guessing.
function specifiedForwardVoltage(prompt) {
  const labeled = classifySupplyVoltages(prompt, scanSupplyVoltages(prompt).tokens);
  const volts = distinctSupplyVolts(labeled.filter((item) => item.forward && item.volts > 0));
  return volts.length === 1 ? volts[0] : null;
}

const MAINS_SUPPLY = /상용\s*전원|교류\s*전원|\bmains\b|\bwall\s*outlet\b|\bline\s*voltage\b/i;
const AC_SUPPLY = /교류|(?:^|[^A-Za-z])vac(?:[^A-Za-z]|$)|(?:^|[^A-Za-z])ac(?:[^A-Za-z]|$)/i;
const MAX_DISCRETE_SUPPLY_VOLTS = 24;

function promptIndicatesAc(prompt) {
  return AC_SUPPLY.test(prompt);
}

function resolveDiscreteSupply(prompt) {
  const scan = scanSupplyVoltages(prompt);
  const labeled = classifySupplyVoltages(prompt, scan.tokens);
  // A labeled forward voltage is the LED Vf, never a high-voltage rail.
  const unsafe = labeled.find((token) => !token.forward && token.volts > MAX_DISCRETE_SUPPLY_VOLTS);
  const mains = MAINS_SUPPLY.test(prompt);
  if (promptIndicatesAc(prompt) && !mains && !unsafe) {
    const volts = pickSupplyVolts(prompt, scan.tokens.filter((token) => token.volts > 0));
    return {
      refused: true,
      code: 'discrete-led-ac-supply',
      supplyVolts: Number.isFinite(volts) ? volts : null,
      message: acSupplyMessage(volts)
    };
  }
  if (scan.unparseable) {
    return {
      refused: true,
      code: 'discrete-led-invalid-voltage',
      supplyVolts: null,
      message: 'Refusing to draft an LED circuit because the supply voltage could not be parsed. Write a positive low-voltage value such as 5V, 3.3V, 3300mV, or 3,3V. Unrecognized units, 0V, and negative values are rejected. No LED, resistor, or power symbol was generated.'
    };
  }
  const nonPositive = scan.tokens.find((token) => token.volts <= 0);
  if (nonPositive) {
    return {
      refused: true,
      code: 'discrete-led-invalid-voltage',
      supplyVolts: nonPositive.volts,
      message: `Refusing to draft an LED circuit because the supply voltage ${formatVolts(nonPositive.volts)}V is not positive. The discrete LED generator only supports low-voltage rails up to 24V. No LED, resistor, or power symbol was generated.`
    };
  }
  if (mains || unsafe) {
    const volts = unsafe?.volts ?? pickSupplyVolts(prompt, scan.tokens);
    return {
      refused: true,
      code: 'discrete-led-high-voltage',
      supplyVolts: Number.isFinite(volts) ? volts : null,
      message: highVoltageMessage(volts)
    };
  }
  const distinct = distinctSupplyVolts(supplyCandidates(prompt, scan.tokens));
  if (distinct.length > 1) {
    return {
      refused: true,
      code: 'discrete-led-ambiguous-supply',
      supplyVolts: null,
      message: ambiguousSupplyMessage(distinct)
    };
  }
  const selected = distinct[0];
  if (!Number.isFinite(selected)) {
    return { refused: false, supplyVolts: 5, supplyAssumed: true };
  }
  return { refused: false, supplyVolts: selected, supplyAssumed: false };
}

function highVoltageMessage(volts) {
  const detected = Number.isFinite(volts) ? ` Detected ${formatVolts(volts)}V.` : '';
  return bilingualNote(
    `Refusing to draft a mains or high-voltage LED circuit.${detected} The discrete LED generator only supports low-voltage rails up to 24V (+3V3, +5V, +9V, and +12V). No LED, resistor, or power symbol was generated.`,
    '고전압은 거부합니다. 이산 LED 생성기는 24V 이하의 저전압만 지원하며, LED·저항·전원 기호는 생성하지 않았습니다.'
  );
}

function acSupplyMessage(volts) {
  const detected = Number.isFinite(volts) ? ` Detected ${formatVolts(volts)}V AC.` : '';
  return bilingualNote(
    `Refusing to draft an LED circuit because the supply is AC.${detected} The discrete LED generator only supports DC rails up to 24V. No LED, resistor, or power symbol was generated.`,
    '교류는 전압과 관계없이 거부합니다. 이산 LED 생성기는 24V 이하의 직류만 지원하며, LED·저항·전원 기호는 생성하지 않았습니다.'
  );
}

function ambiguousSupplyMessage(volts) {
  const list = joinVoltLabels(volts);
  return bilingualNote(
    `Refusing to draft an LED circuit because several supply voltages were given (${list}). Which supply should the LED use? No LED, resistor, or power symbol was generated.`,
    `공급 전압이 여러 개입니다 (${list}). 어떤 공급 전압을 쓸지 알려 주세요. LED, 저항, 전원 기호는 생성하지 않았습니다.`
  );
}

function joinVoltLabels(volts) {
  const labels = volts.map((value) => `${formatVolts(value)}V`);
  if (labels.length <= 1) return labels.join('');
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')}, and ${labels.at(-1)}`;
}

const LED_COLOR_KO = {
  red: '빨간',
  yellow: '노란',
  green: '초록',
  blue: '파란',
  white: '하얀'
};

function belowForwardMessage(supplyVolts, color, specifiedVf) {
  const supply = formatVolts(supplyVolts);
  if (Number.isFinite(specifiedVf)) {
    const vf = formatVolts(specifiedVf);
    return bilingualNote(
      `Refusing to draft an LED circuit because the supply ${supply}V is not above the specified forward voltage of ${vf}V. A series current cannot be calculated. No LED, resistor, or power symbol was generated.`,
      `공급 전압 ${supply}V가 지정한 순방향 전압 ${vf}V보다 높지 않아 회로를 만들지 않습니다. LED, 저항, 전원 기호는 생성하지 않았습니다.`
    );
  }
  const spec = color ?? LED_COLOR_SPECS[0];
  const vf = formatVolts(spec.vf);
  const ko = LED_COLOR_KO[spec.id] ?? LED_COLOR_KO.red;
  return bilingualNote(
    `Refusing to draft an LED circuit because the supply ${supply}V is not above the typical ${spec.prose} LED forward voltage of ${vf}V. A series current cannot be calculated. No LED, resistor, or power symbol was generated.`,
    `공급 전압 ${supply}V가 ${ko} LED의 일반적인 순방향 전압 ${vf}V보다 높지 않아 회로를 만들지 않습니다. LED, 저항, 전원 기호는 생성하지 않았습니다.`
  );
}

function supplyNetName(volts) {
  if (Math.abs(volts - 3.3) < 0.05) return '+3V3';
  if (Number.isInteger(volts)) return `+${volts}V`;
  const [whole, fraction = ''] = String(volts).split('.');
  return `+${whole}V${fraction}`;
}

function formatScaled(value) {
  const scaled = Math.round(value * 10) / 10;
  return String(scaled);
}

function formatOhms(ohms) {
  if (!Number.isFinite(ohms) || ohms <= 0) return null;
  const nearest = Math.round(ohms);
  const value = Math.abs(ohms - nearest) < 1e-6 ? nearest : Math.round(ohms * 10) / 10;
  if (value >= 1_000_000) return `${formatScaled(value / 1_000_000)}MΩ`;
  if (value >= 1000) return `${formatScaled(value / 1000)}kΩ`;
  return `${value}Ω`;
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
  return null;
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
  return found.map(({ index: _index, patterns: _patterns, ...color }) => color);
}

function bilingualNote(en, ko) {
  return `${en} ${ko}`;
}

function unsupportedLedFeatures(prompt) {
  const items = [];
  if (/\brgb\b|풀\s*컬러|풀컬러|네오\s*픽셀|neopixel|addressable|어드레서블|ws2812|ws2811|sk6812|apa102|삼색|3\s*색|다색|led\s*matrix|매트릭스|charlieplex/i.test(prompt)) {
    items.push({
      id: 'rgb',
      message: bilingualNote(
        'Unsupported: RGB, addressable, and matrix LEDs are not supported by the discrete LED generator. A simple indicator LED was drafted instead.',
        '어드레서블·WS2812·RGB·매트릭스 LED는 지원하지 않아 단일 표시 LED로 대체했습니다.'
      )
    });
  }
  if (/\bpwm\b|펄스\s*폭|밝기\s*조절|밝기조절|디밍|\bdimm|\bfade\b|페이딩/i.test(prompt)) {
    items.push({
      id: 'pwm',
      message: 'Unsupported: PWM, dimming, and brightness control are not supported by the discrete LED generator. The draft is a static series LED.'
    });
  }
  if (/\bstrips?\b|스트립|엘이디\s*띠|\bled\s*띠/i.test(prompt)) {
    items.push({
      id: 'strip',
      message: 'Unsupported: LED strips are not supported by the discrete LED generator. A simple indicator LED was drafted instead.'
    });
  }
  if (/\bpots?\b|\bpotentiometers?\b|가변\s*저항/i.test(prompt)) {
    items.push({
      id: 'pot',
      message: 'Unsupported: potentiometers are not supported by the discrete LED generator. The draft uses a fixed series resistor instead.'
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

function resistorFromSupply({ supplyVolts, vf, colorLabel, assumed, specified = false }) {
  const rawOhms = (Math.round(supplyVolts * 1000) - Math.round(vf * 1000)) / TYPICAL_LED_CURRENT_MA;
  const resistanceOhms = roundUpE24(rawOhms);
  const resistorValue = formatOhms(resistanceOhms);
  const formula = `(${formatVolts(supplyVolts)}V - ${formatVolts(vf)}V) / ${TYPICAL_LED_CURRENT_MA}mA = ${formatOhms(rawOhms)}`;
  const rounding = formatOhms(rawOhms) === resistorValue
    ? ''
    : `, rounded up to the next E24 value ${resistorValue}`;
  const prefix = assumed
    ? `No LED color was given, so the draft assumes a typical red LED Vf of ${formatVolts(vf)}V. `
    : '';
  const summary = specified
    ? bilingualNote(
      `Series resistor ${resistorValue} was calculated as ${formula}${rounding} using the specified forward voltage of ${formatVolts(vf)}V.`,
      `지정한 순방향 전압 ${formatVolts(vf)}V로 직렬 저항 ${resistorValue}을 계산했습니다`
    )
    : `${prefix}Series resistor ${resistorValue} was calculated as ${formula}${rounding} for a ${colorLabel} LED (typical Vf ${formatVolts(vf)}V).`;
  return {
    vf,
    resistanceOhms,
    resistorValue,
    summary
  };
}

function channelForLed({ color, supplyVolts, resistorExplicit, explicitOhms, specifiedVf = null }) {
  const vfColor = color ?? LED_COLOR_SPECS[0];
  const specified = Number.isFinite(specifiedVf);
  const assumed = !color && !specified;
  const vf = specified ? specifiedVf : vfColor.vf;
  const calculation = resistorExplicit
    ? null
    : resistorFromSupply({
      supplyVolts,
      vf,
      colorLabel: vfColor.prose,
      assumed,
      specified
    });
  const resistanceOhms = resistorExplicit ? explicitOhms : calculation.resistanceOhms;
  const resistorValue = formatOhms(resistanceOhms);
  return {
    color: color ? { id: color.id, label: color.label, vf: color.vf } : null,
    assumedColor: assumed,
    ledValue: color ? `LED ${color.label}` : 'LED',
    vf,
    resistanceOhms,
    resistorValue,
    calculation
  };
}

const HEADROOM_WARN_MV = 1000;
const TINY_RESISTOR_OHMS = 68;

function headroomMillivolts(supplyVolts, vf) {
  return Math.round(supplyVolts * 1000) - Math.round(vf * 1000);
}

function headroomWarning(channels, supplyVolts) {
  const usable = channels.filter((channel) => headroomMillivolts(supplyVolts, channel.vf) > 0);
  const low = usable.filter((channel) => headroomMillivolts(supplyVolts, channel.vf) < HEADROOM_WARN_MV);
  const tiny = usable.filter((channel) => channel.resistanceOhms < TINY_RESISTOR_OHMS);
  if (low.length === 0 && tiny.length === 0) return null;
  const english = [];
  const korean = [];
  if (low.length > 0) {
    const worst = low.reduce((best, channel) => (
      headroomMillivolts(supplyVolts, channel.vf) < headroomMillivolts(supplyVolts, best.vf) ? channel : best
    ));
    const headroom = formatVolts(headroomMillivolts(supplyVolts, worst.vf) / 1000);
    english.push(`headroom is only ${headroom}V`);
    korean.push(`여유 전압이 ${headroom}V뿐입니다`);
  }
  if (tiny.length > 0) {
    const smallest = tiny.reduce((best, channel) => (
      channel.resistanceOhms < best.resistanceOhms ? channel : best
    ));
    english.push(`series resistor ${smallest.resistorValue} is below 68Ω`);
    korean.push(`직렬 저항 ${smallest.resistorValue}은 68Ω보다 작습니다`);
  }
  return {
    code: 'discrete-led-headroom',
    message: bilingualNote(
      `Warning: LED supply ${english.join('; ')}. Confirm the LED current before release.`,
      korean.join(' ')
    )
  };
}

function specifiedForwardNote(specifiedVf) {
  if (!Number.isFinite(specifiedVf)) return '';
  return ` ${bilingualNote(
    `The specified forward voltage of ${formatVolts(specifiedVf)}V is used instead of the color default.`,
    `지정한 순방향 전압 ${formatVolts(specifiedVf)}V를 색상 기본값 대신 사용합니다.`
  )}`;
}

function buildDiscreteReviewNotes({ color, ledValue, resistorExplicit, resistorValue, quantityCapped, requestedCount, count, calculation, unsupported, perColor, channels, supplyAssumed, specifiedVf }) {
  const notes = [];
  if (perColor && resistorExplicit) {
    const names = channels.map((channel) => channel.ledValue).join(', ');
    notes.push({
      code: 'discrete-led',
      message: `Discrete LED draft keeps the requested series resistor ${resistorValue} for ${names}; confirm it for the LED forward voltage and current before release.${specifiedForwardNote(specifiedVf)}`
    });
  } else if (perColor) {
    for (const channel of channels) {
      const id = channel.color?.id ?? 'led';
      notes.push({
        code: `discrete-led-${id}`,
        message: channel.calculation.summary
      });
    }
  } else if (resistorExplicit) {
    const colorText = color ? ` for ${ledValue}` : '';
    notes.push({
      code: 'discrete-led',
      message: `Discrete LED draft keeps the requested series resistor ${resistorValue}${colorText}; confirm it for the LED forward voltage and current before release.${specifiedForwardNote(specifiedVf)}`
    });
  } else {
    notes.push({ code: 'discrete-led', message: calculation.summary });
  }
  if (quantityCapped) {
    notes.push({
      code: 'discrete-led-quantity-capped',
      message: bilingualNote(
        `Requested ${requestedCount} LEDs; the discrete LED generator is capped at ${count}. Extra LEDs were not generated.`,
        `요청한 LED는 ${requestedCount}개이고, 이산 LED 생성기는 ${count}개까지입니다. 넘는 LED는 만들지 않았습니다.`
      )
    });
  }
  if (supplyAssumed) {
    notes.push({
      code: 'discrete-led-supply-assumed',
      message: bilingualNote(
        'No supply voltage was given, so the draft assumes 5V.',
        '공급 전압이 없어서 5V로 가정했습니다.'
      )
    });
  }
  for (const item of unsupported) {
    notes.push({ code: `discrete-led-unsupported-${item.id}`, message: item.message });
  }
  return notes;
}

function refuseDiscreteLed({ code, message, supplyVolts, supplyAssumed = false }) {
  return {
    count: 0,
    requestedCount: 0,
    quantityCapped: false,
    refused: true,
    perColor: false,
    color: null,
    assumedColor: false,
    ledValue: 'LED',
    resistanceOhms: null,
    resistorValue: null,
    resistorExplicit: false,
    supplyVolts,
    supplyNet: null,
    supplyKind: null,
    supplyAssumed: supplyAssumed === true,
    channels: [],
    calculation: null,
    unsupported: [],
    reviewWarnings: [],
    reviewBlockers: [{ code, message }],
    reviewNotes: []
  };
}

export function parseDiscreteLedRequest(prompt) {
  const text = String(prompt ?? '');
  if (!isSimpleDiscreteLedPrompt(text)) return null;
  const supply = resolveDiscreteSupply(text);
  if (supply.refused) return refuseDiscreteLed(supply);
  const supplyVolts = supply.supplyVolts;
  const supplyAssumed = supply.supplyAssumed === true;
  const specifiedVf = specifiedForwardVoltage(text);
  const colors = findLedColors(text);
  const explicitCount = parseLedCount(text);
  const perColor = colors.length > 1 && (explicitCount == null || explicitCount === colors.length);
  const requestedCount = perColor ? colors.length : Math.max(1, explicitCount ?? 1);
  const count = Math.min(MAX_DISCRETE_LEDS, requestedCount);
  const explicitOhms = parseExplicitResistanceOhms(text);
  const resistorExplicit = Number.isFinite(explicitOhms) && explicitOhms > 0;
  const channelColors = perColor
    ? colors.slice(0, count)
    : Array.from({ length: count }, () => colors[0] ?? null);
  const undersuppliedIndex = channelColors.findIndex((color) => {
    const vf = Number.isFinite(specifiedVf) ? specifiedVf : (color?.vf ?? LED_COLOR_SPECS[0].vf);
    return headroomMillivolts(supplyVolts, vf) <= 0;
  });
  if (undersuppliedIndex >= 0) {
    return refuseDiscreteLed({
      code: 'discrete-led-below-vf',
      supplyVolts,
      supplyAssumed,
      message: belowForwardMessage(supplyVolts, channelColors[undersuppliedIndex], specifiedVf)
    });
  }
  const channels = channelColors.map((color) => channelForLed({
    color,
    supplyVolts,
    resistorExplicit,
    explicitOhms,
    specifiedVf
  }));
  if (channels.some((channel) => !channel.resistorValue)) return null;
  const primary = channels[0];
  const unsupported = unsupportedLedFeatures(text);
  if (!perColor && colors.length > 1) {
    const names = colors.map((item) => item.prose).join(', ');
    unsupported.push({
      id: 'mixed-color',
      message: `Unsupported: multiple LED colors (${names}) in one draft are not supported. The draft uses ${colors[0].prose} for every LED.`
    });
  }
  const parsed = {
    count,
    requestedCount,
    quantityCapped: requestedCount > count,
    refused: false,
    perColor,
    color: primary.color,
    assumedColor: primary.assumedColor,
    ledValue: primary.ledValue,
    resistanceOhms: primary.resistanceOhms,
    resistorValue: primary.resistorValue,
    resistorExplicit,
    supplyVolts,
    supplyNet: supplyNetName(supplyVolts),
    supplyKind: /\bbattery\b|배터리|건전지/i.test(text) ? 'battery' : 'rail',
    channels,
    calculation: primary.calculation,
    unsupported,
    supplyAssumed,
    specifiedVf: Number.isFinite(specifiedVf) ? specifiedVf : null
  };
  const reviewNotes = buildDiscreteReviewNotes(parsed);
  const warning = headroomWarning(parsed.channels, supplyVolts);
  return {
    ...parsed,
    reviewNotes,
    reviewBlockers: [],
    reviewWarnings: warning ? [warning] : []
  };
}

export function applyDiscreteLedSpec(spec) {
  if (!spec || typeof spec !== 'object') return spec;
  if (spec.boardProfile?.id) return spec;
  if (DISCRETE_PROFILE_KINDS.has(spec.kind) || DISCRETE_PROFILE_KINDS.has(spec.boardProfile?.kind)) return spec;
  const parsed = parseDiscreteLedRequest(spec.sourcePrompt ?? '');
  if (!parsed) return spec;
  if (parsed.refused) {
    return {
      ...spec,
      kind: 'discrete-led',
      interfaces: [],
      peripherals: [],
      power: {
        input: 'external',
        rails: []
      },
      discrete: parsed
    };
  }
  return {
    ...spec,
    kind: 'discrete-led',
    interfaces: [],
    peripherals: parsed.channels.map((channel) => ({
      kind: 'status-led',
      color: channel.color?.id ?? null,
      currentLimit: channel.resistorValue
    })),
    power: {
      input: 'external',
      rails: [{ name: parsed.supplyNet, voltage: parsed.supplyVolts, source: 'input' }]
    },
    discrete: parsed
  };
}
