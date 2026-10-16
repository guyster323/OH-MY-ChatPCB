// Quantities in an LED prompt. `value` is normalized: volts, ohms, milliamps,
// or a count. `unit` is the notation that was recognized (mV, VAC, ohm, …).
// A voltage range's value is its maximum.

const CONTEXT_WINDOW = 32;
const BARE_CONTEXT_WINDOW = 48;
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

const RESISTANCE_MULTIPLIER = { r: 1, k: 1000, m: 1_000_000 };
const POT_BEFORE = /(?:\bpots?\b|\bpotentiometers?\b|가변\s*저항)\s*$/i;
const POT_AFTER = /^[\s,.:;/-]*(?:Ω|옴|ohms?)?\s*(?:\bpots?\b|\bpotentiometers?\b|가변\s*저항)/i;
const BARE_CONTEXT = /\bleds?\b|엘이디|발광|저항|\bresistors?\b|\bohms?\b|Ω|옴/i;
const ON_AT_BEFORE = /\b(?:on|at)\b(?:\s+(?:a|an|the))?\s*$/i;

const PRIORITY = {
  range: 0,
  glued: 1,
  voltage: 2,
  rkm: 3,
  ohm: 4,
  suffix: 5,
  current: 6,
  count: 7,
  bare: 8
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

function resistanceMultiplier(letter) {
  return RESISTANCE_MULTIPLIER[String(letter).toLowerCase()] ?? null;
}

function rkmToOhms(whole, fraction, letter) {
  const multiplier = resistanceMultiplier(letter);
  if (!multiplier) return null;
  const scale = 10 ** fraction.length;
  return (Number(whole) * scale + Number(fraction)) * multiplier / scale;
}

function isPotentiometer(prompt, start, end) {
  const before = prompt.slice(Math.max(0, start - POT_WINDOW), start);
  const after = prompt.slice(end, end + POT_WINDOW);
  return POT_BEFORE.test(before) || POT_AFTER.test(after);
}

function bareHasResistorContext(prompt, start) {
  const before = prompt.slice(Math.max(0, start - BARE_CONTEXT_WINDOW), start);
  return BARE_CONTEXT.test(before);
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
  const pattern = new RegExp(
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
  const pattern = new RegExp(
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

function collectRkm(prompt, candidates) {
  const pattern = /(?<![\w.])(\d+)([rRkKmM])(\d+)(?![\w])/g;
  for (const match of prompt.matchAll(pattern)) {
    const ohms = rkmToOhms(match[1], match[3], match[2]);
    if (!(ohms > 0)) continue;
    const start = match.index ?? 0;
    const end = start + match[0].length;
    candidates.push({
      priority: PRIORITY.rkm,
      start,
      end,
      invalid: false,
      token: resistanceToken(prompt, start, end, ohms, 'rkm')
    });
  }
}

function collectOhm(prompt, candidates) {
  const pattern = /(?<![\w.])(\d+(?:\.\d+)?)\s*([rRkKmM])?\s*(?:옴|ohms?|Ω)/gi;
  for (const match of prompt.matchAll(pattern)) {
    const multiplier = match[2] ? resistanceMultiplier(match[2]) : 1;
    const ohms = Number(match[1]) * multiplier;
    if (!(ohms > 0)) continue;
    const start = match.index ?? 0;
    const end = start + match[0].length;
    candidates.push({
      priority: PRIORITY.ohm,
      start,
      end,
      invalid: false,
      token: resistanceToken(prompt, start, end, ohms, 'ohm')
    });
  }
}

function collectSuffix(prompt, candidates) {
  const pattern = /(?<![\w.])(\d+(?:\.\d+)?)\s*([rRkKmM])(?:\s*[rR]\b|\b)(?![A-Za-z])/g;
  for (const match of prompt.matchAll(pattern)) {
    const multiplier = resistanceMultiplier(match[2]);
    const ohms = Number(match[1]) * multiplier;
    if (!(ohms > 0)) continue;
    const start = match.index ?? 0;
    const end = start + match[0].length;
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

function collectCurrent(prompt, candidates) {
  const milli = /(?<![\w.])(\d+(?:\.\d+)?)\s*(?:m\s*a|ma|milli\s*amps?|milliamps?|milliamperes?|밀리\s*암페어)\b/gi;
  const amps = /(?<![\w.])(\d+(?:\.\d+)?)\s*(?:amps?|amperes?|암페어)\b/gi;
  for (const match of prompt.matchAll(milli)) {
    pushCurrent(candidates, prompt, match, Number(match[1]), 'mA');
  }
  for (const match of prompt.matchAll(amps)) {
    pushCurrent(candidates, prompt, match, Number(match[1]) * 1000, 'A');
  }
}

function pushCurrent(candidates, prompt, match, milliamps, unit) {
  if (!(milliamps > 0)) return;
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

function collectCounts(prompt, candidates) {
  // A count cannot start on the tail of a fractional number. The digit before
  // the match must not be '.', ',', or another digit ("3.2 LED" / "3,2 LED").
  const pattern = /(?<![\w.,])(\d+)\s*(?:개|(?:x\s*)?(?:leds?|엘이디|발광(?:\s*다이오드)?)\b)/gi;
  for (const match of prompt.matchAll(pattern)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    candidates.push({
      priority: PRIORITY.count,
      start,
      end,
      invalid: false,
      token: {
        value: Number(match[1]),
        unit: 'count',
        raw: prompt.slice(start, end),
        start,
        end,
        kind: 'count',
        form: 'count',
        range: null,
        ac: false,
        dc: false,
        pot: false
      }
    });
  }
}

// "Vf=3.2", "Vf 3.2", and glued "vf3.2" are a forward voltage when labeled Vf.
// The same 0.5V to 5V window is applied to every Vf form in classifyQuantities.
// Outside that window the value is refused, not kept as a resistor.
function collectUnitlessForward(prompt, candidates) {
  const pattern = /\bvf(?=\d|\b)(?:\s*[=:]\s*|\s+)?(\d+(?:[.,]\d+)?)(?![\w.]|Ω|옴)/gi;
  for (const match of prompt.matchAll(pattern)) {
    const rawNumber = match[1];
    const volts = parseVoltageNumber(rawNumber);
    if (!(volts > 0)) continue;
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

function collectBare(prompt, candidates) {
  const pattern = /(?<![\w.])(\d+\.\d+|\d+)(?![\w]|\.\d)/g;
  for (const match of prompt.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (!bareHasResistorContext(prompt, start)) continue;
    const end = start + match[0].length;
    const ohms = Number(match[1]);
    if (!(ohms > 0)) continue;
    candidates.push({
      priority: PRIORITY.bare,
      start,
      end,
      invalid: false,
      token: resistanceToken(prompt, start, end, ohms, 'bare')
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
    for (const match of prompt.matchAll(new RegExp(source, 'gi'))) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      const covered = spans.some((span) => start >= span.start && end <= span.end);
      if (!covered) return true;
    }
    return false;
  });
}

export function tokenizeQuantities(prompt) {
  const text = String(prompt ?? '');
  const candidates = [];
  collectRanges(text, candidates);
  collectGlued(text, candidates);
  collectVoltages(text, candidates);
  collectRkm(text, candidates);
  collectOhm(text, candidates);
  collectSuffix(text, candidates);
  collectCurrent(text, candidates);
  collectCounts(text, candidates);
  collectUnitlessForward(text, candidates);
  collectBare(text, candidates);

  const accepted = resolveOverlaps(candidates);
  const tokens = [];
  let unparseable = false;
  for (const item of accepted) {
    if (item.invalid) unparseable = true;
    else if (item.token) tokens.push(item.token);
  }
  if (hasUncoveredVoltage(text, accepted)) unparseable = true;
  tokens.sort((left, right) => left.start - right.start);
  return { tokens, unparseable };
}

function keywordHits(prompt, sources, role) {
  const found = [];
  for (const source of sources) {
    const flags = source.flags.includes('g') ? source.flags : `${source.flags}g`;
    for (const match of prompt.matchAll(new RegExp(source.source, flags))) {
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
  // En dash and em dash join a label to its value, as in "Vf—3.2V".
  return /^[\s:=\u2013\u2014]*$/i.test(text) || /^[\s:=\u2013\u2014]*of[\s:=\u2013\u2014]*$/i.test(text);
}

function bindExplicitForwardVoltages(prompt, tokens) {
  for (const label of keywordHits(prompt, FORWARD_LABELS, 'vf')) {
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
  const text = String(prompt ?? '');
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
    } else if (token.kind === 'resistance') token.role = token.pot ? null : 'resistor';
    else if (token.kind === 'current') token.role = 'current';
    else if (token.kind === 'count') token.role = 'count';
    else token.role = null;
    delete token.hits;
  }
  return { tokens, unparseable: scan.unparseable };
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
