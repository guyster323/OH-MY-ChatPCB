import { classifyQuantities, promptDescribesAcSupply } from './quantity-tokens.js';

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
// "GPIO 13" is a pin number on an LED prompt. "GPIO header" is still a board.
const DISCRETE_LED_BOARD_WORDS = /\b(?:button|reset|boot|regulator|connector|header|i2c|spi|uart|display|lcd|switch|buzzer|motor|relay)\b|\bgpio\b(?!\s*\d)|버튼|리셋|커넥터|헤더|레귤레이터|디스플레이/i;
const DISCRETE_PROFILE_KINDS = new Set(['battery-monitor', 'isolated-dcdc', 'bms']);
const MAX_DISCRETE_LEDS = 8;
const MAX_DISCRETE_LED_PROMPT_CHARS = 4000;
const TYPICAL_LED_CURRENT_MA = 10;
const E24_MANTISSA = [1, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2, 2.2, 2.4, 2.7, 3, 3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1];
const LED_COLOR_SPECS = [
  { id: 'red', label: 'Red', prose: 'red', vf: 2, patterns: [/빨간/, /빨강/, /적색/, /붉은/, /\bred\b/i] },
  { id: 'yellow', label: 'Yellow', prose: 'yellow', vf: 2.1, patterns: [/노란/, /노랑/, /황색/, /옐로/, /\byellow\b/i] },
  { id: 'green', label: 'Green', prose: 'green', vf: 2.2, patterns: [/초록/, /녹색/, /그린/, /\bgreen\b/i] },
  { id: 'blue', label: 'Blue', prose: 'blue', vf: 3, patterns: [/파란/, /파랑/, /청색/, /블루/, /\bblue\b/i] },
  { id: 'white', label: 'White', prose: 'white', vf: 3.2, patterns: [/하얀/, /흰/, /백색/, /화이트/, /\bwhite\b/i] }
];

function isSimpleDiscreteLedPrompt(prompt) {
  // "LEDx3" has no word boundary after LED. "LED×3" still matches \bled\b.
  const hasLed = /\bleds?(?:x\d+)?\b|엘이디|발광|네오\s*픽셀|neopixel|ws2812|ws2811|sk6812|apa102|\brgb\b/i.test(prompt);
  return hasLed && !DISCRETE_LED_EXCLUDE.test(prompt) && !DISCRETE_LED_BOARD_WORDS.test(prompt);
}

const RESISTOR_RANK = { rkm: 0, ohm: 1, suffix: 2, label: 2, bare: 3 };

function voltageContext(prompt, token, voltages) {
  const previous = voltages.filter((other) => other.end <= token.start).at(-1);
  const next = voltages.find((other) => other.start >= token.end);
  const start = Math.max(previous ? previous.end : 0, token.start - 32);
  const end = Math.min(next ? next.start : prompt.length, token.end + 32);
  return `${prompt.slice(start, token.start)}\n${prompt.slice(token.end, end)}`;
}

function explicitResistanceOhms(tokens) {
  const chosen = tokens
    .filter((token) => token.role === 'resistor' && token.value > 0)
    .sort((left, right) => (
      (RESISTOR_RANK[left.form] ?? 9) - (RESISTOR_RANK[right.form] ?? 9) || left.start - right.start
    ));
  return chosen[0]?.value ?? null;
}

function requestedCurrentMilliamps(tokens) {
  const currents = tokens.filter((token) => token.role === 'current' && token.value > 0);
  if (currents.length === 0) return null;
  return Math.max(...currents.map((token) => token.value));
}

function mentionsLedColor(text) {
  return LED_COLOR_SPECS.some((color) => color.patterns.some((pattern) => pattern.test(text)));
}

// Unlabeled voltages stay in the pool. A color-adjacent value is the LED Vf, not a
// second rail, only when another voltage is already marked as the supply.
function supplyCandidates(prompt, tokens) {
  const voltages = tokens.filter((token) => token.kind === 'voltage');
  const explicitSupply = voltages.some((token) => token.role === 'supply');
  return voltages.filter((token) => {
    if (token.role === 'vf') return false;
    if (token.role === 'supply') return true;
    if (!explicitSupply) return true;
    return !mentionsLedColor(voltageContext(prompt, token, voltages));
  }).sort((left, right) => left.start - right.start);
}

function distinctSupplyVolts(candidates) {
  const seen = new Set();
  const volts = [];
  for (const item of candidates) {
    const key = formatVolts(item.value);
    if (seen.has(key)) continue;
    seen.add(key);
    volts.push(item.value);
  }
  return volts;
}

function pickSupplyVolts(prompt, tokens) {
  return supplyCandidates(prompt, tokens)[0]?.value ?? null;
}

// One labeled forward voltage replaces the color default for every channel.
// Two different labeled values stay on the color defaults instead of guessing.
// A forward-voltage range contributes its maximum.
function specifiedForward(tokens) {
  const labeled = tokens.filter((token) => token.role === 'vf' && token.value > 0);
  const volts = distinctSupplyVolts(labeled);
  if (volts.length !== 1) return null;
  const key = formatVolts(volts[0]);
  const ranged = labeled.find((token) => token.range && formatVolts(token.value) === key);
  const token = ranged ?? labeled.find((item) => formatVolts(item.value) === key);
  return {
    volts: volts[0],
    rangeRaw: token?.range ? token.raw : null,
    rangeMin: token?.range?.min ?? null
  };
}

