import assert from 'node:assert/strict';
import test from 'node:test';

import { parseResistorOhms } from '../src/kicad/resistor-ohms.js';
import { spiceResistorOhms } from '../src/kicad/project-generator.js';
import { parseDiscreteLedRequest } from '../src/runtime/circuit-spec.js';
import { tokenizeQuantities } from '../src/runtime/quantity-tokens.js';
import {
  blocksBeforeProvider,
  classifyExistingProjectRequest,
  resistorRefAmbiguousMessage,
  resistorRefNotFoundMessage,
  resistorRefUnsupportedMessage,
  resistorTargetUnclearMessage,
  resistorUnitRequiredMessage,
  resistorUnitlessMessage,
  resistorValueAmbiguousMessage
} from '../src/workflow/existing-project-edit.js';

// Rows from /workspace/r2/lint/c8b-notation.mjs and lint-plan.md §2-1.
// A leading sign is part of the resistor value. ± before a percent is tolerance.
const MINUS = '\u2212';
const EN_DASH = '\u2013';
const FULLWIDTH_HYPHEN = '\uFF0D';
const PLUS_MINUS = '\u00B1';

const SPEC = {
  mcu: { family: 'STM32' },
  schematic: {
    components: [
      { ref: 'R1', libId: 'Device:R', value: '1k' },
      { ref: 'R3', libId: 'ChatPCB:LED_RESISTOR', value: '123Ω' }
    ]
  },
  peripherals: [
    { kind: 'status-led' },
    { kind: 'status-led-resistor', value: '123Ω' }
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

  for (const prompt of ['change R3 to 4m7', 'LED 저항 1m', 'change R3 to 4.7m ohm', 'change R3 to 4.7m']) {
    assertEdit(prompt, null, { hint: true });
  }
  assertEdit('change R3 to 4M7', 4.7e6);
  assertEdit('change R3 to 1M', 1e6);
});

test("a multiplier letter followed by a separator and a digit ('4k.7', '4k,7', '4k-7', '4k–7', '4k/7', '4k_7', '4k·7', '1R-5', '2M-2') is RESISTOR_VALUE_INVALID", () => {
  const prompts = [
    'set the LED resistor to 4k.7',
    'set the LED resistor to 4k,7',
    'set the LED resistor to 4k-7',
    'set the LED resistor to 4k–7',
    'set the LED resistor to 4k—7',
    'set the LED resistor to 4k/7',
    'set the LED resistor to 4k_7',
    'set the LED resistor to 4k·7',
    'set the LED resistor to 1R-5',
    'set the LED resistor to 2M-2',
    'change the LED resistor to 4k.7',
    'LED 저항 4k.7로 바꿔줘',
    'change the LED resistor to 4k-7',
    'LED 저항 4k-7로 바꿔줘',
    'change the LED resistor to 4K_7',
    'LED 저항 1R.5로 바꿔줘',
    'change the LED resistor to 1R.5',
    'LED 저항 2M-2로 바꿔줘',
    'LED resistor 4k.7',
    'LED resistor 1R-5',
    'LED resistor 2M-2'
  ];
  for (const prompt of prompts) {
    const decision = classifyExistingProjectRequest(prompt, SPEC);
    assert.equal(decision.mode, 'refuse', prompt);
    assert.equal(decision.code, 'RESISTOR_VALUE_INVALID', `${prompt} ${decision.code ?? ''} ${decision.edit?.ohms ?? ''}`);
    assert.equal(decision.edit, undefined, prompt);
    assert.equal(blocksBeforeProvider(prompt, decision), true, prompt);
  }

  for (const [prompt, ohms] of [
    ['change the LED resistor to 4.7k', 4700],
    ['LED resistor 4k7', 4700],
    ['change the LED resistor to 1.5kΩ', 1500],
    ['LED 저항 2.2k로 바꿔줘', 2200],
    ['set the LED resistor to 4k 5%', 4000]
  ]) {
    const decision = classifyExistingProjectRequest(prompt, SPEC);
    assert.equal(decision.mode, 'merge', `${prompt} ${decision.code ?? ''}`);
    assert.equal(decision.edit?.ohms, ohms, prompt);
  }

  for (const prompt of ['LED resistor 680Ω–1k', 'LED resistor 470~680Ω']) {
    const decision = classifyExistingProjectRequest(prompt, SPEC);
    assert.equal(decision.mode, 'refuse', prompt);
    assert.equal(decision.code, 'RESISTOR_VALUE_AMBIGUOUS', `${prompt} ${decision.code ?? ''} ${decision.edit?.ohms ?? ''}`);
    assert.equal(decision.edit, undefined, prompt);
    assert.equal(blocksBeforeProvider(prompt, decision), true, prompt);
  }
});

test('thousands separators are not resistor values', () => {
  for (const input of ['1,000', '1.000', '1,000 ohm', '1.000 ohm', '1.000.000', '1,000,000', '1 000', '4,7k', '2.200', '2.200 ohm']) {
    assertParsed(input, null);
  }
  for (const prompt of [
    'change R3 to 1,000 ohm',
    'change R3 to 1.000 ohm',
    'change R3 to 2.200 ohm',
    'change R3 to 1 000 ohm',
    'change R3 to 1.000.000 ohm',
    'change R3 to 4,7k'
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
    'change R3 to +10',
    'change R3 to +10 ohm',
    `change R3 to ${PLUS_MINUS}10 ohm`,
    `change R3 to ${MINUS}10`,
    `change R3 to ${EN_DASH}10`,
    `change R3 to ${FULLWIDTH_HYPHEN}10`,
    'change R3 to -10 ohm',
    `change R3 to ${MINUS}10 ohm`,
    `change R3 to ${EN_DASH}10 ohm`,
    `change R3 to ${FULLWIDTH_HYPHEN}10 ohm`,
    `change R3 to ${MINUS}10k`,
    'change R3 to +10k',
    `LED 저항 ${MINUS}330옴`,
    'LED 저항 +330옴'
  ]) {
    assertEdit(prompt, null);
  }
});

test('a tolerance percent is not a sign on the resistor value', () => {
  assertEdit('change R3 to 10kΩ ±5%', 10_000);
  assertEdit('change R3 to 680Ω ± 5%', 680);
  assertEdit('LED resistor 10kΩ ±5%', 10_000);
  assertEdit('LED resistor 680Ω ± 5%', 680);
  assertEdit('change R3 to 330Ω±5%', 330);
});

