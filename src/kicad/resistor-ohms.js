// Lone "m" is SPICE milli. "M" and "meg" are mega. RKM writes that letter in
// place of the decimal point, so 4k7 is 4.7 kΩ and 1R5 is 1.5 Ω.
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
  if (suffix === 'm') return 1e-3;
  if (suffix === 'M') return 1e6;
  if (suffix.length !== 1) return null;
  return RESISTOR_SCALE[suffix.toLowerCase()] ?? null;
}

function resistorNumber(whole, fraction, multiplier) {
  const scale = 10 ** fraction.length;
  return (Number(whole) * scale + Number(fraction || 0)) * multiplier / scale;
}

function formatResistorOhms(ohms) {
  if (!Number.isFinite(ohms) || ohms <= 0) return null;
  const rounded = Math.round(ohms);
  if (Math.abs(ohms - rounded) <= 1e-9 * Math.max(1, Math.abs(ohms))) return String(rounded);
  return Number(ohms.toPrecision(12)).toFixed(12).replace(/0+$/, '').replace(/\.$/, '');
}

// One resistor-value parser. Unparseable text returns null. Callers must fail
// closed instead of guessing a value. spiceResistorOhms is this function.
export function parseResistorOhms(value) {
  const text = String(value ?? '')
    .trim()
    .normalize('NFKC')
    .replace(/(?:\s*(?:Ω|옴|ohms?))$/iu, '')
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
  const [whole, fraction = ''] = suffixed[1].split('.');
  return formatResistorOhms(resistorNumber(whole, fraction, multiplier));
}