const MAINS_SUPPLY = /상용\s*전원|교류\s*전원|\bmains\b|\bwall\s*outlet\b|\bline\s*voltage\b/i;
const MAX_DISCRETE_SUPPLY_VOLTS = 24;

function resolveDiscreteSupply(prompt, scan) {
  const voltages = scan.tokens.filter((token) => token.kind === 'voltage');
  // A labeled forward voltage is the LED Vf, never a high-voltage rail.
  const unsafe = voltages.find((token) => token.role !== 'vf' && token.value > MAX_DISCRETE_SUPPLY_VOLTS);
  const mains = MAINS_SUPPLY.test(prompt);
  if (promptDescribesAcSupply(prompt, scan.tokens) && !mains && !unsafe) {
    const volts = pickSupplyVolts(prompt, voltages.filter((token) => token.value > 0));
    return {
      refused: true,
      code: 'discrete-led-ac-supply',
      supplyVolts: Number.isFinite(volts) ? volts : null,
      texts: acSupplyMessage(volts)
    };
  }
  if (scan.unparseable) {
    return {
      refused: true,
      code: 'discrete-led-invalid-voltage',
      supplyVolts: null,
      texts: {
        en: 'Refusing to draft an LED circuit because the supply voltage could not be parsed. Write a positive low-voltage value such as 5V, 3.3V, 3300mV, or 3,3V. Unrecognized units, 0V, and negative values are rejected. No LED, resistor, or power symbol was generated.',
        ko: '공급 전압을 해석할 수 없어 LED 회로를 만들지 않습니다. 5V, 3.3V, 3300mV, 3,3V처럼 양의 저전압을 적어 주세요. 알 수 없는 단위, 0V, 음의 값은 거부합니다. LED, 저항, 전원 기호는 생성하지 않았습니다.'
      }
    };
  }
  const nonPositive = voltages.find((token) => token.role !== 'vf' && token.value <= 0);
  if (nonPositive) {
    const shown = formatVolts(nonPositive.value);
    return {
      refused: true,
      code: 'discrete-led-invalid-voltage',
      supplyVolts: nonPositive.value,
      texts: {
        en: `Refusing to draft an LED circuit because the supply voltage ${shown}V is not positive. The discrete LED generator only supports low-voltage rails up to 24V. No LED, resistor, or power symbol was generated.`,
        ko: `공급 전압 ${withJosa(`${shown}V`, '이/가')} 양수가 아니어서 LED 회로를 만들지 않습니다. 이산 LED 생성기는 24V 이하의 저전압만 지원합니다. LED, 저항, 전원 기호는 생성하지 않았습니다.`
      }
    };
  }
  if (mains || unsafe) {
    const volts = unsafe?.value ?? pickSupplyVolts(prompt, scan.tokens);
    return {
      refused: true,
      code: 'discrete-led-high-voltage',
      supplyVolts: Number.isFinite(volts) ? volts : null,
      texts: highVoltageMessage(volts)
    };
  }
  const unlabeledRange = scan.tokens.find((token) => (
    token.kind === 'voltage' && token.range && token.role !== 'vf'
  ));
  if (unlabeledRange) {
    return {
      refused: true,
      code: 'discrete-led-ambiguous-range',
      supplyVolts: null,
      texts: ambiguousRangeMessage(unlabeledRange)
    };
  }
  const distinct = distinctSupplyVolts(supplyCandidates(prompt, scan.tokens));
  if (distinct.length > 1) {
    return {
      refused: true,
      code: 'discrete-led-ambiguous-supply',
      supplyVolts: null,
      texts: ambiguousSupplyMessage(distinct)
    };
  }
  const selected = distinct[0];
  if (!Number.isFinite(selected)) {
    return { refused: false, supplyVolts: 5, supplyAssumed: true };
  }
  return { refused: false, supplyVolts: selected, supplyAssumed: false };
}

function usesKorean(text) {
  return /[가-힣]/.test(String(text ?? ''));
}

// 0 영, 1 일, 3 삼, 6 육, 7 칠, 8 팔 have a batchim. 2 이, 4 사, 5 오, 9 구 do not.
// Ω is read 옴. The particle pair is "consonant/vowel" (은/는, 이/가, 을/를, 과/와).
const DIGIT_BATCHIM = new Set(['0', '1', '3', '6', '7', '8']);
const LATIN_BATCHIM = new Set(['l', 'm', 'n', 'r', 'z']);

function hasFinalConsonant(value) {
  const text = String(value ?? '').trim();
  const last = text.at(-1) ?? '';
  if (!last) return false;
  const code = last.codePointAt(0);
  if (code >= 0xAC00 && code <= 0xD7A3) return (code - 0xAC00) % 28 !== 0;
  if (last >= '0' && last <= '9') return DIGIT_BATCHIM.has(last);
  if (last === 'Ω' || last === 'Ω' || last === '%') return true;
  if (/[A-Za-z]/.test(last)) return LATIN_BATCHIM.has(last.toLowerCase());
  return false;
}

function josa(value, pair) {
  const [consonant, vowel] = pair.split('/');
  return hasFinalConsonant(value) ? consonant : vowel;
}

function withJosa(value, pair) {
  return `${value}${josa(value, pair)}`;
}