test('the edit entry keeps 1Ω and 10MΩ and refuses the outside', () => {
  for (const prompt of [
    'change R3 to 0R5',
    'change R3 to R47',
    'change R3 to 0.5 ohm',
    'change R3 to 10.1M',
    'change R3 to 22M',
    'change R3 to 1G'
  ]) {
    assertEdit(prompt, null);
  }
  assertEdit('change R3 to 1 ohm', 1);
  assertEdit('change R3 to 10M', 1e7);
});

test('a unitless number is never applied and one candidate asks for a unit', () => {
  // Former F4 positives. A resistor target plus one bare number does not edit.
  const unitRequired = [
    ['LED 저항 330으로', '330'],
    ['change the LED resistor to 330', '330'],
    ['change R3 to 470', '470'],
    ['R3 330으로', '330'],
    ['LED resistor 4700', '4700'],
    ['LEDの抵抗を470に', '470'],
    ['set R3 to 1000000', '1000000']
  ];
  for (const [prompt, number] of unitRequired) {
    const before = structuredClone(SPEC);
    const decision = classifyExistingProjectRequest(prompt, SPEC);
    assert.equal(decision.mode, 'refuse', prompt);
    assert.equal(decision.code, 'RESISTOR_UNIT_REQUIRED', prompt);
    assert.equal(decision.edit, undefined, prompt);
    assert.equal(decision.message, resistorUnitRequiredMessage(number), prompt);
    assert.equal(
      decision.message,
      `Change it to ${number}Ω? Say it again with a unit, like "${number}Ω". Nothing was changed.\n${number}Ω으로 바꿀까요? '${number}Ω'처럼 단위를 붙여서 다시 말해 주세요. 아무것도 바꾸지 않았어요.`,
      prompt
    );
    assert.deepEqual(SPEC, before, prompt);
  }

  const withUnit = [
    ['LED 저항 330Ω으로', 330, '330Ω'],
    ['LED resistor 4k7', 4700, '4.7k'],
    ['LED 저항 1k', 1000, '1k'],
    ['LED resistor 470R', 470, '470Ω'],
    ['LED 저항 680옴', 680, '680Ω']
  ];
  for (const [prompt, ohms, label] of withUnit) {
    const decision = classifyExistingProjectRequest(prompt, SPEC);
    assert.equal(decision.mode, 'merge', prompt);
    assert.equal(decision.edit?.kind, 'resistor', prompt);
    assert.equal(decision.edit?.ohms, ohms, prompt);
    assert.equal(decision.edit?.label, label, prompt);
  }

  for (const prompt of [
    'LED 저항 1/4W로',
    'LED 저항 -10',
    'LED 저항 +330',
    'LED 저항 4,7',
    'LED 저항 330 470',
    'LED 저항 1.000'
  ]) {
    assertEdit(prompt, null);
  }

  const low = classifyExistingProjectRequest('LED 저항 0.47', SPEC);
  assert.equal(low.mode, 'refuse');
  assert.equal(low.code, 'RESISTOR_VALUE_INVALID');
  assert.equal(low.edit, undefined);
  assert.match(low.message ?? '', /1Ω to 10MΩ/);
  assert.match(low.message ?? '', /1Ω~10MΩ/);

  const unitHint = resistorUnitlessMessage();
  for (const prompt of ['330으로 바꿔줘', 'LED 330', 'LED 저항 330 470']) {
    const decision = classifyExistingProjectRequest(prompt, SPEC);
    assert.equal(decision.mode, 'refuse', prompt);
    assert.equal(decision.code, 'RESISTOR_VALUE_INVALID', prompt);
    assert.equal(decision.edit, undefined, prompt);
    assert.equal(decision.message, unitHint, prompt);
  }

  const packageOnly = classifyExistingProjectRequest('LED 저항 0603', SPEC);
  assert.equal(packageOnly.mode, 'refuse');
  assert.equal(packageOnly.code, undefined);
  assert.equal(packageOnly.message, undefined);
  for (const prompt of ['LED 저항 1.000', 'LED 저항 -10', 'LED 저항 4,7', 'LED 저항 +330']) {
    const decision = classifyExistingProjectRequest(prompt, SPEC);
    assert.equal(decision.mode, 'refuse', prompt);
    assert.equal(decision.code, 'RESISTOR_VALUE_INVALID', prompt);
    assert.equal(decision.message?.includes('Add a unit'), false, prompt);
  }
});

const MINUS_SIGN = '\u2212';

function resistanceValues(prompt) {
  return tokenizeQuantities(prompt).tokens
    .filter((token) => token.kind === 'resistance')
    .map((token) => token.value);
}

