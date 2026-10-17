import assert from 'node:assert/strict';
import test from 'node:test';

import { parseResistorOhms } from '../src/kicad/resistor-ohms.js';
import { spiceResistorOhms } from '../src/kicad/project-generator.js';
import { classifyExistingProjectRequest } from '../src/workflow/existing-project-edit.js';

// Rows from /workspace/r2/lint/c8b-notation.mjs and lint-plan.md §2-1.
// A leading sign is part of the resistor value. ± before a percent is tolerance.
const MINUS = '\u2212';
const EN_DASH = '\u2013';
const FULLWIDTH_HYPHEN = '\uFF0D';
const PLUS_MINUS = '\u00B1';

const SPEC = {
  mcu: { family: 'STM32' },
  schematic: { components: [{ ref: 'R1', libId: 'Device:R', value: '1k' }] },
  peripherals: [
    { kind: 'status-led' },
    { kind: 'status-led-resistor', value: '330Ω' }
  ]
};

const PARSERS = [
  ['parseResistorOhms', parseResistorOhms],
  ['spiceResistorOhms', spiceResistorOhms]
];

const M_HINT = /\b(use|write|type)\b[^.\n]*\bM\b|uppercase M|대문자\s*M|M\s*으로|4M7/i;

const E96 = [
  100, 102, 105, 107, 110, 113, 115, 118, 121, 124, 127, 130, 133, 137, 140, 143,
  147, 150, 154, 158, 162, 165, 169, 174, 178, 182, 187, 191, 196, 200, 205, 210,
  215, 221, 226, 232, 237, 243, 249, 255, 261, 267, 274, 280, 287, 294, 301, 309,
  316, 324, 332, 340, 348, 357, 365, 374, 383, 392, 402, 412, 422, 432, 442, 453,
  464, 475, 487, 499, 511, 523, 536, 549, 562, 576, 590, 604, 619, 634, 649, 665,
  681, 698, 715, 732, 750, 768, 787, 806, 825, 845, 866, 887, 909, 931, 953, 976
];

function asNumber(value) {
  if (value == null) return null;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return value;
}

function close(actual, expected) {
  return typeof actual === 'number' && Math.abs(actual - expected) <= 1e-9 * Math.max(1, expected);
}

function assertParsed(input, expected) {
  for (const [name, parse] of PARSERS) {
    const actual = asNumber(parse(input));
    if (expected == null) assert.equal(actual, null, `${name}(${JSON.stringify(input)}) -> ${actual}`);
    else assert.ok(close(actual, expected), `${name}(${JSON.stringify(input)}) -> ${actual}`);
  }
}

function assertEdit(prompt, expected, { hint = false } = {}) {
  const decision = classifyExistingProjectRequest(prompt, SPEC);
  if (expected == null) {
    assert.equal(decision.mode, 'refuse', prompt);
    assert.equal(decision.code, 'RESISTOR_VALUE_INVALID', prompt);
    assert.equal(decision.edit, undefined, prompt);
    assert.match(decision.message ?? '', /Nothing was changed/);
    if (hint) assert.match(decision.message ?? '', M_HINT, prompt);
    return;
  }
  assert.equal(decision.mode, 'merge', prompt);
  assert.equal(decision.edit?.kind, 'resistor', prompt);
  assert.ok(close(decision.edit?.ohms, expected), `${prompt} -> ${decision.edit?.ohms}`);
}

test('lowercase m is refused and uppercase M is mega', () => {
  for (const input of ['4m7', '1m', '4.7m', '4.7m ohm']) assertParsed(input, null);
  assertParsed('4M7', 4.7e6);
  assertParsed('1M', 1e6);
  assertParsed('4.7M', 4.7e6);
  assertParsed('1meg', 1e6);

  for (const prompt of ['change R1 to 4m7', 'LED 저항 1m', 'change R1 to 4.7m ohm', 'change R1 to 4.7m']) {
    assertEdit(prompt, null, { hint: true });
  }
  assertEdit('change R1 to 4M7', 4.7e6);
  assertEdit('change R1 to 1M', 1e6);
});

