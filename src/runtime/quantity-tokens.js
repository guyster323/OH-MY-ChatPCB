import { isLoneMilliResistorSuffix, parseResistorOhms } from '../kicad/resistor-ohms.js';
import { normalizeMatchText } from './match-text.js';
import { clauseAround, textHasForeignMilliRole, textHasLengthObject } from '../workflow/resistor-vocabulary.js';

function compileRegExp(source, flags) {
  return new RegExp(source, flags);
}

// Quantities in an LED prompt. `value` is normalized: volts, ohms, milliamps,
// or a count. `unit` is the notation that was recognized (mV, VAC, ohm, …).
// A voltage range's value is its maximum.

const CONTEXT_WINDOW = 32;
const POT_WINDOW = 48;

const VOLTAGE_UNIT = '(?:[Vv][Oo][Ll][Tt][Ss]?|[Vv][Dd][Cc]|[Vv][Aa][Cc]|[Vv]|볼트)';
const VOLTAGE_NUMBER = '(\\d+(?:[.,]\\d+)?)';
const VOLTAGE_SIGN = '([+\\-\\u2212])?';
const VOLTAGE_MULT = '([kKmM])?';
const VOLTAGE_AC_TAIL = '(?:\\s*/\\s*[Aa]\\.?[Cc]\\.?)?';
const RANGE_SEPARATOR = '(?:-|~|–|—|～|〜|(?<![A-Za-z])[Tt][Oo](?![A-Za-z]))';
// A voltage may also begin immediately after "Vf", as in vf3.2v. The label
// itself stays outside the token so the forward-voltage binder can see it.
const VOLTAGE_START = '(?:(?<![\\w.])|(?<=\\b[Vv][Ff]))';

const POT_BEFORE = /(?:\bpots?\b|\bpotentiometers?\b|가변\s*저항)\s*$/i;
const POT_AFTER = /^[\s,.:;/-]*(?:Ω|옴|ohms?)?\s*(?:\bpots?\b|\bpotentiometers?\b|가변\s*저항)/i;
const ON_AT_BEFORE = /\b(?:on|at)\b(?:\s+(?:a|an|the))?\s*$/i;
// A bare integer is a resistor only when it is an E24 value of at least 100
// and not an LED package code. 10–99, non-E24 values, and fractions stay
// ambiguous unless ohm/resistor wording is beside them. Package codes, years
// ("2025년", "in 2025"), and pin names ("pin 13", "GPIO 13", "D13", "PA5")
// are consumed and are never resistors. "LED" itself is not resistor context.
// An "R=" / "R1" label is collected separately. Each resistor candidate is
// reported; more than one is refused by the discrete LED parser.
const RESISTOR_CONTEXT_WORD = '(?:\\bohms?\\b|\\bresistors?\\b|저항(?:값|은|는|이|가|을|를|의)?|(?<![가-힣])옴)';
const RESISTOR_CONTEXT_BEFORE = compileRegExp(`${RESISTOR_CONTEXT_WORD}\\s*$`, 'i');
const RESISTOR_CONTEXT_AFTER = compileRegExp(`^\\s*${RESISTOR_CONTEXT_WORD}`, 'i');

const PRIORITY = {
  range: 0,
  glued: 1,
  voltage: 2,
  rkm: 3,
  ohm: 4,
  suffix: 5,
  current: 6,
  // Years and pin names beat a bare number, and a year beats a package code
  // that shares its digits ("2019년").
  context: 6,
  // Same rank as tolerance. Both beat a count, so "5050 LED" is a package.
  package: 7,
  tolerance: 7,
  count: 8,
  bare: 9
};

// Two-digit E24 mantissas. 100, 220, 330, 470, 1000, and 4700 are in the series.
const E24_RESISTOR_MANTISSA = Object.freeze([
  10, 11, 12, 13, 15, 16, 18, 20, 22, 24, 27, 30, 33, 36, 39, 43, 47, 51, 56, 62, 68, 75, 82, 91
]);

// LED and chip packages. The only list: a package code is never a resistor,
// whether or not it sits beside the word LED.
export const LED_PACKAGE_CODES = Object.freeze([
  '0201', '0402', '0603', '0805', '1005', '1206', '1210', '1608', '1812', '2010',
  '2012', '2016', '2019', '2020', '2216', '2512', '2525', '2727', '2835', '3014',
  '3016', '3020', '3030', '3216', '3225', '3232', '3528', '3535', '3838', '4014',
  '4040', '5025', '5050', '5054', '5630', '5730', '5733', '6332', '7020', '7070'
]);
const LED_PACKAGE_SET = new Set(LED_PACKAGE_CODES);

export function isStandardE24Ohms(ohms) {
  if (!Number.isInteger(ohms) || ohms < 100) return false;
  let value = ohms;
  while (value >= 100 && value % 10 === 0) value /= 10;
  return E24_RESISTOR_MANTISSA.includes(value);
}

function isBareE24Resistor(rawNumber) {
  if (!/^[1-9]\d*$/.test(rawNumber)) return false;
  if (LED_PACKAGE_SET.has(rawNumber)) return false;
  return isStandardE24Ohms(Number(rawNumber));
}