// One row, three entry points. `differs` is the intentional gap between them.
const SHARED_ROWS = [
  {
    id: '4m7',
    token: '4m7',
    parse: null,
    editPrompt: 'change R3 to 4m7',
    edit: { code: 'RESISTOR_VALUE_INVALID', hint: /Use M for megaohms/ },
    scanPrompt: '4m7',
    scan: { unparseable: true, fault: 'milli', resistance: [] },
    discretePrompt: 'LED 5V 4m7',
    discrete: { refused: true, code: 'discrete-led-invalid-resistor', hint: /Use M for megaohms/ }
  },
  {
    id: '2m2',
    token: '2m2',
    parse: null,
    editPrompt: 'LED 저항 2m2',
    edit: { code: 'RESISTOR_VALUE_INVALID', hint: /메가옴은 M을 써 주세요/ },
    scanPrompt: '2m2',
    scan: { unparseable: true, fault: 'milli', resistance: [] },
    discretePrompt: '5V에 LED 2m2 저항',
    discrete: { refused: true, code: 'discrete-led-invalid-resistor', hint: /메가옴은 M을 써 주세요/, korean: true }
  },
  {
    id: 'signed-10',
    token: '-10 ohm',
    parse: null,
    editPrompt: 'change R3 to -10 ohm',
    edit: { code: 'RESISTOR_VALUE_INVALID' },
    scanPrompt: '-10 ohm',
    scan: { unparseable: true, fault: 'invalid', resistance: [] },
    discretePrompt: 'LED 5V -10 ohm',
    discrete: { refused: true, code: 'discrete-led-invalid-resistor', hint: /not valid/ }
  },
  {
    id: 'unicode-minus',
    token: `${MINUS_SIGN}10`,
    parse: null,
    editPrompt: `change R3 to ${MINUS_SIGN}10`,
    edit: { code: 'RESISTOR_VALUE_INVALID' },
    scanPrompt: `${MINUS_SIGN}10`,
    scan: { unparseable: true, fault: 'invalid', resistance: [] },
    discretePrompt: `LED 5V ${MINUS_SIGN}10`,
    discrete: { refused: true, code: 'discrete-led-invalid-resistor' },
    differs: 'The new-project path used to drop U+2212 and ask whether 10 was a resistor. The sign is now part of the value on every path.'
  },
  {
    id: 'plus-minus-ohm',
    token: '±10 ohm',
    parse: null,
    editPrompt: 'change R3 to ±10 ohm',
    edit: { code: 'RESISTOR_VALUE_INVALID' },
    scanPrompt: '±10 ohm',
    scan: { unparseable: true, fault: 'invalid', resistance: [] },
    discretePrompt: 'LED 5V ±10 ohm',
    discrete: { refused: true, code: 'discrete-led-invalid-resistor' }
  },
  {
    id: 'plus-330',
    token: '+330',
    parse: null,
    editPrompt: 'LED 저항 +330',
    edit: { code: 'RESISTOR_VALUE_INVALID' },
    scanPrompt: '+330',
    scan: { unparseable: true, fault: 'invalid', resistance: [] },
    discretePrompt: 'LED 5V +330',
    discrete: { refused: true, code: 'discrete-led-invalid-resistor' },
    differs: 'parseResistorOhms("+330") is null. The tokenizer must not keep the bare E24 tail 330.'
  },
  {
    id: 'tolerance',
    token: '330Ω ±5%',
    parse: null,
    editPrompt: 'change R3 to 330Ω ±5%',
    edit: { ohms: 330 },
    scanPrompt: '330Ω ±5%',
    scan: { unparseable: false, fault: null, resistance: [330] },
    discretePrompt: 'LED 5V 330Ω ±5%',
    discrete: { refused: false, ohms: 330, explicit: true },
    differs: '± followed by % is a tolerance. The value parsers see the whole string and return null; the edit and new-project paths keep 330Ω.'
  },
  {
    id: 'tolerance-only',
    token: '±5%',
    parse: null,
    scanPrompt: '±5%',
    scan: { unparseable: false, fault: null, resistance: [] },
    discretePrompt: 'LED 5V ±5%',
    discrete: { refused: false, ohms: 300, explicit: false },
    differs: 'A tolerance with no resistor value is not a signed resistor. The new-project path keeps the calculated series resistor.'
  },
  {
    id: 'zero',
    token: '0',
    parse: null,
    spice: null,
    editPrompt: 'change R3 to 0',
    edit: { code: 'RESISTOR_VALUE_INVALID', hint: /1Ω to 10MΩ/ },
    scanPrompt: 'LED 5V 0',
    scan: { unparseable: true, fault: 'invalid', resistance: [] },
    discretePrompt: 'LED 5V 0',
    discrete: { refused: true, code: 'discrete-led-invalid-resistor' },
    differs: 'parseResistorOhms("0") is null. SPICE returns null. The edit path still refuses by range because classifyResistorValue sees 0. The new-project path treats the uncovered 0 as an invalid resistor and does not use the 300Ω default.'
  },
  {
    id: 'zero-r',
    token: '0R',
    parse: null,
    spice: null,
    editPrompt: 'change R3 to 0R',
    edit: { code: 'RESISTOR_VALUE_INVALID', hint: /1Ω to 10MΩ/ },
    scanPrompt: '0R',
    scan: { unparseable: true, fault: 'invalid', resistance: [] },
    discretePrompt: 'LED 5V 0R',
    discrete: { refused: true, code: 'discrete-led-invalid-resistor' },
    differs: 'parseResistorOhms("0R") is null. The edit path refuses 0R by the 1Ω–10MΩ rule. The new-project path refuses it as an invalid resistor.'
  },
  {
    id: 'bare-e24',
    token: '330',
    parse: 330,
    editPrompt: 'LED 330',
    edit: { code: 'RESISTOR_VALUE_INVALID', hint: /Add a unit/ },
    scanPrompt: 'LED 330',
    scan: { unparseable: false, fault: null, resistance: [330] },
    discretePrompt: 'LED 330',
    discrete: { refused: false, ohms: 330, explicit: true },
    differs: 'Bare E24 integers of at least 100 are a resistor on the new-project path (#20). The edit path has no resistor target here, so the same digits stay unitless and are refused with the unit hint.'
  },
  {
    id: 'unitless-target',
    token: '470',
    parse: 470,
    editPrompt: 'change R3 to 470',
    edit: { code: 'RESISTOR_UNIT_REQUIRED', message: resistorUnitRequiredMessage('470') },
    scanPrompt: '470',
    scan: { unparseable: false, fault: null, resistance: [470] },
    discretePrompt: 'LED 5V 470',
    discrete: { refused: false, ohms: 470, explicit: true },
    differs: 'A unitless number is never applied. One named resistor and one bare number return RESISTOR_UNIT_REQUIRED and change nothing. The new-project path still accepts bare 470 because it is an E24 value (#20).'
  },
  {
    id: 'two-unitless',
    token: '330',
    editPrompt: 'LED 저항 330 470',
    edit: { code: 'RESISTOR_VALUE_INVALID', hint: /Add a unit/ },
    discretePrompt: 'LED 5V 330 470',
    discrete: { refused: true, code: 'discrete-led-ambiguous-resistor' },
    differs: 'Two unitless numbers on the edit path ask for a unit. On the new-project path both are E24 resistors, so the request asks which series resistor.'
  },
  {
    id: 'two-values',
    token: '330Ω',
    parse: 330,
    editPrompt: 'set R3 330Ω 680Ω',
    edit: { code: 'RESISTOR_VALUE_AMBIGUOUS', message: resistorValueAmbiguousMessage('R3', ['330Ω', '680Ω']) },
    discretePrompt: 'LED 5V 330Ω 680Ω',
    discrete: { refused: true, code: 'discrete-led-ambiguous-resistor' },
    differs: 'Two valued tokens and no transition marker: the edit path asks which value the named ref should use. The new-project path asks which series resistor (discrete-led-ambiguous-resistor). Nothing is edited.'
  }
];