test('thousands separators are not resistor values', () => {
  for (const input of ['1,000', '1.000', '1,000 ohm', '1.000 ohm', '1.000.000', '1,000,000', '1 000', '4,7k', '2.200', '2.200 ohm']) {
    assertParsed(input, null);
  }
  for (const prompt of [
    'change R1 to 1,000 ohm',
    'change R1 to 1.000 ohm',
    'change R1 to 2.200 ohm',
    'change R1 to 1 000 ohm',
    'change R1 to 1.000.000 ohm',
    'change R1 to 4,7k'
  ]) {
    assertEdit(prompt, null);
  }
});

test('a leading sign on a resistor value is refused', () => {
  for (const input of [
    '+10',
    '+10 ohm',
    `${PLUS_MINUS}10`,
    `${PLUS_MINUS}10 ohm`,
    `${MINUS}10`,
    `${EN_DASH}10`,
    `${FULLWIDTH_HYPHEN}10`,
    '-10',
    '-10 ohm',
    `${MINUS}10k`,
    '+10k',
    `${EN_DASH}10 ohm`,
    `${MINUS}330옴`,
    '+330옴'
  ]) {
    assertParsed(input, null);
  }

  for (const prompt of [
    'change R1 to +10',
    'change R1 to +10 ohm',
    `change R1 to ${PLUS_MINUS}10 ohm`,
    `change R1 to ${MINUS}10`,
    `change R1 to ${EN_DASH}10`,
    `change R1 to ${FULLWIDTH_HYPHEN}10`,
    'change R1 to -10 ohm',
    `change R1 to ${MINUS}10 ohm`,
    `change R1 to ${EN_DASH}10 ohm`,
    `change R1 to ${FULLWIDTH_HYPHEN}10 ohm`,
    `change R1 to ${MINUS}10k`,
    'change R1 to +10k',
    `LED 저항 ${MINUS}330옴`,
    'LED 저항 +330옴'
  ]) {
    assertEdit(prompt, null);
  }
});

test('a tolerance percent is not a sign on the resistor value', () => {
  assertEdit('change R1 to 10kΩ ±5%', 10_000);
  assertEdit('change R1 to 680Ω ± 5%', 680);
  assertEdit('LED resistor 10kΩ ±5%', 10_000);
  assertEdit('LED resistor 680Ω ± 5%', 680);
  assertEdit('change R1 to 330Ω±5%', 330);
});

test('the edit entry keeps 1Ω and 10MΩ and refuses the outside', () => {
  for (const prompt of [
    'change R1 to 0R5',
    'change R1 to R47',
    'change R1 to 0.5 ohm',
    'change R1 to 10.1M',
    'change R1 to 22M',
    'change R1 to 1G'
  ]) {
    assertEdit(prompt, null);
  }
  assertEdit('change R1 to 1 ohm', 1);
  assertEdit('change R1 to 10M', 1e7);
});

test('E96 labels from 1Ω through 9.76MΩ round-trip, and 10MΩ does too', () => {
  let rows = 0;
  const failures = [];
  for (let dec = -2; dec <= 4; dec += 1) {
    for (const code of E96) {
      rows += 1;
      const ohms = Number((code * 10 ** dec).toPrecision(3));
      const prompt = `change R1 to ${ohms} ohm`;
      const decision = classifyExistingProjectRequest(prompt, SPEC);
      const label = decision.edit?.label ?? null;
      const back = label == null ? null : asNumber(parseResistorOhms(label));
      if (decision.edit?.ohms !== ohms || label == null || !close(back, ohms)) {
        failures.push(`${ohms} -> ohms ${decision.edit?.ohms} label ${label} -> ${back}`);
      }
    }
  }
  assert.equal(rows, 672);
  const ten = classifyExistingProjectRequest('change R1 to 10M', SPEC);
  const tenBack = ten.edit?.label == null ? null : asNumber(parseResistorOhms(ten.edit.label));
  if (!close(tenBack, 1e7)) failures.push(`10M -> ${ten.edit?.label} -> ${tenBack}`);
  assert.deepEqual(failures, []);
});
