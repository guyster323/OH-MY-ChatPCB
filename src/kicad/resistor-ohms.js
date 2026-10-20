// LED series resistors outside this window are refused by the edit path and by
// SPICE validation. parseResistorOhms stays a pure parser; callers apply this.
import { isRejectedUppercaseRkm, RKM_FRACTION_SEPARATOR } from '../workflow/resistor-vocabulary.js';

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
// Glued RKM (4k7, 2M2) and a number with an optional SI suffix (680, 2.2k, 1 meg).
// One copy: the parser and isResistorValueWithUnit both read these.
const RKM_GLUED = /^(\d+)([rRkKmM])(\d+)$/;
const SUFFIXED_RESISTOR = /^(\d+(?:\.\d+)?)(?:\s*([A-Za-z]+))?$/;
// "4k 7", "4k.7", "4k,7", "4k-7", "4k/7", "4k_7", "1R-5", "2M-2".
// The separator splits the RKM fraction off the multiplier.
// Lowercase m is milli, not this form. One digit glued on (4k7, 2M2) stays valid.
// Built on first use. resistor-vocabulary imports this module, and this module
// reads RKM_FRACTION_SEPARATOR from there, so the pattern cannot be built while
// that binding is still initializing.
let spacedRkmPattern = null;
function spacedRkm() {
  if (!spacedRkmPattern) {
    spacedRkmPattern = new RegExp(String.raw`^\d+(?:\.\d+)?\s*[kKrRM]${RKM_FRACTION_SEPARATOR}\d+$`);
  }
  return spacedRkmPattern;
}

// One resistor-value parser. Unparseable text returns null. Callers must fail
// closed instead of guessing a value. Zero is null here so a 0Ω token is not a
// resistance. classifyResistorValue still sees 0 and refuses it as out of range.
function parseResistorOhmsAllowingZero(value) {
  const text = String(value ?? '')
    .trim()
    .normalize('NFKC')
    .replace(OHM_UNIT_TAIL, '')
    .trim();
  if (!text) return null;
  if (spacedRkm().test(text)) return null;

  const rkm = RKM_GLUED.exec(text);
  if (rkm) {
    // 4k7, 4K7, 1R5, 4r7, and 2M2 are RKM: exactly one digit after the letter.
    // Two or more digits (4k75, 4K60, 1R50, 2M20, 1k005) are not a value.
    // k/K and R/r ignore case. Uppercase M is mega. Lowercase m stays milli.
    if (isRejectedUppercaseRkm(text)) return null;
    const multiplier = resistorScale(rkm[2]);
    return multiplier == null ? null : formatResistorOhms(resistorNumber(rkm[1], rkm[3], multiplier));
  }

  const leadingR = /^[rR](\d+)$/.exec(text);
  if (leadingR) return formatResistorOhms(resistorNumber('0', leadingR[1], 1));

  const suffixed = SUFFIXED_RESISTOR.exec(text);
  if (!suffixed) return null;
  const multiplier = resistorScale(suffixed[2] ?? '');
  if (multiplier == null) return null;
  // "1.000" and "1.000k" are a thousands separator in some locales and a
  // decimal in others. Exactly three digits after one dot is refused with or
  // without a prefix. "4.75k" stays exact. "1k005" does not: the letter may
  // stand in for one decimal digit only.
  if (/^\d+\.\d{3}$/.test(suffixed[1])) return null;
  const [whole, fraction = ''] = suffixed[1].split('.');
  return formatResistorOhms(resistorNumber(whole, fraction, multiplier));
}

export function parseResistorOhms(value) {
  const text = parseResistorOhmsAllowingZero(value);
  if (text == null) return null;
  if (Number(text) === 0) return null;
  return text;
}

function bareResistorText(value) {
  return String(value ?? '')
    .trim()
    .normalize('NFKC')
    .replace(OHM_UNIT_TAIL, '')
    .trim();
}

// 4k 7, 4k.7, 1R-5, 2M-2, 4.7k 2. The whole token, after the ohm-unit tail is removed.
export function isSpacedRkmValue(value) {
  return spacedRkm().test(bareResistorText(value));
}

// A bare number is not a value. A number plus a unit is, attached or spaced:
// 680Ω, 680 ohms, 680 Ω, 1 meg, 2.2k, 10kΩ, 2M2. The unit test is OHM_UNIT_TAIL
// plus the parser's glued-RKM and suffixed forms. No second unit pattern.
function suffixMarksKeepUnit(suffix) {
  if (!suffix) return false;
  if (suffix === 'm') return true;
  const scale = resistorScale(suffix);
  if (suffix.length !== 1) return scale === 1e6;
  return scale === 1 || scale === 1e3 || scale === 1e6;
}

export function isResistorValueWithUnit(value) {
  const text = String(value ?? '').trim().normalize('NFKC');
  if (!/^\d/u.test(text)) return false;
  const stripped = text.replace(OHM_UNIT_TAIL, '').trim();
  const hadOhmUnit = stripped !== text;
  if (RKM_GLUED.test(stripped)) return true;
  const suffixed = SUFFIXED_RESISTOR.exec(stripped);
  if (!suffixed) return false;
  if (suffixed[2]) return suffixMarksKeepUnit(suffixed[2]);
  return hadOhmUnit;
}

// 4m7, 4 m7, 1m, 2m2, and 4.7m. Uppercase M and meg/MEG/Meg are not this suffix.
export function isLoneMilliResistorSuffix(value) {
  const text = bareResistorText(value);
  return /^\d+m\d+$/.test(text) || /^\d+\s+m\d+$/.test(text) || /^\d+(?:\.\d+)?\s*m$/.test(text);
}

// Shared by the edit path and SPICE. A lone m is refused with the M hint.
// parseResistorOhms returns null for it, including 1000m. Zero is parsed here
// so the edit path can say the value is outside 1Ω–10MΩ.
export function classifyResistorValue(value) {
  if (isLoneMilliResistorSuffix(value)) return { reason: 'milli' };
  const ohmsText = parseResistorOhmsAllowingZero(value);
  if (ohmsText == null) return { reason: 'invalid' };
  const ohms = Number(ohmsText);
  if (!(ohms >= LED_SERIES_RESISTOR_RANGE.min && ohms <= LED_SERIES_RESISTOR_RANGE.max)) {
    return { reason: 'range' };
  }
  return { ohmsText, ohms };
}
