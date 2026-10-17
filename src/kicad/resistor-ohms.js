// LED series resistors outside this window are refused by the edit path and by
// SPICE validation. parseResistorOhms stays a pure parser; callers apply this.
export const LED_SERIES_RESISTOR_RANGE = Object.freeze({ min: 1, max: 10e6 });

// A lone "m" is not a value (4m7, 4.7m). It is not mega. "M" and "meg" are mega.
// classifyResistorValue asks for an uppercase M instead of guessing.
// RKM writes the letter in place of the decimal point, so 4k7 is 4.7 kΩ.
const RESISTOR_SCALE = {
  t: 1e12,
  g: 1e9,
  k: 1e3,
  r: 1,
  u: 1e-6,
  n: 1e-9,
  p: 1e-12,
  f: 1e-15
};

function resistorScale(suffix) {
  if (!suffix) return 1;
  if (/^meg$/i.test(suffix)) return 1e6;
  if (suffix === 'm') return null;
  if (suffix === 'M') return 1e6;
  if (suffix.length !== 1) return null;
  return RESISTOR_SCALE[suffix.toLowerCase()] ?? null;
}

function resistorNumber(whole, fraction, multiplier) {
  const scale = 10 ** fraction.length;
  return (Number(whole) * scale + Number(fraction || 0)) * multiplier / scale;
}

function formatResistorOhms(ohms) {
  if (!Number.isFinite(ohms) || ohms < 0) return null;
  if (ohms === 0) return '0';
  const rounded = Math.round(ohms);
  if (Math.abs(ohms - rounded) <= 1e-9 * Math.max(1, Math.abs(ohms))) return String(rounded);
  return Number(ohms.toPrecision(12)).toFixed(12).replace(/0+$/, '').replace(/\.$/, '');
}

const OHM_UNIT_TAIL = /(?:\s*(?:Ω|옴|ohms?))$/iu;

// One resistor-value parser. Unparseable text returns null. Callers must fail
// closed instead of guessing a value. Zero is "0" so a 0Ω token stays visible.
export function parseResistorOhms(value) {
  const text = String(value ?? '')
    .trim()
    .normalize('NFKC')
    .replace(OHM_UNIT_TAIL, '')
    .trim();
  if (!text) return null;

  const rkm = /^(\d+)([rRkKmM])(\d+)$/.exec(text);
  if (rkm) {
    const multiplier = resistorScale(rkm[2]);
    return multiplier == null ? null : formatResistorOhms(resistorNumber(rkm[1], rkm[3], multiplier));
  }

  const leadingR = /^[rR](\d+)$/.exec(text);
  if (leadingR) return formatResistorOhms(resistorNumber('0', leadingR[1], 1));

  const suffixed = /^(\d+(?:\.\d+)?)(?:\s*([A-Za-z]+))?$/.exec(text);
  if (!suffixed) return null;
  const multiplier = resistorScale(suffixed[2] ?? '');
  if (multiplier == null) return null;
  // "1.000" is a thousands separator in some locales and a decimal in others.
  // A multiplier ("1.000k", "4.75k") shows which reading was meant.
  if (!suffixed[2] && /^\d+\.\d{3}$/.test(suffixed[1])) return null;
  const [whole, fraction = ''] = suffixed[1].split('.');
  return formatResistorOhms(resistorNumber(whole, fraction, multiplier));
}

function bareResistorText(value) {
  return String(value ?? '')
    .trim()
    .normalize('NFKC')
    .replace(OHM_UNIT_TAIL, '')
    .trim();
}

// 4m7, 1m, 2m2, and 4.7m. Uppercase M and meg/MEG/Meg are not this suffix.
export function isLoneMilliResistorSuffix(value) {
  const text = bareResistorText(value);
  return /^\d+m\d+$/.test(text) || /^\d+(?:\.\d+)?\s*m$/.test(text);
}

// Shared by the edit path and SPICE. A lone m is refused with the M hint.
// parseResistorOhms returns null for it, including 1000m.
export function classifyResistorValue(value) {
  if (isLoneMilliResistorSuffix(value)) return { reason: 'milli' };
  const ohmsText = parseResistorOhms(value);
  if (ohmsText == null) return { reason: 'invalid' };
  const ohms = Number(ohmsText);
  if (!(ohms >= LED_SERIES_RESISTOR_RANGE.min && ohms <= LED_SERIES_RESISTOR_RANGE.max)) {
    return { reason: 'range' };
  }
  return { ohmsText, ohms };
}