function finishSentence(text) {
  const value = String(text ?? '').trim();
  if (!value || /[.。]$/.test(value)) return value;
  return `${value}.`;
}

function asFinding(code, texts, prompt) {
  const en = finishSentence(texts.en);
  const ko = finishSentence(texts.ko);
  return {
    code,
    en,
    ko,
    message: usesKorean(prompt) ? ko : en
  };
}

function highVoltageMessage(volts) {
  const detected = Number.isFinite(volts) ? ` Detected ${formatVolts(volts)}V.` : '';
  const detectedKo = Number.isFinite(volts) ? ` 감지된 전압은 ${formatVolts(volts)}V입니다.` : '';
  return {
    en: `Refusing to draft a mains or high-voltage LED circuit.${detected} The discrete LED generator only supports low-voltage rails up to 24V (+3V3, +5V, +9V, and +12V). No LED, resistor, or power symbol was generated.`,
    ko: `고전압은 거부합니다.${detectedKo} 이산 LED 생성기는 24V 이하의 저전압만 지원합니다. LED, 저항, 전원 기호는 생성하지 않았습니다.`
  };
}

function acSupplyMessage(volts) {
  const detected = Number.isFinite(volts) ? ` Detected ${formatVolts(volts)}V AC.` : '';
  const detectedKo = Number.isFinite(volts) ? ` 감지된 전압은 ${formatVolts(volts)}V 교류입니다.` : '';
  return {
    en: `Refusing to draft an LED circuit because the supply is AC.${detected} The discrete LED generator only supports DC rails up to 24V. No LED, resistor, or power symbol was generated.`,
    ko: `교류는 전압과 관계없이 거부합니다.${detectedKo} 이산 LED 생성기는 24V 이하의 직류만 지원합니다. LED, 저항, 전원 기호는 생성하지 않았습니다.`
  };
}

function promptTooLongMessage() {
  return {
    en: `Refusing to draft an LED circuit because the prompt is longer than ${MAX_DISCRETE_LED_PROMPT_CHARS} characters. Shorten the request and try again. No LED, resistor, or power symbol was generated.`,
    ko: `요청이 ${MAX_DISCRETE_LED_PROMPT_CHARS}자를 넘어 LED 회로를 만들지 않습니다. 요청을 줄여 다시 보내 주세요. LED, 저항, 전원 기호는 생성하지 않았습니다.`
  };
}

function ambiguousRangeMessage(token) {
  const raw = token.raw;
  return {
    en: `Which value is the supply and which is the LED Vf in ${raw}? Name the supply and the forward voltage (Vf), then ask again.`,
    ko: `어느 값이 공급 전압이고 어느 값이 LED 순방향 전압인가요, ${raw}? 공급 전압과 순방향 전압을 따로 적어 다시 요청해 주세요.`
  };
}

function implausibleForwardMessage(volts) {
  const shown = formatVolts(volts);
  return {
    en: `Refusing to draft an LED circuit because the forward voltage ${shown}V is implausible for an LED. Plausible forward voltages are 0.5V to 5V. No LED, resistor, or power symbol was generated.`,
    ko: `순방향 전압 ${withJosa(`${shown}V`, '은/는')} LED에 타당한 값이 아닙니다. 타당한 순방향 전압은 0.5V에서 5V입니다. LED, 저항, 전원 기호는 생성하지 않았습니다.`
  };
}

function invalidCountMessage(token) {
  const shown = token.countText ?? String(token.value);
  return {
    en: `Refusing to draft an LED circuit because the LED count ${shown} is not a positive whole number. Zero, negative, and fractional counts are rejected. No LED, resistor, or power symbol was generated.`,
    ko: `LED 개수 ${withJosa(shown, '은/는')} 양의 정수가 아닙니다. 0, 음수, 분수는 거부합니다. LED, 저항, 전원 기호는 생성하지 않았습니다.`
  };
}

function ambiguousNumberMessage(token) {
  const raw = token.raw;
  return {
    en: `Is ${raw} a resistor in ohms, an LED count, or something else? Add a unit (330Ω) or a count (3개), then ask again.`,
    ko: `${withJosa(raw, '은/는')} 저항(Ω)인가요, LED 개수인가요? 단위(330Ω)나 개수(3개)를 붙여 다시 요청해 주세요.`
  };
}

function joinResistorChoices(labels, english) {
  if (labels.length <= 1) return labels.join('');
  if (labels.length === 2) {
    return english
      ? `${labels[0]} or ${labels[1]}`
      : `${labels[0]}${josa(labels[0], '과/와')} ${labels[1]}`;
  }
  const last = labels.at(-1);
  const head = labels.slice(0, -1);
  return english
    ? `${head.join(', ')}, or ${last}`
    : `${head.join(', ')}${josa(head.at(-1), '과/와')} ${last}`;
}

function ambiguousResistorMessage(tokens) {
  const labels = tokens.map((token) => formatOhms(token.value) ?? token.raw);
  return {
    en: `Which resistor should the LED use, ${joinResistorChoices(labels, true)}? Name one series resistor, then ask again.`,
    ko: `어느 것을 직렬 저항으로 쓸까요, ${joinResistorChoices(labels, false)}? 저항을 하나만 적어 다시 요청해 주세요.`
  };
}

function formatMilliampLabel(milliamps) {
  const rounded = Math.round(Number(milliamps) * 1000) / 1000;
  return `${rounded}mA`;
}