function assertSharedRow(row) {
  if (Object.prototype.hasOwnProperty.call(row, 'parse')) {
    const parsed = asNumber(parseResistorOhms(row.token));
    if (row.parse == null) assert.equal(parsed, null, row.id);
    else assert.ok(close(parsed, row.parse), `${row.id} parse ${parsed}`);
    const spice = asNumber(spiceResistorOhms(row.token));
    const spiceExpected = Object.prototype.hasOwnProperty.call(row, 'spice') ? row.spice : row.parse;
    if (spiceExpected == null) assert.equal(spice, null, `${row.id} spice`);
    else assert.ok(close(spice, spiceExpected), `${row.id} spice ${spice}`);
  }
  if (row.edit) {
    const decision = classifyExistingProjectRequest(row.editPrompt, SPEC);
    if (row.edit.ohms != null) {
      assert.equal(decision.mode, 'merge', row.id);
      assert.equal(decision.edit?.kind, 'resistor', row.id);
      assert.ok(close(decision.edit?.ohms, row.edit.ohms), `${row.id} edit ${decision.edit?.ohms}`);
    } else {
      assert.equal(decision.mode, 'refuse', row.id);
      assert.equal(decision.code, row.edit.code, row.id);
      assert.equal(decision.edit, undefined, row.id);
      if (row.edit.hint) assert.match(decision.message ?? '', row.edit.hint, row.id);
      if (row.edit.message) assert.equal(decision.message, row.edit.message, row.id);
    }
  }
  if (row.scan) {
    const scan = tokenizeQuantities(row.scanPrompt);
    assert.equal(scan.unparseable, row.scan.unparseable, row.id);
    assert.equal(scan.resistorFault ?? null, row.scan.fault, row.id);
    assert.deepEqual(resistanceValues(row.scanPrompt), row.scan.resistance, row.id);
  }
  if (row.discrete) {
    const led = parseDiscreteLedRequest(row.discretePrompt);
    assert.ok(led, row.id);
    const blocker = led.reviewBlockers[0];
    if (row.discrete.refused) {
      assert.equal(led.refused, true, row.id);
      assert.equal(led.resistanceOhms, null, row.id);
      assert.equal(led.resistorValue, null, row.id);
      assert.equal(blocker?.code, row.discrete.code, `${row.id} ${blocker?.code}`);
      if (row.discrete.hint) assert.match(`${blocker?.en}\n${blocker?.ko}`, row.discrete.hint, row.id);
      if (row.discrete.korean) assert.equal(blocker?.message, blocker?.ko, row.id);
      assert.equal(led.resistorExplicit, false, row.id);
    } else {
      assert.equal(led.refused, false, `${row.id} ${blocker?.code} ${blocker?.en}`);
      assert.ok(close(led.resistanceOhms, row.discrete.ohms), `${row.id} ${led.resistanceOhms}`);
      assert.equal(led.resistorExplicit, row.discrete.explicit, row.id);
    }
  }
  if (row.differs) assert.equal(row.differs.length > 0, true, row.id);
}

test('one resistor contract covers the parser, the edit path, and the new-project path', () => {
  for (const row of SHARED_ROWS) assertSharedRow(row);
});

test('a unitless resistor edit asks for a unit and leaves the series resistor', () => {
  const spec = {
    mcu: { family: 'STM32' },
    schematic: {
      components: [
        { ref: 'R1', libId: 'Device:R', value: '1k' },
        { ref: 'R3', libId: 'ChatPCB:LED_RESISTOR', value: '330Ω' }
      ]
    },
    peripherals: [
      { kind: 'status-led' },
      { kind: 'status-led-resistor', value: '330' }
    ]
  };
  const decision = classifyExistingProjectRequest('change R3 to 470', spec);
  assert.equal(decision.mode, 'refuse');
  assert.equal(decision.code, 'RESISTOR_UNIT_REQUIRED');
  assert.equal(decision.edit, undefined);
  assert.equal(decision.message, resistorUnitRequiredMessage('470'));
  assert.equal(spec.schematic.components.find((part) => part.ref === 'R1').value, '1k');
  assert.equal(spec.schematic.components.find((part) => part.ref === 'R3').value, '330Ω');
  assert.equal(spec.peripherals.find((part) => part.kind === 'status-led-resistor').value, '330');
});

test('a number followed by a counter or another unit is not a resistor edit', () => {
  const prompts = [
    'LED 저항 2개',
    'LED 저항 1개만',
    'R3 2개',
    'LED 저항 2019년형',
    'LED 저항 2019년',
    'LED 저항 3형',
    'LED 저항 5V',
    'LED 저항 2mA',
    'LED 저항 1 W',
    'LED 저항 1%',
    'LED 1 Hz',
    'LED 1 kHz',
    'LED blink 1Hz',
    'add 2 LEDs',
    'use 2 LEDs',
    'LED 2개 추가',
    'LED 4개 추가',
    'status LED on pin 13',
    'LED를 GPIO 4번에 연결',
    'LED 핀 GPIO15로',
    '2 pcs',
    'LED 2 ea',
    'LED 2x',
    'LED 2×',
    'LED resistor 2019 year'
  ];
  for (const prompt of prompts) {
    const decision = classifyExistingProjectRequest(prompt, SPEC);
    assert.equal(decision.edit, undefined, prompt);
    assert.notEqual(decision.mode, 'merge', prompt);
    assert.notEqual(decision.code, 'RESISTOR_UNIT_REQUIRED', prompt);
    assert.notEqual(decision.edit?.ohms, 2, prompt);
    assert.notEqual(decision.edit?.ohms, 2019, prompt);
    assert.notEqual(decision.edit?.label, '2Ω', prompt);
    assert.notEqual(decision.edit?.label, '2k019', prompt);
  }

  const countAndValue = classifyExistingProjectRequest('LED 3개 저항 330', SPEC);
  assert.equal(countAndValue.edit, undefined);
  assert.notEqual(countAndValue.mode, 'merge');
  if (countAndValue.code) {
    assert.equal(countAndValue.code, 'RESISTOR_UNIT_REQUIRED');
    assert.equal(countAndValue.message, resistorUnitRequiredMessage('330'));
  }
  const countAndValueKo = classifyExistingProjectRequest('LED 저항 330, LED 2개', SPEC);
  assert.equal(countAndValueKo.edit, undefined);
  assert.notEqual(countAndValueKo.mode, 'merge');
});

function componentValue(spec, ref) {
  return spec.schematic.components.find((part) => part.ref === ref)?.value;
}

