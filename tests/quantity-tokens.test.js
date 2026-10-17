import assert from 'node:assert/strict';
import test from 'node:test';

import { parseResistorOhms } from '../src/kicad/resistor-ohms.js';
import { tokenizeQuantities } from '../src/runtime/quantity-tokens.js';

// Trailing "R" on "1kR" is the ohm unit. parseResistorOhms reads it as a second
// suffix, so the comparison uses the multiplier once that unit is removed.
function ohmsFromParser(raw) {
  const direct = parseResistorOhms(raw);
  if (direct != null) return Number(direct);
  const stripped = String(raw).replace(/\s*[rR]$/u, '');
  if (stripped === raw) return null;
  const again = parseResistorOhms(stripped);
  return again == null ? null : Number(again);
}

function resistanceTokens(prompt) {
  return tokenizeQuantities(prompt).tokens.filter((token) => token.kind === 'resistance');
}

test('resistor quantity tokens match parseResistorOhms', () => {
  const rows = [
    ['4k7', 4700],
    ['4.7k', 4700],
    ['4.7kΩ', 4700],
    ['1M', 1_000_000],
    ['4.7M', 4_700_000],
    ['2M2', 2_200_000],
    ['330R', 330],
    ['1R5', 1.5],
    ['1kR', 1000],
    ['3 k', 3000],
    ['680 ohm', 680],
    ['1.5 ohm', 1.5],
    ['4.75k', 4750],
    ['4.99k', 4990],
    ['1.05M', 1_050_000],
    ['1.24k', 1240],
    ['R47', 0.47],
    ['0R', 0],
    ['0Ω', 0],
    ['0 ohm', 0],
    ['0.5Ω', 0.5]
  ];

  for (const [prompt, expected] of rows) {
    const scan = tokenizeQuantities(prompt);
    assert.equal(scan.unparseable, false, prompt);
    const tokens = scan.tokens.filter((token) => token.kind === 'resistance');
    assert.equal(tokens.length, 1, prompt);
    const parsed = ohmsFromParser(tokens[0].raw);
    assert.equal(parsed, expected, prompt);
    assert.equal(tokens[0].value, parsed, `${prompt} ${tokens[0].raw}`);
    assert.equal(tokens[0].value === 4_700_000, expected === 4_700_000, prompt);
  }
});

test('a lone m is not a resistor value', () => {
  for (const prompt of ['4m7', '2m2', '1m', '4.7m', '4.7m ohm']) {
    assert.equal(parseResistorOhms(prompt), null, prompt);
    const scan = tokenizeQuantities(prompt);
    assert.equal(scan.unparseable, true, prompt);
    assert.equal(scan.resistorFault, 'milli', prompt);
    assert.equal(scan.tokens.some((token) => token.kind === 'resistance'), false, prompt);
    assert.equal(scan.tokens.some((token) => token.value === 4_700_000), false, prompt);
  }
});

test('a leading sign is not stripped from a resistor token', () => {
  const minus = '\u2212';
  for (const prompt of ['-10 ohm', `${minus}10`, '±10 ohm', '+330', '-10', '+10k']) {
    const scan = tokenizeQuantities(prompt);
    assert.equal(scan.unparseable, true, prompt);
    assert.equal(scan.resistorFault, 'invalid', prompt);
    assert.equal(scan.tokens.some((token) => token.kind === 'resistance'), false, prompt);
  }

  const tolerance = tokenizeQuantities('330Ω ±5%');
  assert.equal(tolerance.unparseable, false);
  assert.equal(tolerance.resistorFault ?? null, null);
  assert.equal(tolerance.tokens.find((token) => token.kind === 'resistance').value, 330);

  const percentOnly = tokenizeQuantities('±5%');
  assert.equal(percentOnly.unparseable, false);
  assert.equal(percentOnly.tokens.some((token) => token.kind === 'resistance'), false);

  const current = tokenizeQuantities('-20mA');
  assert.equal(current.unparseable, false);
  assert.equal(current.tokens[0].unit, 'mA');
  assert.equal(current.tokens[0].value, -20);
});

test('a bare zero stays a resistor token', () => {
  const scan = tokenizeQuantities('LED 5V 0');
  assert.equal(scan.unparseable, false);
  assert.equal(scan.resistorFault ?? null, null);
  const resistor = scan.tokens.find((token) => token.kind === 'resistance');
  assert.equal(resistor?.value, 0);
  assert.equal(resistor?.raw, '0');

  const current = tokenizeQuantities('0mA').tokens[0];
  assert.equal(current.unit, 'mA');
  assert.equal(current.value, 0);
});

test('an ambiguous thousands dot is not read as a resistor', () => {
  for (const prompt of ['1.000 ohm', '4.700 ohm', '1.000Ω', 'R1=1.000', '1.000k']) {
    const scan = tokenizeQuantities(prompt);
    assert.equal(parseResistorOhms(prompt.replace(/^R1=/, '')), null, prompt);
    assert.equal(resistanceTokens(prompt).length, 0, prompt);
    assert.equal(scan.unparseable, true, prompt);
    assert.equal(scan.tokens.some((token) => token.value === 1 || token.value === 4.7 || token.value === 1000), false, prompt);
  }

  for (const prompt of ['1.5 ohm', '4.75k', '1.24k']) {
    const scan = tokenizeQuantities(prompt);
    assert.equal(scan.unparseable, false, prompt);
    assert.equal(resistanceTokens(prompt).length, 1, prompt);
  }
});

test('voltage and current milli stay milli', () => {
  const millivolts = tokenizeQuantities('3300mV').tokens[0];
  assert.equal(millivolts.unit, 'mV');
  assert.equal(millivolts.value, 3.3);

  const current = tokenizeQuantities('20mA').tokens[0];
  assert.equal(current.unit, 'mA');
  assert.equal(current.value, 20);

  const kilohertz = tokenizeQuantities('LED 5V 1kHz');
  assert.equal(kilohertz.unparseable, false);
  assert.equal(resistanceTokens('LED 5V 1kHz').length, 0);
  assert.deepEqual(kilohertz.tokens.map((token) => token.raw), ['5V']);
});