function invalidCurrentMessage(token) {
  const shown = formatMilliampLabel(token.value);
  const compact = String(token.raw).replace(/\s+/g, '');
  const detail = compact.toLowerCase() === shown.toLowerCase() ? shown : `${compact} (${shown})`;
  return {
    en: `Refusing to draft an LED circuit because the LED current ${detail} is outside the supported range. Use a current above 0mA and at most 100mA. No LED, resistor, or power symbol was generated.`,
    ko: `LED 전류 ${withJosa(shown, '이/가')} 지원 범위를 벗어나서 회로를 만들지 않습니다. 0mA보다 크고 100mA 이하인 전류만 쓸 수 있습니다. LED, 저항, 전원 기호는 생성하지 않았습니다.`
  };
}

function ledPackageTexts(code) {
  return {
    en: `LED package ${code} is recorded for this LED. It is not an LED count or a series resistor.`,
    ko: `LED 패키지 ${withJosa(code, '을/를')} 기록했습니다. 개수나 직렬 저항으로 보지 않습니다.`
  };
}

function ambiguousSupplyMessage(volts) {
  return {
    en: `Refusing to draft an LED circuit because several supply voltages were given (${joinVoltLabels(volts)}). Which supply should the LED use? No LED, resistor, or power symbol was generated.`,
    ko: `공급 전압이 여러 개입니다 (${joinVoltLabelsKo(volts)}). 어떤 공급 전압을 쓸지 알려 주세요. LED, 저항, 전원 기호는 생성하지 않았습니다.`
  };
}

function joinVoltLabels(volts) {
  const labels = volts.map((value) => `${formatVolts(value)}V`);
  if (labels.length <= 1) return labels.join('');
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')}, and ${labels.at(-1)}`;
}

function joinVoltLabelsKo(volts) {
  const labels = volts.map((value) => `${formatVolts(value)}V`);
  if (labels.length <= 1) return labels.join('');
  const last = labels.at(-1);
  const head = labels.slice(0, -1);
  return `${head.join(', ')}${josa(head.at(-1), '과/와')} ${last}`;
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
    return {
      en: `Refusing to draft an LED circuit because the supply ${supply}V is not above the specified forward voltage of ${vf}V. A series current cannot be calculated. No LED, resistor, or power symbol was generated.`,
      ko: `공급 전압 ${withJosa(`${supply}V`, '이/가')} 지정한 순방향 전압 ${vf}V보다 높지 않아 회로를 만들지 않습니다. 직렬 전류를 계산할 수 없습니다. LED, 저항, 전원 기호는 생성하지 않았습니다.`
    };
  }
  const spec = color ?? LED_COLOR_SPECS[0];
  const vf = formatVolts(spec.vf);
  const ko = LED_COLOR_KO[spec.id] ?? LED_COLOR_KO.red;
  return {
    en: `Refusing to draft an LED circuit because the supply ${supply}V is not above LED Vf ${vf}V for a typical ${spec.prose} LED. A series current cannot be calculated. No LED, resistor, or power symbol was generated.`,
    ko: `공급 전압 ${withJosa(`${supply}V`, '이/가')} ${ko} LED의 일반적인 순방향 전압 ${vf}V보다 높지 않아 회로를 만들지 않습니다. 직렬 전류를 계산할 수 없습니다. LED, 저항, 전원 기호는 생성하지 않았습니다.`
  };
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

function formatSmallOhms(ohms) {
  if (!Number.isFinite(ohms) || ohms === 0) return '0Ω';
  const rounded = Math.round(ohms * 1e6) / 1e6;
  return `${rounded}Ω`;
}