test('a named resistor edit changes only the LED series resistor', () => {
  const spec = {
    mcu: { family: 'STM32' },
    schematic: {
      components: [
        { ref: 'R1', libId: 'Device:R', value: '1k' },
        { ref: 'R3', libId: 'ChatPCB:LED_RESISTOR', value: '330Ω' },
        { ref: 'R4', libId: 'ChatPCB:I2C_PULLUP', value: '4.7k' }
      ]
    },
    peripherals: [
      { kind: 'status-led' },
      { kind: 'status-led-resistor', value: '330' }
    ],
    boardProfile: {
      productionParts: [
        { ref: 'R1', role: 'usb-c-cc1-pulldown', libId: 'Device:R', value: '1k' },
        { ref: 'R3', role: 'status-led-resistor', libId: 'Device:R', value: '330Ω' },
        { ref: 'R4', role: 'i2c-scl-pullup', libId: 'Device:R', value: '4.7k' }
      ]
    }
  };
  const unsupported = resistorRefUnsupportedMessage('R3');
  const rows = [
    // Unitless on the wrong ref: the ref is reported before a missing unit.
    ['change R1 to 470', 'RESISTOR_REF_UNSUPPORTED', unsupported],
    ['R1 470Ω', 'RESISTOR_REF_UNSUPPORTED', unsupported],
    ['저항 R1 470Ω으로 바꿔줘', 'RESISTOR_REF_UNSUPPORTED', unsupported],
    ['change R1 to 1k', 'RESISTOR_REF_UNSUPPORTED', unsupported],
    ['change R4 to 470Ω', 'RESISTOR_REF_UNSUPPORTED', unsupported],
    ['change the I2C pull-up R4 to 470Ω', 'RESISTOR_REF_UNSUPPORTED', unsupported],
    ['change r4 to 470Ω', 'RESISTOR_REF_UNSUPPORTED', unsupported],
    ['change R9 to 470Ω', 'RESISTOR_REF_NOT_FOUND', resistorRefNotFoundMessage('R9')],
    ['change r9 to 470Ω', 'RESISTOR_REF_NOT_FOUND', resistorRefNotFoundMessage('R9')]
  ];
  for (const [prompt, code, message] of rows) {
    const before = structuredClone(spec);
    const decision = classifyExistingProjectRequest(prompt, spec);
    assert.equal(decision.mode, 'refuse', prompt);
    assert.equal(decision.code, code, prompt);
    assert.equal(decision.edit, undefined, prompt);
    assert.equal(decision.message, message, prompt);
    assert.deepEqual(spec, before, prompt);
    assert.equal(componentValue(spec, 'R1'), '1k', prompt);
    assert.equal(componentValue(spec, 'R3'), '330Ω', prompt);
    assert.equal(componentValue(spec, 'R4'), '4.7k', prompt);
  }

  const profile = {
    mcu: { family: 'STM32' },
    schematic: {
      components: [
        { ref: 'R1', libId: 'Device:R', value: '5.1k' },
        { ref: 'R3', libId: 'Device:R', value: '1k' },
        { ref: 'R4', libId: 'Device:R', value: '4.7k' }
      ]
    },
    boardProfile: {
      productionParts: [
        { ref: 'R1', role: 'usb-c-cc1-pulldown' },
        { ref: 'R3', role: 'status-led-resistor' },
        { ref: 'R4', role: 'i2c-scl-pullup' }
      ]
    },
    peripherals: [{ kind: 'status-led-resistor', value: '1k' }]
  };
  const namedSeries = classifyExistingProjectRequest('change R3 to 470', profile);
  assert.equal(namedSeries.mode, 'refuse');
  assert.equal(namedSeries.code, 'RESISTOR_UNIT_REQUIRED');
  assert.equal(namedSeries.edit, undefined);
  assert.equal(namedSeries.message, resistorUnitRequiredMessage('470'));
  const pullup = classifyExistingProjectRequest('change R4 to 470', profile);
  assert.equal(pullup.mode, 'refuse');
  assert.equal(pullup.code, 'RESISTOR_REF_UNSUPPORTED');
  assert.equal(pullup.message, resistorRefUnsupportedMessage('R3'));
  assert.equal(componentValue(profile, 'R1'), '5.1k');
  assert.equal(componentValue(profile, 'R3'), '1k');
  assert.equal(componentValue(profile, 'R4'), '4.7k');

  const noSeries = {
    mcu: { family: 'STM32' },
    schematic: {
      components: [
        { ref: 'D1', libId: 'Device:LED', value: 'LED' },
        { ref: 'R1', libId: 'Device:R', value: '1k' }
      ]
    },
    peripherals: [{ kind: 'status-led' }]
  };
  const missingR3 = classifyExistingProjectRequest('change R3 to 470', noSeries);
  assert.equal(missingR3.mode, 'refuse');
  assert.equal(missingR3.code, 'RESISTOR_REF_NOT_FOUND');
  assert.equal(missingR3.message, resistorRefNotFoundMessage('R3', { ledHint: true }));
  assert.equal(missingR3.edit, undefined);
  const generic = classifyExistingProjectRequest('change the LED resistor to 470', noSeries);
  assert.equal(generic.mode, 'refuse');
  assert.equal(generic.code, 'RESISTOR_UNIT_REQUIRED');
  assert.equal(generic.edit, undefined);
  assert.equal(generic.message, resistorUnitRequiredMessage('470'));
  const genericKo = classifyExistingProjectRequest('LED 저항 470Ω으로', noSeries);
  assert.equal(genericKo.mode, 'refuse');
  assert.equal(genericKo.code, 'RESISTOR_TARGET_UNCLEAR');
  assert.equal(genericKo.edit, undefined);
  const unnamedUnsupported = classifyExistingProjectRequest('change R1 to 470', noSeries);
  assert.equal(unnamedUnsupported.code, 'RESISTOR_REF_UNSUPPORTED');
  assert.equal(unnamedUnsupported.message, resistorRefUnsupportedMessage(null));
  assert.equal(componentValue(noSeries, 'R1'), '1k');

  const fullwidth = classifyExistingProjectRequest('change \uFF32\uFF13 to 470', spec);
  assert.equal(fullwidth.mode, 'refuse');
  assert.equal(fullwidth.code, 'RESISTOR_UNIT_REQUIRED');
  assert.equal(fullwidth.edit, undefined);
  assert.equal(fullwidth.message, resistorUnitRequiredMessage('470'));
  const lower = classifyExistingProjectRequest('change r3 to 470', spec);
  assert.equal(lower.mode, 'refuse');
  assert.equal(lower.code, 'RESISTOR_UNIT_REQUIRED');
  assert.equal(lower.edit, undefined);
  assert.equal(lower.message, resistorUnitRequiredMessage('470'));

  const two = classifyExistingProjectRequest('change R1 and R3 to 470', spec);
  assert.equal(two.mode, 'refuse');
  assert.equal(two.code, 'RESISTOR_REF_AMBIGUOUS');
  assert.equal(two.edit, undefined);
  assert.equal(two.message, resistorRefAmbiguousMessage(['R1', 'R3']));
  assert.equal(componentValue(spec, 'R1'), '1k');
  assert.equal(componentValue(spec, 'R3'), '330Ω');
  const twoMissing = classifyExistingProjectRequest('change R8 and R9 to 470', spec);
  assert.equal(twoMissing.code, 'RESISTOR_REF_AMBIGUOUS');
  assert.equal(twoMissing.message, resistorRefAmbiguousMessage(['R8', 'R9']));
  const sameRef = classifyExistingProjectRequest('change R3 and r3 to 470', spec);
  assert.equal(sameRef.mode, 'refuse');
  assert.equal(sameRef.code, 'RESISTOR_UNIT_REQUIRED');
  assert.equal(sameRef.edit, undefined);
  assert.equal(sameRef.message, resistorUnitRequiredMessage('470'));

  assert.equal(componentValue(spec, 'R3'), '330Ω');
});