const COUNT_WORD = {
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

// Anchored at a token boundary. An unanchored \d+ retries at every offset and
// is quadratic on a long digit run.
const UNCOVERED_VOLTAGE = [
  '(?<![A-Za-z0-9.,])\\d+(?:[.,]\\d+)?\\s*[kKmM]?\\s*(?:volts|volt|vdc|vac|v|볼트)[A-Za-z]+',
  '(?<![A-Za-z0-9.,])\\d+(?:,\\d+){2,}\\s*[kKmM]?\\s*(?:volts|volt|vdc|vac|v|볼트)(?![A-Za-z])',
  '(?<![A-Za-z0-9.,])(?:volts|volt|vdc|vac|kv|mv|볼트)(?![A-Za-z])'
];
const UNITLESS_VF_MIN = 0.5;
const UNITLESS_VF_MAX = 5;

// The value a labeled Vf would use, or either end of a Vf range. Null when every
// sample sits inside 0.5V to 5V. The first sample outside that window is returned
// so the refusal can name the value that failed.
function implausibleForwardVolts(token) {
  const samples = token.range ? [token.range.min, token.range.max] : [token.value];
  return samples.find((volts) => !(volts >= UNITLESS_VF_MIN && volts <= UNITLESS_VF_MAX)) ?? null;
}

// Longer labels first. "forward voltage" must win over the bare word "forward",
// and "순방향 전압" over "순방향". A following voltage wins when only space,
// ":", "=", or "of" separates it, so "5V forward voltage 3.2V" keeps 3.2V as
// Vf. "2V forward" still binds the preceding value because of the comma after.
const FORWARD_LABELS = [
  /forward\s+voltage(?:\s+of)?/gi,
  /순방향\s*전압/g,
  // "vf3.2v" has no word boundary between the label and the digits.
  /\bvf(?=\b|\d)(?:\s*[=:])?/gi,
  /\bforward\b/gi,
  /순방향/g
];

const SUPPLY_KEYWORDS = [
  /\bsupply\b/gi,
  /\bpower\b/gi,
  /\bbattery\b/gi,
  /\brail\b/gi,
  /전원/g,
  /배터리/g
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

function writtenVoltageUnit(multiplier, unitText) {
  if (/vac/i.test(unitText)) return 'VAC';
  if (/vdc/i.test(unitText)) return 'VDC';
  if (multiplier === 'm') return 'mV';
  if (multiplier === 'k' || multiplier === 'K') return 'kV';
  if (multiplier === 'M') return 'MV';
  return 'V';
}

function trailingSupplyKind(prompt, end) {
  const after = prompt.slice(end, end + 12);
  if (/^\s*a\.?c\.?\s*\/\s*d\.?c\.?\b/i.test(after)) return null;
  if (/^\s*d\.?c\.?\s*\/\s*a\.?c\.?\b/i.test(after)) return null;
  if (/^\s*a\.?c\.?\b/i.test(after)) return 'ac';
  if (/^\s*d\.?c\.?\b/i.test(after)) return 'dc';
  return null;
}

// Every resistor form goes through parseResistorOhms. A lone m is refused
// there (4m7 and 4.7m are not values). Zero is null, so 0Ω is not a token.
function resistorOhmsNumber(text) {
  const parsed = parseResistorOhms(text);
  if (parsed == null) return null;
  const ohms = Number(parsed);
  return Number.isFinite(ohms) ? ohms : null;
}

// "1kR" writes the ohm unit after the multiplier. The parser sees that R as a
// second suffix, so it is stripped only when the whole token does not parse.
function resistorOhmsFromSuffix(text) {
  const direct = resistorOhmsNumber(text);
  if (direct != null) return direct;
  const stripped = String(text).replace(/\s*[rR]$/u, '');
  if (stripped === String(text)) return null;
  return resistorOhmsNumber(stripped);
}

function invalidResistorCandidate(priority, start, end, raw) {
  return {
    priority,
    start,
    end,
    invalid: true,
    reason: isLoneMilliResistorSuffix(raw) ? 'milli' : 'invalid',
    token: null
  };
}

function isPotentiometer(prompt, start, end) {
  const before = prompt.slice(Math.max(0, start - POT_WINDOW), start);
  const after = prompt.slice(end, end + POT_WINDOW);
  return POT_BEFORE.test(before) || POT_AFTER.test(after);
}

function bareHasResistorContext(prompt, start, end) {
  const before = prompt.slice(Math.max(0, start - 24), start);
  const after = prompt.slice(end, end + 24);
  return RESISTOR_CONTEXT_BEFORE.test(before) || RESISTOR_CONTEXT_AFTER.test(after);
}

// A lone m (1m, 4.7m) is a resistor only when the token itself is bound:
// the whole prompt, an attached Ω/ohm/옴, the word resistor/저항/抵抗 against
// the token, or the object of a resistor edit ("to 4.7m", "4.7m으로").
// 4m7 and 2m2 stay resistor notations wherever they appear. "1 m cable" and
// "every 5m" are length and time even when Ω or 저항 sits nearby.
// "to 1m" / "1m로" is a resistor only when that edit's object is a resistor
// or an R-ref in the same clause. A cable, wire, or length object is not.
// A bound milli that names another role (shunt, sense, pull-up) is not the LED resistor.
const MILLI_CUE_BEFORE = /(?:저항|抵抗|\bresistors?\b|(?<![가-힣])옴|\bohms?\b|Ω)\s*$/iu;
const MILLI_CUE_AFTER = /^\s*(?:저항|抵抗|\bresistors?\b|(?<![가-힣])옴|\bohms?\b|Ω)/iu;
const MILLI_EDIT_BEFORE = /(?:->|→|=|\bto\b)\s*$/iu;
const MILLI_EDIT_AFTER = /^\s*(?:으로|로(?!부터|서|써)|に)/u;
const MILLI_RESISTOR_OBJECT = /저항|抵抗|\bresistor\b|\bR\d+\b/iu;

// Comma, "and", and "그리고" close a clause. A comma between digits (1,000) does not.
export function clauseAroundToken(prompt, start, end) {
  return clauseAround(prompt, start, end);
}

function milliEditObjectIsResistor(text, start, end) {
  const clause = clauseAroundToken(text, start, end);
  if (textHasLengthObject(clause)) return false;
  return MILLI_RESISTOR_OBJECT.test(clause);
}

export function loneMilliCountsAsResistor(prompt, start, end) {
  const text = String(prompt ?? '');
  const slice = text.slice(start, end);
  const compact = slice.replace(/\s+/g, '').replace(/(?:Ω|옴|ohms?)$/iu, '');
  if (/^\d+m\d+$/i.test(compact)) return true;
  if (/(?:Ω|옴|ohms?)\s*$/iu.test(slice)) return true;
  const before = text.slice(0, start);
  const after = text.slice(end);
  if (before.trim() === '' && after.trim() === '') return true;
  if (MILLI_CUE_BEFORE.test(before) || MILLI_CUE_AFTER.test(after)) return true;
  if (!(MILLI_EDIT_BEFORE.test(before) || MILLI_EDIT_AFTER.test(after))) return false;
  return milliEditObjectIsResistor(text, start, end);
}

// The clause that holds the token names a resistor role other than the LED series resistor.
export function milliOwnedByForeignRole(prompt, start, end) {
  const text = String(prompt ?? '');
  let from = 0;
  const spans = [];
  for (const mark of text.matchAll(/[,;.!?。！？]/gu)) {
    spans.push([from, mark.index]);
    from = mark.index + mark[0].length;
  }
  spans.push([from, text.length]);
  for (const [spanStart, spanEnd] of spans) {
    if (end <= spanStart || start >= spanEnd) continue;
    if (textHasForeignMilliRole(text.slice(spanStart, spanEnd))) return true;
  }
  return false;
}

function milliResistorFault(prompt, start, end) {
  return loneMilliCountsAsResistor(prompt, start, end) && !milliOwnedByForeignRole(prompt, start, end);
}

function pushLoneMilli(candidates, prompt, start, end, priority) {
  if (milliResistorFault(prompt, start, end)) {
    candidates.push(invalidResistorCandidate(priority, start, end, prompt.slice(start, end)));
    return;
  }
  candidates.push({
    priority,
    start,
    end,
    invalid: false,
    token: contextToken(prompt, start, end, 'length')
  });
}

function pushMatch(candidates, match, priority, token, invalid = false) {
  const start = match.index ?? 0;
  candidates.push({
    priority,
    start,
    end: start + match[0].length,
    token,
    invalid
  });
}

function voltageToken(prompt, start, end, volts, multiplier, unitText) {
  let unit = writtenVoltageUnit(multiplier, unitText);
  const raw = prompt.slice(start, end);
  let ac = unit === 'VAC' || /\/\s*a\.?c/i.test(raw);
  let dc = unit === 'VDC';
  if (unit === 'V' || unit === 'mV' || unit === 'kV' || unit === 'MV') {
    const trailing = trailingSupplyKind(prompt, end);
    if (trailing === 'ac') ac = true;
    if (trailing === 'dc') dc = true;
  }
  if (ac && unit === 'V' && /\/\s*a\.?c/i.test(raw)) unit = 'VAC';
  return {
    value: roundVolts(volts),
    unit,
    raw,
    start,
    end,
    kind: 'voltage',
    form: 'voltage',
    range: null,
    ac,
    dc,
    pot: false
  };
}

function collectRanges(prompt, candidates) {
  const pattern = compileRegExp(
    `(?<![\\w.])${VOLTAGE_NUMBER}(?:\\s*${VOLTAGE_UNIT})?\\s*${RANGE_SEPARATOR}\\s*${VOLTAGE_NUMBER}\\s*${VOLTAGE_MULT}\\s*(${VOLTAGE_UNIT})${VOLTAGE_AC_TAIL}(?![A-Za-z])`,
    'g'
  );
  for (const match of prompt.matchAll(pattern)) {
    const multiplier = match[3] ?? '';
    const scale = voltageScale(multiplier);
    const low = parseVoltageNumber(match[1]);
    const high = parseVoltageNumber(match[2]);
    if (low == null || high == null || scale == null) {
      pushMatch(candidates, match, PRIORITY.range, null, true);
      continue;
    }
    const min = roundVolts(Math.min(low, high) * scale);
    const max = roundVolts(Math.max(low, high) * scale);
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const token = voltageToken(prompt, start, end, max, multiplier, match[4]);
    token.form = 'range';
    token.range = { min, max };
    token.value = max;
    candidates.push({ priority: PRIORITY.range, start, end, token, invalid: false });
  }
}

function collectGlued(prompt, candidates) {
  const pattern = /(?<![\w.])([+\-\u2212])?(\d+)[Vv](\d)(?![0-9kK])/g;
  for (const match of prompt.matchAll(pattern)) {
    const negative = match[1] === '-' || match[1] === '\u2212';
    const volts = roundVolts(Number(`${match[2]}.${match[3]}`) * (negative ? -1 : 1));
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const token = voltageToken(prompt, start, end, volts, '', 'V');
    token.form = 'glued';
    token.unit = 'V';
    candidates.push({ priority: PRIORITY.glued, start, end, token, invalid: false });
  }
}

function collectVoltages(prompt, candidates) {
  const pattern = compileRegExp(
    `${VOLTAGE_START}${VOLTAGE_SIGN}${VOLTAGE_NUMBER}\\s*${VOLTAGE_MULT}\\s*(${VOLTAGE_UNIT})${VOLTAGE_AC_TAIL}(?![A-Za-z])`,
    'g'
  );
  for (const match of prompt.matchAll(pattern)) {
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
      candidates.push({ priority: PRIORITY.voltage, start: index, end, token: null, invalid: true });
      continue;
    }
    const volts = roundVolts(parsed * scale) * (negative ? -1 : 1);
    const token = voltageToken(prompt, index, end, Math.abs(volts), match[3], match[4]);
    token.value = roundVolts(volts);
    token.raw = prompt.slice(index, end);
    candidates.push({ priority: PRIORITY.voltage, start: index, end, token, invalid: false });
  }
}

function isDesignatorAssignment(prompt, end) {
  const after = prompt.slice(end);
  if (/^\s*=/.test(after)) return true;
  // "R1 330" assigns a value. "R47 5V" does not: the next number wears a unit.
  return /^\s+\d+(?:\.\d+)?(?![\w.])/.test(after);
}

function collectRkm(prompt, candidates) {
  const pattern = /(?<![\w.])(\d+)([rRkKmM])(\d+)(?![\w])/g;
  for (const match of prompt.matchAll(pattern)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const ohms = resistorOhmsNumber(match[0]);
    // 4m7 and 2m2 do not parse. Cover the span so the digits are not a bare value.
    // A shunt or sense milli is not the LED resistor, so it is not a fault.
    if (ohms == null) {
      if (isLoneMilliResistorSuffix(match[0])) pushLoneMilli(candidates, prompt, start, end, PRIORITY.rkm);
      else candidates.push(invalidResistorCandidate(PRIORITY.rkm, start, end, match[0]));
      continue;
    }
    candidates.push({
      priority: PRIORITY.rkm,
      start,
      end,
      invalid: false,
      token: resistanceToken(prompt, start, end, ohms, 'rkm')
    });
  }
  // "R47" is 0.47Ω. "R1=330" and "R1 330" are designators, not 0.1Ω.
  const leading = /(?<![\w.])[rR](\d+)(?![\w])/g;
  for (const match of prompt.matchAll(leading)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (isDesignatorAssignment(prompt, end)) continue;
    const ohms = resistorOhmsNumber(match[0]);
    if (ohms == null || ohms < 0) continue;
    candidates.push({
      priority: PRIORITY.rkm,
      start,
      end,
      invalid: false,
      token: resistanceToken(prompt, start, end, ohms, 'rkm')
    });
  }
}

// A leading sign stays inside the resistor span. Dropping it would read -10Ω as 10Ω.
// ± before a percent is tolerance, so that span is left for collectTolerance.
// Voltage, current, and counts start on the same sign and outrank this span.
function collectSignedResistors(prompt, candidates) {
  const pattern = compileRegExp(String.raw`(?<![\p{L}\p{N}_.+])[+\-\u2212\u2013\uFF0D\u00B1]\s*(?:${[
    String.raw`\d+(?:\.\d+)?\s*(?:meg|[kKmMrR])?\s*(?:Ω|옴|ohms?)`,
    String.raw`\d+[rRkKmM]\d+`,
    String.raw`\d+(?:\.\d+)?\s*meg`,
    String.raw`\d+(?:\.\d+)?\s*[rRkKmM]`,
    String.raw`\d+(?:\.\d+)?(?!\s*%)`
  ].join('|')})(?![A-Za-z])`, 'giu');
  for (const match of prompt.matchAll(pattern)) {
    const start = match.index ?? 0;
    candidates.push({
      priority: PRIORITY.bare,
      start,
      end: start + match[0].length,
      invalid: true,
      reason: 'invalid',
      token: null
    });
  }
}

function collectLabeledResistor(prompt, candidates) {
  // The designator stays inside the token so "R1" is not its own bare number.
  const pattern = /(?<![\w.])[Rr](\d+)?(?:\s*=\s*|\s+)(\d+(?:\.\d+)?)(?![\w.])/g;
  for (const match of prompt.matchAll(pattern)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const ohms = resistorOhmsNumber(match[2]);
    // "R1=1.000" is ambiguous. Cover the span so a bare number cannot read it as 1Ω.
    if (ohms == null) {
      candidates.push(invalidResistorCandidate(PRIORITY.rkm, start, end, match[2]));
      continue;
    }
    if (ohms < 0) continue;
    candidates.push({
      priority: PRIORITY.rkm,
      start,
      end,
      invalid: false,
      token: resistanceToken(prompt, start, end, ohms, 'label')
    });
  }
}

function collectOhm(prompt, candidates) {
  // "vf330Ω" keeps the Vf label outside the token. The ohm value is a resistor.
  const pattern = /(?<![\w.])(?:[Vv][Ff](?=\d))?(\d+(?:\.\d+)?)\s*([rRkKmM])?\s*(?:옴|ohms?|Ω)/gi;
  for (const match of prompt.matchAll(pattern)) {
    const matchStart = match.index ?? 0;
    const end = matchStart + match[0].length;
    const start = matchStart + match[0].indexOf(match[1]);
    const ohms = resistorOhmsNumber(prompt.slice(start, end));
    // 0Ω does not parse, so the span is unparseable instead of a 0Ω token.
    // "1.000 ohm" does not parse. The span stays covered so a bare 1.000 is not 1Ω.
    if (ohms == null) {
      const raw = prompt.slice(start, end);
      if (isLoneMilliResistorSuffix(raw)) pushLoneMilli(candidates, prompt, start, end, PRIORITY.ohm);
      else candidates.push(invalidResistorCandidate(PRIORITY.ohm, start, end, raw));
      continue;
    }
    if (ohms < 0) continue;
    candidates.push({
      priority: PRIORITY.ohm,
      start,
      end,
      invalid: false,
      token: resistanceToken(prompt, start, end, ohms, 'ohm')
    });
  }
}

// "4,7k" must not be read as 7k. A comma-grouped number plus a suffix or an
// ohm unit covers the whole span, including the digits the suffix matcher
// would otherwise start after the comma.
function collectGroupedComma(prompt, candidates) {
  const pattern = /(?<![\w.])\d{1,3}(?:,\d+)+(?:\.\d+)?(?:\s*(?:meg|[rRkKmM])(?:\s*(?:Ω|옴|ohms?))?|\s*(?:Ω|옴|ohms?))(?![A-Za-z])/giu;
  for (const match of prompt.matchAll(pattern)) {
    const start = match.index ?? 0;
    candidates.push(invalidResistorCandidate(PRIORITY.suffix, start, start + match[0].length, match[0]));
  }
}

function collectSuffix(prompt, candidates) {
  const pattern = /(?<![\w.])(\d+(?:\.\d+)?)\s*([rRkKmM])(?:\s*[rR]\b|\b)(?![A-Za-z])/g;
  for (const match of prompt.matchAll(pattern)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const ohms = resistorOhmsFromSuffix(match[0]);
    if (ohms == null) {
      // A length or a time is not a milli fault. A bound milli ("1m resistor",
      // "to 4.7m") still is, unless that clause names another resistor role.
      if (isLoneMilliResistorSuffix(match[0])) pushLoneMilli(candidates, prompt, start, end, PRIORITY.suffix);
      else candidates.push(invalidResistorCandidate(PRIORITY.suffix, start, end, match[0]));
      continue;
    }
    if (ohms < 0) continue;
    candidates.push({
      priority: PRIORITY.suffix,
      start,
      end,
      invalid: false,
      token: resistanceToken(prompt, start, end, ohms, 'suffix')
    });
  }
}

function resistanceToken(prompt, start, end, ohms, form) {
  return {
    value: ohms,
    unit: 'ohm',
    raw: prompt.slice(start, end),
    start,
    end,
    kind: 'resistance',
    form,
    range: null,
    ac: false,
    dc: false,
    pot: isPotentiometer(prompt, start, end)
  };
}

function roundMilliamps(value) {
  return Math.round(value * 1e6) / 1e6;
}

function scaleCurrent(amount, unitText) {
  const unit = String(unitText).replace(/\s+/g, '').toLowerCase();
  if (unit.includes('밀리') || unit.includes('milli') || unit.startsWith('m')) {
    return { milliamps: roundMilliamps(amount), unit: 'mA' };
  }
  // U+00B5 MICRO SIGN and U+03BC GREEK SMALL MU. NFKC folds the micro sign to mu.
  if (unit.startsWith('u') || unit.startsWith('\u00B5') || unit.startsWith('\u03BC')) {
    return { milliamps: roundMilliamps(amount / 1000), unit: 'uA' };
  }
  return { milliamps: roundMilliamps(amount * 1000), unit: 'A' };
}

function collectCurrent(prompt, candidates) {
  // Hangul is not a word character, so \b never matches after 밀리암페어.
  // Bare "A" is last so "mA" and "uA" keep their prefixes. 0mA and a leading
  // minus stay currents so the draft can refuse them.
  const boundary = '(?![A-Za-z0-9_])';
  const unit = [
    'milli\\s*amps?',
    'milliamps?',
    'milliamperes?',
    '밀리\\s*암페어',
    '(?:u|\\u00B5|\\u03BC)\\s*a',
    'm\\s*a',
    'amperes?',
    'amps?',
    '암페어',
    'a'
  ].join('|');
  const pattern = compileRegExp(`(?<![\\w.])([+\\-\\u2212]\\s*)?(\\d+(?:\\.\\d+)?)\\s*(${unit})${boundary}`, 'gi');
  for (const match of prompt.matchAll(pattern)) {
    const amount = Number(match[2]);
    if (!Number.isFinite(amount) || amount < 0) continue;
    const negative = /^[-\u2212]/.test(match[1] ?? '');
    const scaled = scaleCurrent(amount, match[3]);
    pushCurrent(candidates, prompt, match, negative ? -scaled.milliamps : scaled.milliamps, scaled.unit);
  }
}

function pushCurrent(candidates, prompt, match, milliamps, unit) {
  if (!Number.isFinite(milliamps)) return;
  const start = match.index ?? 0;
  const end = start + match[0].length;
  candidates.push({
    priority: PRIORITY.current,
    start,
    end,
    invalid: false,
    token: {
      value: milliamps,
      unit,
      raw: prompt.slice(start, end),
      start,
      end,
      kind: 'current',
      form: 'current',
      range: null,
      ac: false,
      dc: false,
      pot: false
    }
  });
}

function parseCountMagnitude(raw) {
  if (/^\d+$/.test(raw)) return Number(raw);
  if (/^\d+\.\d+$/.test(raw)) return Number(raw);
  const comma = /^(\d+),(\d+)$/.exec(raw);
  if (comma && (comma[2].length === 1 || comma[2].length === 2)) {
    return Number(`${comma[1]}.${comma[2]}`);
  }
  return null;
}

function pushCount(candidates, prompt, match, sign, rawNumber) {
  const start = match.index ?? 0;
  const end = start + match[0].length;
  const negative = sign === '-' || sign === '\u2212';
  const magnitude = parseCountMagnitude(rawNumber);
  const validCount = !negative && /^\d+$/.test(rawNumber) && magnitude >= 1;
  candidates.push({
    priority: PRIORITY.count,
    start,
    end,
    invalid: false,
    token: {
      value: magnitude == null ? 0 : magnitude * (negative ? -1 : 1),
      unit: 'count',
      raw: prompt.slice(start, end),
      start,
      end,
      kind: 'count',
      form: 'count',
      range: null,
      ac: false,
      dc: false,
      pot: false,
      validCount,
      countText: `${negative ? '-' : ''}${rawNumber}`
    }
  });
}

function collectTolerance(prompt, candidates) {
  // "330Ω±5%" and "4k7 5%" keep the resistor. The percent is not a bare number.
  const pattern = /(?<![\w.])(?:±\s*)?(\d+(?:\.\d+)?)\s*%/g;
  for (const match of prompt.matchAll(pattern)) {
    const percent = Number(match[1]);
    if (!Number.isFinite(percent)) continue;
    const start = match.index ?? 0;
    const end = start + match[0].length;
    candidates.push({
      priority: PRIORITY.tolerance,
      start,
      end,
      invalid: false,
      token: {
        value: percent,
        unit: '%',
        raw: prompt.slice(start, end),
        start,
        end,
        kind: 'tolerance',
        form: 'tolerance',
        range: null,
        ac: false,
        dc: false,
        pot: false
      }
    });
  }
}

const KOREAN_COUNT_WORDS = [
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

function candidateOverlaps(candidates, start, end) {
  return candidates.some((item) => start < item.end && end > item.start);
}

function pushWordCountToken(candidates, prompt, start, end, value) {
  candidates.push({
    priority: PRIORITY.count,
    start,
    end,
    invalid: false,
    token: {
      value,
      unit: 'count',
      raw: prompt.slice(start, end),
      start,
      end,
      kind: 'count',
      form: 'word',
      range: null,
      ac: false,
      dc: false,
      pot: false,
      validCount: Number.isInteger(value) && value >= 1,
      countText: String(value)
    }
  });
}

// "three red and green LEDs" keeps up to three words between the number and
// LEDs. A supply inside that window stays a voltage token: the count then
// covers only the number word. "two pcs LED" is already a pcs count.
function collectEnglishWordCounts(prompt, candidates) {
  const words = Object.keys(COUNT_WORD).join('|');
  // "two and a half LEDs" is a fractional count, same as "2.5 LEDs". The
  // integer word matcher would otherwise keep "two" and drop the half.
  const fractional = compileRegExp(`\\b(${words})\\s+and\\s+(?:a|one)\\s+half\\s+leds?\\b`, 'i');
  const fraction = fractional.exec(prompt);
  if (fraction) {
    const value = COUNT_WORD[fraction[1].toLowerCase()] + 0.5;
    const start = fraction.index ?? 0;
    pushWordCountToken(candidates, prompt, start, start + fraction[0].length, value);
    return true;
  }
  const englishLed = compileRegExp(`\\b(${words})\\b(?:\\s+\\w+){0,3}\\s+leds?\\b`, 'i');
  const english = englishLed.exec(prompt);
  if (!english) return false;
  const value = COUNT_WORD[english[1].toLowerCase()];
  const fullStart = english.index ?? 0;
  const fullEnd = fullStart + english[0].length;
  const wordEnd = fullStart + english[1].length;
  if (!candidateOverlaps(candidates, fullStart, fullEnd)) {
    pushWordCountToken(candidates, prompt, fullStart, fullEnd, value);
  } else if (!candidateOverlaps(candidates, fullStart, wordEnd)) {
    pushWordCountToken(candidates, prompt, fullStart, wordEnd, value);
  }
  return true;
}

// Longer Korean number words win, matching the previous circuit-spec search.
// "하나와" is not a count: the word has to sit next to 개 and an LED word.
function collectKoreanWordCounts(prompt, candidates) {
  const words = [...KOREAN_COUNT_WORDS].sort((left, right) => right[0].length - left[0].length);
  for (const [word, value] of words) {
    const after = compileRegExp(`(?:leds?|엘이디|발광)[^\\d]{0,12}(${word}\\s*개)`, 'i');
    const before = compileRegExp(`(${word}\\s*개)(?:의)?\\s*(?:leds?|엘이디|발광)`, 'i');
    const afterMatch = after.exec(prompt);
    const beforeMatch = before.exec(prompt);
    const match = afterMatch ?? beforeMatch;
    if (!match) continue;
    const raw = match[1];
    const start = afterMatch
      ? match.index + match[0].length - raw.length
      : match.index;
    pushWordCountToken(candidates, prompt, start, start + raw.length, value);
    return;
  }
}

function collectCounts(prompt, candidates) {
  // pcs/pc/ea/개/×/x are counts in either order ("x3", "3x", "3 pcs", "3ea").
  // A fraction, zero, or a leading minus stays a count token so the draft can
  // refuse it. Singular "LED" stays integer-only: "3.2 LED" is not 2 LEDs.
  // Plural "2.5 LEDs" and "2,5 LEDs" are fractional counts. "LEDx3" / "LED×3"
  // glue the marker to the word. Number words ("three LEDs", "two pcs",
  // "세 개") are count tokens too.
  const led = /(?<![\w.,+\-\u2212])([+\-\u2212])?(\d+)\s*(?:[x\u00D7]\s*)?(?:leds?|엘이디|발광(?:\s*다이오드)?)\b/gi;
  const fractionalLeds = /(?<![\w.,+\-\u2212])([+\-\u2212])?(\d+[.,]\d+)\s*leds\b/gi;
  const marker = /(?<![\w.,+\-\u2212])([+\-\u2212])?(\d+(?:[.,]\d+)?)\s*(?:개|(?:pcs|pc|ea)(?![A-Za-z])|[x\u00D7](?![\w.]))/gi;
  const prefix = /(?<![\w.])[x\u00D7]\s*([+\-\u2212])?(\d+(?:[.,]\d+)?)(?![\w.])/gi;
  const gluedLed = /(?<![A-Za-z0-9])leds?[x\u00D7](\d+)(?![\w.])/gi;
  const words = Object.keys(COUNT_WORD).join('|');
  const wordPcs = compileRegExp(`(?<![A-Za-z])(${words})\\s+pcs(?![A-Za-z])`, 'gi');
  for (const match of prompt.matchAll(led)) pushCount(candidates, prompt, match, match[1], match[2]);
  for (const match of prompt.matchAll(fractionalLeds)) pushCount(candidates, prompt, match, match[1], match[2]);
  for (const match of prompt.matchAll(marker)) pushCount(candidates, prompt, match, match[1], match[2]);
  for (const match of prompt.matchAll(prefix)) pushCount(candidates, prompt, match, match[1], match[2]);
  for (const match of prompt.matchAll(gluedLed)) pushCount(candidates, prompt, match, '', match[1]);
  for (const match of prompt.matchAll(wordPcs)) {
    const value = COUNT_WORD[match[1].toLowerCase()];
    const start = match.index ?? 0;
    const end = start + match[0].length;
    candidates.push({
      priority: PRIORITY.count,
      start,
      end,
      invalid: false,
      token: {
        value,
        unit: 'count',
        raw: prompt.slice(start, end),
        start,
        end,
        kind: 'count',
        form: 'count',
        range: null,
        ac: false,
        dc: false,
        pot: false,
        validCount: Number.isInteger(value) && value >= 1,
        countText: String(value)
      }
    });
  }
  // English number words win over Korean ones, as they did before this moved
  // out of circuit-spec. A pcs token such as "two pcs" is already collected.
  if (!collectEnglishWordCounts(prompt, candidates)) collectKoreanWordCounts(prompt, candidates);
}

// "Vf=3.2", "Vf 3.2", and glued "vf3.2" are a forward voltage when labeled Vf.
// The same 0.5V to 5V window is applied to every Vf form in classifyQuantities.
// Outside that window the value is refused, not kept as a resistor. Unitless
// "Vf 0" is inside the window check (implausible). A trailing Ω/ohm/옴 is not Vf.
function collectUnitlessForward(prompt, candidates) {
  const pattern = /\bvf(?=\d|\b)(?:\s*[=:]\s*|\s+)?(\d+(?:[.,]\d+)?)(?![\w.]|\s*(?:[rRkKmM]\s*)?(?:옴|ohms?|Ω))/gi;
  for (const match of prompt.matchAll(pattern)) {
    const rawNumber = match[1];
    const volts = parseVoltageNumber(rawNumber);
    if (volts == null || volts < 0) continue;
    const start = (match.index ?? 0) + match[0].length - rawNumber.length;
    const end = start + rawNumber.length;
    const token = voltageToken(prompt, start, end, volts, '', 'V');
    token.unit = 'V';
    token.form = 'voltage';
    token.unitless = true;
    token.implausible = !(volts >= UNITLESS_VF_MIN && volts <= UNITLESS_VF_MAX);
    candidates.push({ priority: PRIORITY.voltage, start, end, token, invalid: false });
  }
}

function ambiguousNumberToken(prompt, start, end, value) {
  return {
    value,
    unit: 'bare',
    raw: prompt.slice(start, end),
    start,
    end,
    kind: 'ambiguous',
    form: 'bare',
    range: null,
    ac: false,
    dc: false,
    pot: false
  };
}

function contextToken(prompt, start, end, form) {
  return {
    value: null,
    unit: form,
    raw: prompt.slice(start, end),
    start,
    end,
    kind: 'context',
    form,
    range: null,
    ac: false,
    dc: false,
    pot: false
  };
}

function pushContext(candidates, prompt, match, form) {
  const start = match.index ?? 0;
  const end = start + match[0].length;
  candidates.push({
    priority: PRIORITY.context,
    start,
    end,
    invalid: false,
    token: contextToken(prompt, start, end, form)
  });
}

// Years and pin names own their digits. "in 2200" and "pin 330" are not
// resistors even when the number is an E24 value. "5V" after a pin name stays
// a voltage because the digit is followed by a unit letter.
function collectContext(prompt, candidates) {
  const years = [
    /(?<![\w.])\d{4}\s*년/g,
    /(?<![A-Za-z])in\s+\d{4}(?![\w.])/gi
  ];
  const pins = [
    /(?<![A-Za-z])pins?\s*\d+(?![\w.])/gi,
    /(?<![A-Za-z])GPIO\s*\d+(?![\w.])/gi,
    /(?<![A-Za-z])D\d+(?![\w.])/g,
    /(?<![A-Za-z])P[A-Za-z]\d+(?![\w.])/g
  ];
  for (const pattern of years) {
    for (const match of prompt.matchAll(pattern)) pushContext(candidates, prompt, match, 'year');
  }
  for (const pattern of pins) {
    for (const match of prompt.matchAll(pattern)) pushContext(candidates, prompt, match, 'pin');
  }
  // Attached and spaced length units. A bare "m" stays on the milli path.
  const lengths = /(?<![\w.])\d+(?:\.\d+)?\s*(?:cm|mm|km|ft|in)(?![A-Za-z])/gi;
  for (const match of prompt.matchAll(lengths)) pushContext(candidates, prompt, match, 'length');
}

function collectPackages(prompt, candidates) {
  const pattern = /(?<![\w.])(\d{4})(?![\w.])/g;
  for (const match of prompt.matchAll(pattern)) {
    const code = match[1];
    if (!LED_PACKAGE_SET.has(code)) continue;
    const start = match.index ?? 0;
    const end = start + code.length;
    candidates.push({
      priority: PRIORITY.package,
      start,
      end,
      invalid: false,
      token: {
        value: Number(code),
        unit: 'package',
        raw: code,
        start,
        end,
        kind: 'package',
        form: 'package',
        range: null,
        ac: false,
        dc: false,
        pot: false,
        packageCode: code
      }
    });
  }
}

function collectBare(prompt, candidates) {
  const pattern = /(?<![\w.])(\d+\.\d+|\d+)(?![\w]|\.\d)/g;
  for (const match of prompt.matchAll(pattern)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const rawNumber = match[1];
    const ohms = Number(rawNumber);
    // Bare 0 is unparseable. Dropping it would leave the calculated default.
    if (!(ohms > 0)) {
      if (ohms === 0) {
        candidates.push({
          priority: PRIORITY.bare,
          start,
          end,
          invalid: true,
          reason: 'invalid',
          token: null
        });
      }
      continue;
    }
    if (LED_PACKAGE_SET.has(rawNumber)) continue;
    const asResistor = bareHasResistorContext(prompt, start, end) || isBareE24Resistor(rawNumber);
    if (asResistor) {
      const parsed = resistorOhmsNumber(rawNumber);
      if (parsed == null) {
        candidates.push({ priority: PRIORITY.bare, start, end, invalid: true, token: null });
        continue;
      }
      if (!(parsed > 0)) continue;
      candidates.push({
        priority: PRIORITY.bare,
        start,
        end,
        invalid: false,
        token: resistanceToken(prompt, start, end, parsed, 'bare')
      });
      continue;
    }
    const token = ambiguousNumberToken(prompt, start, end, ohms);
    candidates.push({
      priority: PRIORITY.bare,
      start,
      end,
      invalid: false,
      token
    });
  }
}

function resolveOverlaps(candidates) {
  const sorted = [...candidates].sort((left, right) => (
    left.start - right.start || left.priority - right.priority || (right.end - left.end)
  ));
  const accepted = [];
  for (const candidate of sorted) {
    const overlaps = accepted.some((item) => candidate.start < item.end && candidate.end > item.start);
    if (overlaps) continue;
    accepted.push(candidate);
  }
  return accepted;
}

function hasUncoveredVoltage(prompt, spans) {
  return UNCOVERED_VOLTAGE.some((source) => {
    for (const match of prompt.matchAll(compileRegExp(source, 'gi'))) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      const covered = spans.some((span) => start >= span.start && end <= span.end);
      if (!covered) return true;
    }
    return false;
  });
}

export function tokenizeQuantities(prompt) {
  const text = normalizeMatchText(prompt);
  const candidates = [];
  collectRanges(text, candidates);
  collectGlued(text, candidates);
  collectVoltages(text, candidates);
  collectRkm(text, candidates);
  collectLabeledResistor(text, candidates);
  collectOhm(text, candidates);
  collectGroupedComma(text, candidates);
  collectSuffix(text, candidates);
  collectCurrent(text, candidates);
  collectTolerance(text, candidates);
  collectCounts(text, candidates);
  collectPackages(text, candidates);
  collectContext(text, candidates);
  collectUnitlessForward(text, candidates);
  collectSignedResistors(text, candidates);
  collectBare(text, candidates);

  const accepted = resolveOverlaps(candidates);
  const tokens = [];
  let unparseable = false;
  let resistorFault = null;
  for (const item of accepted) {
    if (item.invalid) {
      unparseable = true;
      if (item.reason === 'milli') resistorFault = 'milli';
      else if (item.reason === 'invalid' && resistorFault !== 'milli') resistorFault = 'invalid';
    } else if (item.token) tokens.push(item.token);
  }
  if (hasUncoveredVoltage(text, accepted)) unparseable = true;
  tokens.sort((left, right) => left.start - right.start);
  return { tokens, unparseable, resistorFault };
}

function keywordHits(prompt, sources, role) {
  const found = [];
  for (const source of sources) {
    const flags = source.flags.includes('g') ? source.flags : `${source.flags}g`;
    for (const match of prompt.matchAll(compileRegExp(source.source, flags))) {
      const start = match.index ?? 0;
      found.push({ role, start, end: start + match[0].length });
    }
  }
  found.sort((left, right) => left.start - right.start || (right.end - right.start) - (left.end - left.start));
  const kept = [];
  for (const item of found) {
    if (kept.some((other) => item.start < other.end && item.end > other.start)) continue;
    kept.push(item);
  }
  return kept;
}

function gapToToken(keyword, token) {
  if (keyword.end <= token.start) return { distance: token.start - keyword.end, follows: true };
  if (token.end <= keyword.start) return { distance: keyword.start - token.end, follows: false };
  return { distance: 0, follows: token.start >= keyword.start };
}

function bindKeyword(tokens, keyword) {
  let best = null;
  for (const token of tokens) {
    if (token.kind !== 'voltage' || token.role === 'vf') continue;
    const gap = gapToToken(keyword, token);
    if (gap.distance > CONTEXT_WINDOW) continue;
    const closer = !best || gap.distance < best.distance;
    const tiePrefersFollowing = best && gap.distance === best.distance && gap.follows && !best.follows;
    if (closer || tiePrefersFollowing) best = { token, distance: gap.distance, follows: gap.follows };
  }
  if (!best) return;
  best.token.hits.push({ role: keyword.role, distance: best.distance });
}

function explicitLabelGap(text) {
  // Match text folds every dash to ASCII '-', so "Vf—3.2V" arrives as "Vf-3.2V".
  return /^[\s:=\u2013\u2014-]*$/i.test(text) || /^[\s:=\u2013\u2014-]*of[\s:=\u2013\u2014-]*$/i.test(text);
}

function resistanceFollowsLabel(prompt, tokens, label) {
  const following = tokens.find((token) => token.kind === 'resistance' && token.start >= label.end);
  if (!following || following.start - label.end > CONTEXT_WINDOW) return false;
  return explicitLabelGap(prompt.slice(label.end, following.start));
}

function bindExplicitForwardVoltages(prompt, tokens) {
  for (const label of keywordHits(prompt, FORWARD_LABELS, 'vf')) {
    // "Vf 330Ω" and "vf330Ω" are the series resistor. An ohm token is never
    // Vf, and the label does not take a neighboring supply either, so
    // "LED 5V Vf 330Ω" keeps 5V as the supply and leaves Vf missing.
    if (resistanceFollowsLabel(prompt, tokens, label)) continue;
    const following = tokens.find((token) => (
      token.kind === 'voltage' && !token.role && token.start >= label.end
    ));
    let chosen = null;
    if (following) {
      const gap = prompt.slice(label.end, following.start);
      if (following.start - label.end <= CONTEXT_WINDOW && explicitLabelGap(gap)) chosen = following;
    }
    if (!chosen) {
      const preceding = [...tokens].reverse().find((token) => (
        token.kind === 'voltage' && !token.role && token.end <= label.start
      ));
      if (preceding) {
        const gap = prompt.slice(preceding.end, label.start);
        if (label.start - preceding.end <= CONTEXT_WINDOW && explicitLabelGap(gap)) chosen = preceding;
      }
    }
    if (chosen) chosen.role = 'vf';
  }
}

function closestHit(token, role) {
  return token.hits
    .filter((hit) => hit.role === role)
    .sort((left, right) => left.distance - right.distance)[0] ?? null;
}

function onAtBefore(prompt, token) {
  const before = prompt.slice(Math.max(0, token.start - 24), token.start);
  return ON_AT_BEFORE.test(before);
}

// Supply keywords bind to the nearest voltage that is not already a forward
// voltage. "on"/"at" still marks the rail. Forward voltages are labeled first.
function roleForVoltage(prompt, token) {
  if (onAtBefore(prompt, token)) return 'supply';
  if (closestHit(token, 'supply')) return 'supply';
  return 'voltage';
}

export function classifyQuantities(prompt, scan = tokenizeQuantities(prompt)) {
  const text = normalizeMatchText(prompt);
  const tokens = scan.tokens.map((token) => ({ ...token, hits: [] }));
  bindExplicitForwardVoltages(text, tokens);
  for (const keyword of keywordHits(text, SUPPLY_KEYWORDS, 'supply')) bindKeyword(tokens, keyword);
  for (const token of tokens) {
    if (token.kind === 'voltage') {
      if (token.role !== 'vf') token.role = roleForVoltage(text, token);
      if (token.role === 'vf') {
        const outside = implausibleForwardVolts(token);
        token.implausible = outside != null;
        if (outside != null) token.implausibleValue = outside;
      }
    } else if (token.kind === 'package') token.role = 'package';
    else if (token.kind === 'resistance') token.role = token.pot ? null : 'resistor';
    else if (token.kind === 'current') token.role = 'current';
    else if (token.kind === 'count') token.role = 'count';
    else if (token.kind === 'ambiguous') token.role = 'ambiguous';
    else token.role = null;
    delete token.hits;
  }
  return { tokens, unparseable: scan.unparseable, resistorFault: scan.resistorFault ?? null };
}

// AC refuses the draft only when it describes the supply. A DC/AC converter,
// or an AC adapter whose output is explicitly DC, does not.
export function promptDescribesAcSupply(prompt, tokens) {
  const voltages = tokens.filter((token) => token.kind === 'voltage');
  if (voltages.some((token) => token.ac)) return true;
  if (voltages.some((token) => token.dc)) return false;
  const stripped = String(prompt).replace(/d\.?c\.?\s*\/\s*a\.?c\.?|a\.?c\.?\s*\/\s*d\.?c\.?/gi, ' ');
  return /교류|(?:^|[^A-Za-z])vac(?:[^A-Za-z]|$)|(?:^|[^A-Za-z])ac(?:[^A-Za-z]|$)/i.test(stripped);
}