function resistorTooSmallMessage(token) {
  const shown = formatSmallOhms(token.value);
  const raw = String(token.raw);
  const detail = raw === shown ? shown : `${raw} (${shown})`;
  return {
    en: `Refusing to draft an LED circuit because the series resistor ${detail} is below 1Ω. Use a resistor of at least 1Ω. No LED, resistor, or power symbol was generated.`,
    ko: `직렬 저항 ${withJosa(shown, '은/는')} 1Ω보다 작아서 LED 회로를 만들지 않습니다. 1Ω 이상의 저항을 적어 주세요. LED, 저항, 전원 기호는 생성하지 않았습니다.`
  };
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

const CLAIMED_QUANTITY_ROLES = new Set(['vf', 'supply', 'resistor', 'current']);

function spansOverlap(left, right) {
  return left.start < right.end && right.start < left.end;
}

// "3.2 LED" and "3,2 LED" must not yield a count of 2 from the fractional tail.
function isFractionalCountTail(prompt, start) {
  if (!(start > 0)) return false;
  const previous = prompt[start - 1];
  return previous === '.' || previous === ',' || (previous >= '0' && previous <= '9');
}

function parseLedCount(prompt, tokens) {
  // Number words ("three LEDs", "two pcs", "세 개") are count tokens. A digit
  // count still wins when both are present.
  const claimed = tokens.filter((token) => CLAIMED_QUANTITY_ROLES.has(token.role));
  const usable = [];
  for (const token of tokens) {
    if (token.kind !== 'count' || token.role !== 'count') continue;
    if (token.validCount !== true) continue;
    if (!Number.isInteger(token.value) || token.value < 1) continue;
    if (isFractionalCountTail(prompt, token.start)) continue;
    if (claimed.some((other) => spansOverlap(token, other))) continue;
    usable.push(token);
  }
  const measured = usable.find((token) => token.form !== 'word');
  if (measured) return measured.value;
  return usable.find((token) => token.form === 'word')?.value ?? null;
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

function unsupportedLedFeatures(prompt) {
  const items = [];
  if (/\brgb\b|풀\s*컬러|풀컬러|네오\s*픽셀|neopixel|addressable|어드레서블|ws2812|ws2811|sk6812|apa102|삼색|3\s*색|다색|led\s*matrix|매트릭스|charlieplex/i.test(prompt)) {
    items.push({
      id: 'rgb',
      en: 'Unsupported: RGB, addressable, and matrix LEDs are not supported by the discrete LED generator. A simple indicator LED was drafted instead.',
      ko: '어드레서블·WS2812·RGB·매트릭스 LED는 지원하지 않아 단일 표시 LED로 대체했습니다.'
    });
  }
  if (/\bpwm\b|펄스\s*폭|밝기\s*조절|밝기조절|디밍|\bdimm|\bfade\b|페이딩/i.test(prompt)) {
    items.push({
      id: 'pwm',
      en: 'Unsupported: PWM, dimming, and brightness control are not supported by the discrete LED generator. The draft is a static series LED.',
      ko: 'PWM, 디밍, 밝기 조절은 이산 LED 생성기가 지원하지 않습니다. 초안은 고정된 직렬 LED입니다.'
    });
  }
  if (/\bstrips?\b|스트립|엘이디\s*띠|\bled\s*띠/i.test(prompt)) {
    items.push({
      id: 'strip',
      en: 'Unsupported: LED strips are not supported by the discrete LED generator. A simple indicator LED was drafted instead.',
      ko: 'LED 스트립은 이산 LED 생성기가 지원하지 않습니다. 단일 표시 LED로 대체했습니다.'
    });
  }
  if (/\bpots?\b|\bpotentiometers?\b|가변\s*저항/i.test(prompt)) {
    items.push({
      id: 'pot',
      en: 'Unsupported: potentiometers are not supported by the discrete LED generator. The draft uses a fixed series resistor instead.',
      ko: '가변 저항은 이산 LED 생성기가 지원하지 않습니다. 초안은 고정 직렬 저항을 사용합니다.'
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

function designCurrentMilliamps(requestedCurrentMa) {
  return Number.isFinite(requestedCurrentMa) && requestedCurrentMa > 0
    ? requestedCurrentMa
    : TYPICAL_LED_CURRENT_MA;
}

function formatFormulaCurrent(milliamps) {
  const shown = Math.round(milliamps * 1000) / 1000;
  return `${shown}mA`;
}

function resistorFromSupply({ supplyVolts, vf, color, assumed, specified = false, currentMa = null }) {
  const usedMa = designCurrentMilliamps(currentMa);
  const rawOhms = (Math.round(supplyVolts * 1000) - Math.round(vf * 1000)) / usedMa;
  const resistanceOhms = roundUpE24(rawOhms);
  const resistorValue = formatOhms(resistanceOhms);
  const shownVf = formatVolts(vf);
  const formula = `(${formatVolts(supplyVolts)}V - ${shownVf}V) / ${formatFormulaCurrent(usedMa)} = ${formatOhms(rawOhms)}`;
  const rounded = formatOhms(rawOhms) !== resistorValue;
  const rounding = rounded ? `, rounded up to the next E24 value ${resistorValue}` : '';
  const colorLabel = color?.prose ?? 'red';
  const koColor = LED_COLOR_KO[color?.id ?? 'red'] ?? LED_COLOR_KO.red;
  const prefix = assumed
    ? `No LED color was given, so the draft assumes a typical red LED Vf of ${shownVf}V. `
    : '';
  const koPrefix = assumed
    ? `LED 색이 지정되지 않아 일반적인 빨간 LED 순방향 전압 ${shownVf}V로 가정합니다. `
    : '';
  const koRounded = `지정한 순방향 전압 ${shownVf}V로 ${formula}를 계산한 뒤 다음 E24 값 ${resistorValue}로 올렸습니다.`;
  const koExact = `지정한 순방향 전압 ${shownVf}V로 직렬 저항 ${withJosa(resistorValue, '을/를')} ${formula}로 계산했습니다.`;
  const koColorRounded = `${koColor} LED의 일반적인 순방향 전압 ${shownVf}V로 ${formula}를 계산한 뒤 다음 E24 값 ${resistorValue}로 올렸습니다.`;
  const koColorExact = `${koColor} LED의 일반적인 순방향 전압 ${shownVf}V로 직렬 저항 ${withJosa(resistorValue, '을/를')} ${formula}로 계산했습니다.`;
  const summary = specified
    ? {
      en: `Series resistor ${resistorValue} was calculated as ${formula}${rounding} using the specified forward voltage of ${shownVf}V.`,
      ko: rounded ? koRounded : koExact
    }
    : {
      en: `${prefix}Series resistor ${resistorValue} was calculated as ${formula}${rounding} for a ${colorLabel} LED (typical Vf ${shownVf}V).`,
      ko: `${koPrefix}${rounded ? koColorRounded : koColorExact}`
    };
  return {
    vf,
    resistanceOhms,
    resistorValue,
    summary
  };
}

function channelForLed({ color, supplyVolts, resistorExplicit, explicitOhms, specifiedVf = null, currentMa = null }) {
  const vfColor = color ?? LED_COLOR_SPECS[0];
  const specified = Number.isFinite(specifiedVf);
  const assumed = !color && !specified;
  const vf = specified ? specifiedVf : vfColor.vf;
  const calculation = resistorExplicit
    ? null
    : resistorFromSupply({
      supplyVolts,
      vf,
      color: color ?? (assumed ? LED_COLOR_SPECS[0] : vfColor),
      assumed,
      specified,
      currentMa
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
const LED_CURRENT_WARN_MA = 30;

function headroomMillivolts(supplyVolts, vf) {
  return Math.round(supplyVolts * 1000) - Math.round(vf * 1000);
}

function channelCurrentMilliamps(supplyVolts, channel) {
  const headroom = headroomMillivolts(supplyVolts, channel.vf);
  if (!(headroom > 0) || !(channel.resistanceOhms > 0)) return 0;
  return headroom / channel.resistanceOhms;
}

function formatCurrent(milliamps) {
  const rounded = Math.round(milliamps);
  if (rounded >= 1000) {
    const amps = Math.round(rounded / 100) / 10;
    return `${formatScaled(amps)}A`;
  }
  return `${rounded}mA`;
}

function formatActualCurrent(milliamps) {
  if (milliamps >= 1000) {
    const amps = Math.round(milliamps / 10) / 100;
    return `${amps}A`;
  }
  const rounded = Math.round(milliamps * 100) / 100;
  return `${rounded}mA`;
}

function headroomWarning(channels, supplyVolts, requestedCurrentMa, prompt) {
  const usable = channels.filter((channel) => headroomMillivolts(supplyVolts, channel.vf) > 0);
  const low = usable.filter((channel) => headroomMillivolts(supplyVolts, channel.vf) < HEADROOM_WARN_MV);
  const tiny = usable.filter((channel) => channel.resistanceOhms < TINY_RESISTOR_OHMS);
  const hot = usable
    .map((channel) => ({ channel, milliamps: channelCurrentMilliamps(supplyVolts, channel) }))
    .filter((item) => item.milliamps > LED_CURRENT_WARN_MA);
  const requestedHigh = Number.isFinite(requestedCurrentMa) && requestedCurrentMa > LED_CURRENT_WARN_MA;
  if (low.length === 0 && tiny.length === 0 && hot.length === 0 && !requestedHigh) return null;
  const english = [];
  const korean = [];
  if (low.length > 0) {
    const worst = low.reduce((best, channel) => (
      headroomMillivolts(supplyVolts, channel.vf) < headroomMillivolts(supplyVolts, best.vf) ? channel : best
    ));
    const headroom = formatVolts(headroomMillivolts(supplyVolts, worst.vf) / 1000);
    english.push(`headroom is only ${headroom}V`);
    korean.push(`여유 전압이 ${headroom}V뿐입니다.`);
  }
  if (tiny.length > 0) {
    const smallest = tiny.reduce((best, channel) => (
      channel.resistanceOhms < best.resistanceOhms ? channel : best
    ));
    english.push(`series resistor ${smallest.resistorValue} is below 68Ω`);
    korean.push(`직렬 저항 ${withJosa(smallest.resistorValue, '은/는')} 68Ω보다 작습니다.`);
  }
  if (hot.length > 0) {
    const hottest = hot.reduce((best, item) => (item.milliamps > best.milliamps ? item : best));
    const shown = formatCurrent(hottest.milliamps);
    english.push(`current is about ${shown}, above ${LED_CURRENT_WARN_MA}mA`);
    korean.push(`전류가 약 ${shown}로 ${LED_CURRENT_WARN_MA}mA를 넘습니다.`);
  }
  if (requestedHigh) {
    const shown = formatCurrent(requestedCurrentMa);
    english.push(`requested current ${shown} is above ${LED_CURRENT_WARN_MA}mA`);
    korean.push(`요청한 전류 ${withJosa(shown, '이/가')} ${LED_CURRENT_WARN_MA}mA를 넘습니다.`);
  }
  korean.push('출시 전에 LED 전류를 확인하세요.');
  return asFinding('discrete-led-headroom', {
    en: `Warning: LED supply ${english.join('; ')}. Confirm the LED current before release.`,
    ko: korean.join(' ')
  }, prompt);
}

function currentMismatchWarning(channels, supplyVolts, requestedCurrentMa, prompt) {
  if (!(requestedCurrentMa > 0)) return null;
  const actuals = [];
  const seen = new Set();
  for (const channel of channels) {
    const milliamps = channelCurrentMilliamps(supplyVolts, channel);
    if (Math.abs(milliamps - requestedCurrentMa) / requestedCurrentMa <= 0.2) continue;
    const label = formatActualCurrent(milliamps);
    if (seen.has(label)) continue;
    seen.add(label);
    actuals.push(label);
  }
  if (actuals.length === 0) return null;
  const stated = formatMilliampLabel(requestedCurrentMa);
  const listed = actuals.join(', ');
  return asFinding('discrete-led-current-mismatch', {
    en: `Warning: the series resistor draws ${listed}, which differs from the stated current ${stated} by more than 20%.`,
    ko: `직렬 저항으로 계산한 전류 ${withJosa(listed, '은/는')} 지정한 전류 ${withJosa(stated, '과/와')} 20%를 넘게 다릅니다.`
  }, prompt);
}

function specifiedForwardTexts(specifiedVf) {
  if (!Number.isFinite(specifiedVf)) return null;
  const shown = formatVolts(specifiedVf);
  return {
    en: `The specified forward voltage of ${shown}V is used instead of the color default.`,
    ko: `지정한 순방향 전압 ${withJosa(`${shown}V`, '을/를')} 색상 기본값 대신 사용합니다.`
  };
}

function keepResistorTexts({ resistorValue, color, ledValue, names, specifiedVf }) {
  const colorText = names ? ` for ${names}` : (color ? ` for ${ledValue}` : '');
  const forward = specifiedForwardTexts(specifiedVf);
  const koColor = color && !names ? `${LED_COLOR_KO[color.id]} LED에 ` : '';
  const en = `Discrete LED draft keeps the requested series resistor ${resistorValue}${colorText}; confirm it for the LED forward voltage and current before release.${forward ? ` ${forward.en}` : ''}`;
  const ko = `이산 LED 초안은 ${koColor}요청한 직렬 저항 ${withJosa(resistorValue, '을/를')} 유지합니다. LED 순방향 전압과 전류를 출시 전에 확인하세요.${forward ? ` ${forward.ko}` : ''}`;
  return { en, ko };
}

function conservativeVfMessage(rangeRaw, volts, rangeMin) {
  const max = formatVolts(volts);
  const min = Number.isFinite(rangeMin) ? formatVolts(rangeMin) : max;
  return {
    en: `Forward-voltage range ${rangeRaw} uses the maximum ${max}V so the series resistor stays conservative.`,
    ko: `순방향 전압 범위 ${min}V에서 ${max}V까지는 직렬 저항을 보수적으로 계산하도록 상한 ${max}V를 사용합니다.`
  };
}

function buildDiscreteReviewNotes({ prompt, color, ledValue, resistorExplicit, resistorValue, quantityCapped, requestedCount, count, calculation, unsupported, perColor, channels, supplyAssumed, specifiedVf, vfRangeRaw, vfRangeMin, ledPackage }) {
  const notes = [];
  if (perColor && resistorExplicit) {
    const names = channels.map((channel) => channel.ledValue).join(', ');
    notes.push(asFinding('discrete-led', keepResistorTexts({
      resistorValue,
      names,
      specifiedVf
    }), prompt));
  } else if (perColor) {
    for (const channel of channels) {
      const id = channel.color?.id ?? 'led';
      notes.push(asFinding(`discrete-led-${id}`, channel.calculation.summary, prompt));
    }
  } else if (resistorExplicit) {
    notes.push(asFinding('discrete-led', keepResistorTexts({
      resistorValue,
      color,
      ledValue,
      specifiedVf
    }), prompt));
  } else {
    notes.push(asFinding('discrete-led', calculation.summary, prompt));
  }
  if (ledPackage) {
    notes.push(asFinding('discrete-led-package', ledPackageTexts(ledPackage), prompt));
  }
  if (quantityCapped) {
    notes.push(asFinding('discrete-led-quantity-capped', {
      en: `Requested ${requestedCount} LEDs; the discrete LED generator is capped at ${count}. Extra LEDs were not generated.`,
      ko: `요청한 LED는 ${requestedCount}개이고, 이산 LED 생성기는 ${count}개까지입니다. 넘는 LED는 만들지 않았습니다.`
    }, prompt));
  }
  if (supplyAssumed) {
    notes.push(asFinding('discrete-led-supply-assumed', {
      en: 'No supply voltage was given, so the draft assumes 5V.',
      ko: '공급 전압이 없어서 5V로 가정했습니다.'
    }, prompt));
  }
  for (const item of unsupported) {
    notes.push(asFinding(`discrete-led-unsupported-${item.id}`, item, prompt));
  }
  if (vfRangeRaw && Number.isFinite(specifiedVf)) {
    notes.push(asFinding(
      'discrete-led-vf-range',
      conservativeVfMessage(vfRangeRaw, specifiedVf, vfRangeMin),
      prompt
    ));
  }
  return notes;
}

function refuseDiscreteLed({ code, texts, prompt, supplyVolts, supplyAssumed = false }) {
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
    reviewBlockers: [asFinding(code, texts, prompt)],
    reviewNotes: [],
    package: null
  };
}

export function parseDiscreteLedRequest(prompt) {
  const text = String(prompt ?? '').normalize('NFKC');
  if (!isSimpleDiscreteLedPrompt(text)) return null;
  if (text.length > MAX_DISCRETE_LED_PROMPT_CHARS) {
    return refuseDiscreteLed({
      code: 'discrete-led-prompt-too-long',
      prompt: text,
      supplyVolts: null,
      texts: promptTooLongMessage()
    });
  }
  const scan = classifyQuantities(text);
  const implausible = scan.tokens.find((token) => token.role === 'vf' && token.implausible === true);
  if (implausible) {
    return refuseDiscreteLed({
      code: 'discrete-led-implausible-vf',
      prompt: text,
      supplyVolts: null,
      texts: implausibleForwardMessage(implausible.implausibleValue ?? implausible.value)
    });
  }
  const supply = resolveDiscreteSupply(text, scan);
  if (supply.refused) return refuseDiscreteLed({ ...supply, prompt: text });
  const invalidCount = scan.tokens.find((token) => token.kind === 'count' && token.validCount !== true);
  if (invalidCount) {
    return refuseDiscreteLed({
      code: 'discrete-led-invalid-count',
      prompt: text,
      supplyVolts: supply.supplyVolts,
      supplyAssumed: supply.supplyAssumed === true,
      texts: invalidCountMessage(invalidCount)
    });
  }
  const tooSmall = scan.tokens.find((token) => (
    token.role === 'resistor' && Number.isFinite(token.value) && token.value < 1
  ));
  if (tooSmall) {
    return refuseDiscreteLed({
      code: 'discrete-led-resistor-too-small',
      prompt: text,
      supplyVolts: supply.supplyVolts,
      supplyAssumed: supply.supplyAssumed === true,
      texts: resistorTooSmallMessage(tooSmall)
    });
  }
  const invalidCurrent = scan.tokens.find((token) => (
    token.role === 'current' && (!(token.value > 0) || token.value > 100)
  ));
  if (invalidCurrent) {
    return refuseDiscreteLed({
      code: 'discrete-led-invalid-current',
      prompt: text,
      supplyVolts: supply.supplyVolts,
      supplyAssumed: supply.supplyAssumed === true,
      texts: invalidCurrentMessage(invalidCurrent)
    });
  }
  // A unitless number that is not a count and not a resistor stays ambiguous.
  const ambiguousNumber = scan.tokens.find((token) => token.kind === 'ambiguous');
  if (ambiguousNumber) {
    return refuseDiscreteLed({
      code: 'discrete-led-ambiguous-number',
      prompt: text,
      supplyVolts: supply.supplyVolts,
      supplyAssumed: supply.supplyAssumed === true,
      texts: ambiguousNumberMessage(ambiguousNumber)
    });
  }
  // Two resistor candidates are not a per-LED list. Ask instead of picking one.
  const resistors = scan.tokens
    .filter((token) => token.role === 'resistor' && token.value > 0)
    .sort((left, right) => left.start - right.start);
  if (resistors.length > 1) {
    return refuseDiscreteLed({
      code: 'discrete-led-ambiguous-resistor',
      prompt: text,
      supplyVolts: supply.supplyVolts,
      supplyAssumed: supply.supplyAssumed === true,
      texts: ambiguousResistorMessage(resistors)
    });
  }
  const supplyVolts = supply.supplyVolts;
  const supplyAssumed = supply.supplyAssumed === true;
  const ledPackage = scan.tokens.find((token) => token.role === 'package')?.packageCode ?? null;
  const forward = specifiedForward(scan.tokens);
  const specifiedVf = forward?.volts ?? null;
  const colors = findLedColors(text);
  const explicitCount = parseLedCount(text, scan.tokens);
  const perColor = colors.length > 1 && (explicitCount == null || explicitCount === colors.length);
  const requestedCount = perColor ? colors.length : Math.max(1, explicitCount ?? 1);
  const count = Math.min(MAX_DISCRETE_LEDS, requestedCount);
  const explicitOhms = explicitResistanceOhms(scan.tokens);
  const requestedCurrentMa = requestedCurrentMilliamps(scan.tokens);
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
      prompt: text,
      texts: belowForwardMessage(supplyVolts, channelColors[undersuppliedIndex], specifiedVf)
    });
  }
  const channels = channelColors.map((color) => channelForLed({
    color,
    supplyVolts,
    resistorExplicit,
    explicitOhms,
    specifiedVf,
    currentMa: requestedCurrentMa
  }));
  if (channels.some((channel) => !channel.resistorValue)) return null;
  const primary = channels[0];
  const unsupported = unsupportedLedFeatures(text);
  if (!perColor && colors.length > 1) {
    const names = colors.map((item) => item.prose).join(', ');
    const koNames = colors.map((item) => LED_COLOR_KO[item.id] ?? item.prose).join(', ');
    const koFirst = LED_COLOR_KO[colors[0].id] ?? colors[0].prose;
    unsupported.push({
      id: 'mixed-color',
      en: `Unsupported: multiple LED colors (${names}) in one draft are not supported. The draft uses ${colors[0].prose} for every LED.`,
      ko: `한 초안에 LED 색이 여러 개(${koNames})인 것은 지원하지 않습니다. 초안은 모든 LED에 ${koFirst}색을 사용합니다.`
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
    specifiedVf: Number.isFinite(specifiedVf) ? specifiedVf : null,
    requestedCurrentMa: Number.isFinite(requestedCurrentMa) ? requestedCurrentMa : null,
    package: ledPackage
  };
  const reviewNotes = buildDiscreteReviewNotes({
    ...parsed,
    prompt: text,
    ledPackage,
    vfRangeRaw: forward?.rangeRaw ?? null,
    vfRangeMin: forward?.rangeMin ?? null
  });
  const reviewWarnings = [];
  const headroom = headroomWarning(parsed.channels, supplyVolts, requestedCurrentMa, text);
  if (headroom) reviewWarnings.push(headroom);
  if (resistorExplicit) {
    const mismatch = currentMismatchWarning(parsed.channels, supplyVolts, requestedCurrentMa, text);
    if (mismatch) reviewWarnings.push(mismatch);
  }
  return {
    ...parsed,
    reviewNotes,
    reviewBlockers: [],
    reviewWarnings
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
      package: parsed.package ?? null,
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
    package: parsed.package ?? null,
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