test('a bad value on the wrong ref is reported as the value, and a valid value as the ref', () => {
  // Value check wins, so these two rows are the priority cases. The value rows above name R3.
  const milli = classifyExistingProjectRequest('change R1 to 4m7', SPEC);
  assert.equal(milli.mode, 'refuse');
  assert.equal(milli.code, 'RESISTOR_VALUE_INVALID');
  assert.equal(milli.edit, undefined);
  assert.match(milli.message ?? '', /Use M for megaohms/);
  const zero = classifyExistingProjectRequest('change R1 to 0', SPEC);
  assert.equal(zero.code, 'RESISTOR_VALUE_INVALID');
  assert.match(zero.message ?? '', /1Ω to 10MΩ/);
  const refOnly = classifyExistingProjectRequest('change R1 to 470Ω', SPEC);
  assert.equal(refOnly.code, 'RESISTOR_REF_UNSUPPORTED');
  assert.equal(refOnly.message, resistorRefUnsupportedMessage('R3'));
  assert.equal(componentValue(SPEC, 'R3'), '123Ω');
});

test('three digits after one dot are ambiguous with or without a prefix', () => {
  for (const input of ['1.000k', '1.000옴', '1.000Ω', '4.700k']) assertParsed(input, null);
  assertEdit('LED resistor 1.000k', null);
  assertEdit('LED 저항 1.000옴', null);
  assertEdit('change R3 to 1.000k', null);
});

test('non-E-series labels round-trip through a form the parser accepts', () => {
  const refused = /^\d+\.\d{3}[kKmM]$/;
  for (const ohms of [1005, 2001, 1000500]) {
    const decision = classifyExistingProjectRequest(`change R3 to ${ohms} ohm`, SPEC);
    const label = decision.edit?.label ?? null;
    assert.equal(decision.mode, 'merge', String(ohms));
    assert.equal(decision.edit?.ohms, ohms, label);
    assert.equal(refused.test(label ?? ''), false, label);
    assert.equal(asNumber(parseResistorOhms(label)), ohms, label);
    assert.equal(asNumber(spiceResistorOhms(label)), ohms, label);
  }
});

test('E96 labels from 1Ω through 9.76MΩ round-trip, and 10MΩ does too', () => {
  let rows = 0;
  const failures = [];
  for (let dec = -2; dec <= 4; dec += 1) {
    for (const code of E96) {
      rows += 1;
      const ohms = Number((code * 10 ** dec).toPrecision(3));
      const prompt = `change R3 to ${ohms} ohm`;
      const decision = classifyExistingProjectRequest(prompt, SPEC);
      const label = decision.edit?.label ?? null;
      const back = label == null ? null : asNumber(parseResistorOhms(label));
      if (decision.edit?.ohms !== ohms || label == null || !close(back, ohms)) {
        failures.push(`${ohms} -> ohms ${decision.edit?.ohms} label ${label} -> ${back}`);
      }
    }
  }
  assert.equal(rows, 672);
  const ten = classifyExistingProjectRequest('change R3 to 10M', SPEC);
  const tenBack = ten.edit?.label == null ? null : asNumber(parseResistorOhms(ten.edit.label));
  if (!close(tenBack, 1e7)) failures.push(`10M -> ${ten.edit?.label} -> ${tenBack}`);
  assert.deepEqual(failures, []);
});

test('a value with no part name asks which resistor in English and Korean', () => {
  const fourNine = [
    'Which resistor should use 4.99kΩ? Say it like "LED resistor to 4.99k". Nothing was changed.',
    '4.99kΩ을 어느 저항에 쓸까요? "LED 저항 4.99k로"처럼 말해 주세요. 아무것도 바꾸지 않았어요.'
  ].join('\n');
  const rows = [
    ['4.99k로', '4990', fourNine],
    ['4.99k', '4990', fourNine],
    ['4.99k please', '4990', fourNine],
    ['680Ω', '680', resistorTargetUnclearMessage('680')],
    ['330옴으로', '330', resistorTargetUnclearMessage('330')],
    ['1k', '1000', resistorTargetUnclearMessage('1000')],
    ['1k요', '1000', resistorTargetUnclearMessage('1000')]
  ];
  for (const [prompt, ohmsText, message] of rows) {
    const decision = classifyExistingProjectRequest(prompt, SPEC);
    assert.equal(decision.mode, 'refuse', prompt);
    assert.equal(decision.code, 'RESISTOR_TARGET_UNCLEAR', prompt);
    assert.equal(decision.edit, undefined, prompt);
    assert.equal(decision.message, message, prompt);
    assert.equal(decision.message, resistorTargetUnclearMessage(ohmsText), prompt);
    assert.match(decision.message, /Nothing was changed/);
    assert.match(decision.message, /아무것도 바꾸지 않았어요/);
  }
  assert.match(resistorTargetUnclearMessage('680'), /680Ω을/);
  assert.match(resistorTargetUnclearMessage('680'), /LED 저항 680Ω으로/);
  assert.match(resistorTargetUnclearMessage('1000'), /1kΩ을/);
  assert.match(resistorTargetUnclearMessage('1000'), /LED resistor to 1k/);

  for (const prompt of ['-10 ohm', '±10 ohm', '1/4W', '1/4W로']) {
    assertEdit(prompt, null);
  }
  assertEdit('4m7', null, { hint: true });
  assertEdit('0', null);
  const bare = classifyExistingProjectRequest('470', SPEC);
  assert.equal(bare.code, 'RESISTOR_VALUE_INVALID');
  assert.equal(bare.message, resistorUnitlessMessage());

  const sentence = classifyExistingProjectRequest('4.99k로 바꿔줘', SPEC);
  assert.equal(sentence.code, undefined);
  assert.equal(sentence.mode, 'merge');
  assert.equal(sentence.edit?.ohms, 4990);
});

test('non-resistor units, additions, questions, and non-edit numbers are not resistor edits', () => {
  const provider = [
    'add 100nF cap near U1',
    'C1을 10uF로',
    'change C1 to 100nF',
    'L1 10uH로',
    'set VCC to 3.3V',
    'add 10k pull-up on reset',
    'reset에 10k 풀업 추가',
    'add a 120Ω termination resistor',
    'LED 하나 더 추가하고 저항 330Ω',
    '1kΩ 저항 추가해줘',
    'add a 1kΩ resistor',
    'why is R3 330?',
    'R3는 왜 330이야?',
    'what does R3 do?',
    '포트 8080',
    'port 8080',
    '12만',
    '3천',
    '저항 12만으로',
    '저항 12만으로 바꿔줘',
    'LED 저항 1kΩ 괜찮아?',
    'is 1kΩ ok for the LED resistor?',
    'rev 2',
    'the 2019 model',
    'LED 저항 2개',
    'LED 저항 2019년형',
    'v2 board',
    'change the LED resistor to the 2019 model',
    'LED resistor rev 2',
    'LED 저항 2개로 바꿔줘',
    'LED resistor for the 2nd LED',
    'change R3 to 0603',
    'LED 저항 0805로',
    'R3 0603',
    'R3 470?',
    'why is R3 470',
    'change the port to 8080',
    'LED 저항 포트 8080',
    'change it to 4.7m',
    '4.7m로 바꿔줘',
    '50 mm',
    '2 ft',
    '30 cm',
    '1 km',
    '6 in'
  ];
  for (const prompt of provider) {
    const decision = classifyExistingProjectRequest(prompt, SPEC);
    assert.equal(decision.mode, 'refuse', prompt);
    assert.equal(decision.code, undefined, `${prompt} ${decision.code ?? ''} ${decision.message ?? ''}`);
    assert.equal(decision.edit, undefined, prompt);
    assert.equal(blocksBeforeProvider(prompt, decision), false, prompt);
  }

  const blocked = [
    ['pull-up 10k', 'RESISTOR_REF_UNSUPPORTED', true],
    ['풀업 10k', 'RESISTOR_REF_UNSUPPORTED', true],
    ['change the pull-up to 10k', 'RESISTOR_REF_UNSUPPORTED', true],
    ['CC 5.1k로', 'RESISTOR_REF_UNSUPPORTED', true],
    ['termination 120Ω', 'RESISTOR_REF_UNSUPPORTED', true],
    ['R3 470', 'RESISTOR_UNIT_REQUIRED', true],
    ['change R3 to 470', 'RESISTOR_UNIT_REQUIRED', true],
    ['LED 저항 330으로', 'RESISTOR_UNIT_REQUIRED', true],
    ['set the LED resistor to 470', 'RESISTOR_UNIT_REQUIRED', true],
    ['LED 저항 4m7', 'RESISTOR_VALUE_INVALID', false],
    ['LED 저항 4m7으로', 'RESISTOR_VALUE_INVALID', true],
    ['change the LED resistor to 4m7', 'RESISTOR_VALUE_INVALID', true],
    ['4m7 resistor', 'RESISTOR_VALUE_INVALID', false],
    ['LED 5V 4m7', 'RESISTOR_VALUE_INVALID', false],
    ['LED resistor 4m7', 'RESISTOR_VALUE_INVALID', true],
    ['LED resistor 4 m7', 'RESISTOR_VALUE_INVALID', true],
    ['LED 저항 4 m7로', 'RESISTOR_VALUE_INVALID', true],
    ['4.7mΩ', 'RESISTOR_VALUE_INVALID', true],
    ['4.7 mΩ', 'RESISTOR_VALUE_INVALID', true],
    ['4.7m ohm', 'RESISTOR_VALUE_INVALID', true],
    ['4.7 m Ω', 'RESISTOR_VALUE_INVALID', true],
    ['LED 저항 4.7 m Ω으로', 'RESISTOR_VALUE_INVALID', true],
    ['change the LED resistor to 4.7 m Ω', 'RESISTOR_VALUE_INVALID', true],
    ['change R3 to 4.7 m ohm', 'RESISTOR_VALUE_INVALID', true],
    ['change R3 to 4.7m and the cable to 1m', 'RESISTOR_VALUE_INVALID', true],
    ['R3를 4.7m로, 선 2m', 'RESISTOR_VALUE_INVALID', true]
  ];
  for (const [prompt, code, blocks] of blocked) {
    const decision = classifyExistingProjectRequest(prompt, SPEC);
    assert.equal(decision.mode, 'refuse', prompt);
    assert.equal(decision.code, code, `${prompt} ${decision.code ?? ''} ${decision.message ?? ''}`);
    assert.equal(decision.edit, undefined, prompt);
    assert.equal(blocksBeforeProvider(prompt, decision), blocks, prompt);
    if (code === 'RESISTOR_VALUE_INVALID') assert.match(decision.message ?? '', /M for megaohms|메가옴은 M/, prompt);
  }

  // A keep or edit of a cable is leftover content, so the resistor value is not applied.
  for (const prompt of [
    'change R3 to 1kΩ and keep the 1 m cable',
    'LED 저항을 1kΩ으로, 케이블 1m'
  ]) {
    const decision = classifyExistingProjectRequest(prompt, SPEC);
    assert.equal(decision.mode, 'refuse', prompt);
    assert.equal(decision.code, 'RESISTOR_TARGET_UNCLEAR', prompt);
    assert.equal(decision.edit, undefined, prompt);
    assert.equal(blocksBeforeProvider(prompt, decision), true, prompt);
  }
});

function assertProvider(prompt) {
  const decision = classifyExistingProjectRequest(prompt, SPEC);
  assert.equal(decision.mode, 'refuse', `${prompt} ${decision.code ?? ''} ${decision.message ?? ''}`);
  assert.equal(decision.code, undefined, prompt);
  assert.equal(decision.edit, undefined, prompt);
  assert.equal(blocksBeforeProvider(prompt, decision), false, prompt);
}

function assertR3(prompt, ohms) {
  const decision = classifyExistingProjectRequest(prompt, SPEC);
  assert.equal(decision.mode, 'merge', `${prompt} ${decision.code ?? ''} ${decision.message ?? ''}`);
  assert.equal(decision.code, undefined, prompt);
  assert.equal(decision.edit?.kind, 'resistor', prompt);
  assert.equal(decision.edit?.ohms, ohms, prompt);
  assert.equal(decision.edit?.ref, 'R3', prompt);
}

test('a length clause mixed into a resistor edit asks which resistor', () => {
  for (const prompt of [
    'change R3 to 1kΩ and set the cable to 1m',
    'LED 저항 1kΩ으로, 케이블은 1m로',
    'R3를 1kΩ으로 바꾸고 선 길이는 2m로',
    'change the LED resistor to 1kΩ, cable -> 2m',
    'change R3 to 1kΩ and set the cable to 50 mm',
    'LED 저항 1kΩ으로, 케이블은 30 cm로',
    'R3를 1kΩ으로, 케이블은 2 ft로',
    'change R3 to 1kΩ and set the cable to 1 km',
    'LED 저항 1kΩ으로, 케이블은 6 in로',
    'LED 저항 1kΩ으로 하고 선 2m로',
    'R3를 1kΩ으로 바꾸고 전선은 2m로'
  ]) {
    const decision = classifyExistingProjectRequest(prompt, SPEC);
    assert.equal(decision.mode, 'refuse', `${prompt} ${decision.code ?? ''}`);
    assert.equal(decision.code, 'RESISTOR_TARGET_UNCLEAR', prompt);
    assert.equal(decision.edit, undefined, prompt);
    assert.equal(blocksBeforeProvider(prompt, decision), true, prompt);
  }
  assertProvider('set the cable to 1m');
  const milli = classifyExistingProjectRequest('change the LED resistor to 1m', SPEC);
  assert.equal(milli.mode, 'refuse');
  assert.equal(milli.code, 'RESISTOR_VALUE_INVALID');
  assert.equal(milli.edit, undefined);
});

test('unitless k/K/R suffixes count only when bound to the resistor target', () => {
  for (const prompt of [
    'rev 4k',
    '4K display',
    '8K TV',
    '2K19 model',
    '10k pot',
    'status LED, rev 4k',
    'LED board, 8K TV',
    'change the LED resistor, rev 4k',
    'LED 저항 rev 4k',
    'change R3 to rev 4k',
    'LED 저항 4K display용',
    'change the LED resistor next to the 4K display',
    'change the LED resistor for the 4K monitor',
    'LED 저항, 4K 모니터 옆',
    'LED resistor 8K TV',
    'LED 저항 8K TV용',
    'LED resistor 2K19 model',
    'LED 저항 2K19 모델',
    'change the LED resistor beside the 10k pot',
    'LED 저항 10k 팟 옆',
    'LED 저항을 rev 4k로',
    'LED 저항을 model 2K19로',
    'model 2K19',
    'LED resistor 4K screen',
    'LED resistor 4K camera',
    'LED resistor 8K video',
    'LED resistor 10k trimmer',
    '4K screen',
    '4K camera',
    '8K video',
    '10k trimmer',
    'LED 저항을 4.7k 정도로',
    'LED 저항 약 4.7k로',
    'LED 저항 대략 4.7k로',
    'change the LED resistor to about 4.7k',
    'change the LED resistor to around 4.7k',
    'set the LED resistor to approximately 4.7k',
    'LED resistor ~4.7k',
    '4.7k 정도로',
    '약 4.7k',
    '대략 4.7k',
    'about 4.7k',
    'around 4.7k',
    'approximately 4.7k',
    '~4.7k'
  ]) {
    assertProvider(prompt);
  }
  for (const [prompt, ohms] of [
    ['LED 저항 4k7', 4700],
    ['R3 4k7', 4700],
    ['change R3 to 4k7', 4700],
    ['LED resistor 2k2', 2200],
    ['LED 저항 4k', 4000],
    ['LED resistor 1k', 1000],
    ['change the LED resistor to 4k', 4000],
    ['LED 저항 4.7k로', 4700],
    ['change the LED resistor next to the 4K display to 1kΩ', 1000],
    ['change R3 to 2R2', 2.2],
    ['R3 4R7', 4.7],
    ['LED 저항 2R2로', 2.2],
    ['change R3 to 1R', 1],
    ['change R3 to 1R5', 1.5],
    ['LED resistor 1R', 1],
    ['use a 10k LED resistor', 10000],
    ['10k LED 저항으로 바꿔줘', 10000]
  ]) {
    assertR3(prompt, ohms);
  }
});

test('a question without an edit verb does not change the LED resistor', () => {
  for (const prompt of [
    'LED 저항 1kΩ 괜찮아',
    'LED 저항 1kΩ이면 괜찮아',
    'LED 저항 1kΩ으로 해도 괜찮을까',
    'LED 저항 1kΩ 괜찮아?',
    '680Ω 가능?',
    '680Ω 가능',
    'LED 저항 680Ω으로 가능'
  ]) {
    assertProvider(prompt);
  }
  for (const prompt of [
    'LED with a 330Ω resistor and a 50 mm lead',
    'LED with a 330Ω resistor and a 30 cm cable',
    'LED with a 330Ω resistor, cable 2 ft',
    'LED with a 330Ω resistor and a 6 in wire',
    'LED with a 330Ω resistor and a 1 km cable'
  ]) {
    const scan = tokenizeQuantities(prompt);
    const values = scan.tokens.filter((token) => token.kind === 'resistance').map((token) => token.value);
    assert.deepEqual(values, [330], prompt);
    assert.equal(scan.unparseable, false, prompt);
    assert.equal(scan.resistorFault ?? null, null, prompt);
    const led = parseDiscreteLedRequest(prompt);
    assert.equal(led.refused, false, prompt);
    assert.equal(led.resistanceOhms, 330, prompt);
    assert.equal(led.resistorExplicit, true, prompt);
  }
});

test('an add request in a separate user prompt reaches the provider', () => {
  for (const [generatePrompt, userPrompt] of [
    ['Change the status LED series resistor to 1k ohm.', 'add a 1kΩ resistor'],
    ['LED 저항을 1kΩ으로', '1kΩ 저항 추가해줘']
  ]) {
    const decision = classifyExistingProjectRequest(generatePrompt, SPEC, userPrompt);
    assert.equal(decision.mode, 'refuse', userPrompt);
    assert.equal(decision.code, undefined, `${userPrompt} ${decision.code ?? ''}`);
    assert.equal(decision.edit, undefined, userPrompt);
    assert.equal(blocksBeforeProvider(userPrompt, decision), false, userPrompt);
  }
});

test('package codes outside the old four-code list are not resistor values', () => {
  for (const prompt of ['R3를 0201로', 'change R3 to 2512', 'R3 1210으로', 'change R3 to 01005', 'R3를 2010으로']) {
    assertProvider(prompt);
  }
});

test('a model code beside the LED resistor is unsupported in both languages', () => {
  for (const prompt of [
    'R2D2 LED 저항 1kΩ으로',
    'change the R2D2 LED resistor to 1kΩ',
    'change the LED resistor for R2D2 to 1kΩ'
  ]) {
    const decision = classifyExistingProjectRequest(prompt, SPEC);
    assert.equal(decision.mode, 'refuse', `${prompt} ${decision.code ?? ''} ${decision.message ?? ''}`);
    assert.equal(decision.code, 'RESISTOR_REF_UNSUPPORTED', prompt);
    assert.equal(decision.edit, undefined, prompt);
    assert.equal(decision.message, resistorRefUnsupportedMessage('R3'), prompt);
  }
});
