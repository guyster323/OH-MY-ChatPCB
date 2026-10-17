import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { parseResistorOhms } from '../src/kicad/resistor-ohms.js';
import { spiceResistorOhms } from '../src/kicad/project-generator.js';
import { classifyExistingProjectRequest, resistorMilliSuffixMessage } from '../src/workflow/existing-project-edit.js';
import { generateMcuPeripheralProject } from '../src/workflow/generate-mcu-project.js';
import { applySchematicPatch, createSchematicPatchPlan, disposeSchematicPatchPlan } from '../src/workflow/schematic-patch.js';

const SPEC = { sourcePrompt: 'existing' };
const STM32_USER_PROMPT = 'Prototype STM32 USB-C 5V sensor board with 3.3V 500mA regulator, I2C sensor connector, UART debug header, SWD, reset button, and status LED.';
const REWRITE_EXAMPLE = '상태 LED 저항을 바꿔 주세요. 유효한 저항값(예: 330Ω, 1kΩ)을 확인하세요.';

const passingVerify = async () => ({
  erc: { ok: true, skipped: false, executed: true, erc: { errorCount: 0, warningCount: 0 } },
  drc: { ok: true, skipped: true }
});
const passingDrc = async () => ({ ok: true, skipped: false, executed: true, violations: [], unconnectedItems: [] });
const passingErc = async () => ({ ok: true, skipped: false, erc: { errorCount: 0, warningCount: 0, byType: {} } });

function schematicRefValue(schematic, ref) {
  const match = schematic.match(new RegExp(`\\(property "Reference" "${ref}"[\\s\\S]*?\\(property "Value" "([^"]*)"`));
  return match?.[1] ?? null;
}

test('a resistor token the shared parser rejects is not applied', () => {
  for (const prompt of [
    'LED resistor to 1,000 ohm',
    'LED resistor to -10 ohm',
    'LED resistor to 1.0.0k',
    'LED resistor to 10kk',
    'change the LED resistor from 680 to 1,000 ohm'
  ]) {
    const decision = classifyExistingProjectRequest(prompt, SPEC);
    assert.equal(decision.mode, 'refuse', prompt);
    assert.equal(decision.code, 'RESISTOR_VALUE_INVALID', prompt);
    assert.equal(decision.edit, undefined, prompt);
  }
});

test('plain resistor values still apply', () => {
  for (const [prompt, ohms] of [
    ['LED resistor to 680 ohm', 680],
    ['LED resistor 4k7', 4700],
    ['LED resistor to 1kΩ', 1000],
    ['LED resistor 10kΩ ±5%', 10000],
    ['change LED resistor to 680 ohm at 3.3V', 680]
  ]) {
    const decision = classifyExistingProjectRequest(prompt, SPEC);
    assert.equal(decision.mode, 'merge', prompt);
    assert.equal(decision.edit?.kind, 'resistor', prompt);
    assert.equal(decision.edit?.ohms, ohms, prompt);
  }

  const current = classifyExistingProjectRequest('LED resistor 500mA', SPEC);
  assert.equal(current.mode, 'refuse');
  assert.equal(current.code, undefined);
  assert.equal(current.edit, undefined);
});

test('resistor notation uses the same values the SPICE parser accepts', () => {
  const rows = [
    ['LED 저항 1k', 1000, '1k'],
    ['LED 저항 1kΩ으로', 1000, '1k'],
    ['change the LED resistor to 1 kΩ', 1000, '1k'],
    ['change the LED resistor to 4.7k', 4700, '4.7k'],
    ['LED resistor 4k7', 4700, '4.7k'],
    ['set the status LED resistor to 1M', 1000000, '1M'],
    ['LED 저항 2M2로', 2200000, '2.2M'],
    ['status LED resistor 1meg', 1000000, '1M'],
    ['LED resistor 330R', 330, '330Ω'],
    ['LED resistor 1R5', 1.5, '1.5Ω'],
    ['LED resistor 680 ohm', 680, '680Ω'],
    ['LED 저항 680옴', 680, '680Ω'],
    ['change the LED resistor from 680 to 1k', 1000, '1k'],
    ['LED 저항 680옴에서 1k옴으로', 1000, '1k']
  ];

  for (const [prompt, ohms, label] of rows) {
    const decision = classifyExistingProjectRequest(prompt, SPEC);
    assert.equal(decision.mode, 'merge', prompt);
    assert.equal(decision.edit?.kind, 'resistor', prompt);
    assert.equal(decision.edit?.ohms, ohms, prompt);
    assert.equal(decision.edit?.label, label, prompt);
    assert.equal((decision.edit?.targets ?? []).includes('i2c'), false, prompt);
  }
});

test('an invalid user resistor value is not filled from the rewrite example', () => {
  const decision = classifyExistingProjectRequest(REWRITE_EXAMPLE, SPEC, 'LED 저항 abc옴으로');
  assert.equal(decision.mode, 'refuse');
  assert.equal(decision.code, 'RESISTOR_VALUE_INVALID');
  assert.equal(decision.edit, undefined);
  assert.match(decision.message, /680Ω/);
  assert.match(decision.message, /4\.7kΩ/);
  assert.match(decision.message, /저항 값이 올바르지 않아요/);
  assert.match(decision.message, /아무것도 바꾸지 않았어요/);
  assert.equal(/않습니다|않았습니다/.test(decision.message), false);
});

test('a valid user resistor value wins over a different value in the rewrite', () => {
  const decision = classifyExistingProjectRequest(
    '예: 330Ω, 1kΩ으로 상태 LED 저항을 바꾸세요.',
    SPEC,
    'LED 저항 4.7kΩ으로'
  );
  assert.equal(decision.mode, 'merge');
  assert.equal(decision.edit?.kind, 'resistor');
  assert.equal(decision.edit?.ohms, 4700);
  assert.equal(decision.edit?.label, '4.7k');
});

test('invalid resistor text previews no patch and leaves the schematic unchanged', async () => {
  const projectDir = await mkdtemp(path.join(tmpdir(), 'chatpcb-resistor-invalid-'));
  try {
    const generated = await generateMcuPeripheralProject({
      projectDir,
      prompt: STM32_USER_PROMPT,
      projectName: 'stm32_i2c'
    });
    const before = await readFile(generated.files.schematic, 'utf8');
    assert.match(before, /I2C_CONNECTOR/);
    for (const userPrompt of [
      'LED 저항 abc옴으로',
      'LED resistor to 1,000 ohm',
      'LED resistor to -10 ohm',
      'LED resistor to 1.0.0k',
      'LED resistor to 10kk'
    ]) {
      await assert.rejects(
        () => createSchematicPatchPlan({
          projectDir,
          prompt: REWRITE_EXAMPLE,
          userPrompt,
          projectName: 'stm32_i2c',
          validateProjectImpl: passingErc,
          validateBoardImpl: passingDrc
        }),
        (error) => {
          assert.equal(error.code, 'RESISTOR_VALUE_INVALID', userPrompt);
          assert.match(error.message, /680Ω/);
          assert.match(error.message, /4\.7kΩ/);
          assert.match(error.message, /저항 값이 올바르지 않아요/);
          assert.match(error.message, /아무것도 바꾸지 않았어요/);
          assert.equal(/않습니다|않았습니다/.test(error.message), false, userPrompt);
          return true;
        }
      );
      assert.equal(await readFile(generated.files.schematic, 'utf8'), before, userPrompt);
    }
  } finally {
    await rm(projectDir, { force: true, recursive: true });
  }
});

test('sequential resistor edits apply 330, then 680, then 1k, 4.7k, and 1M and keep I2C', async () => {
  const projectDir = await mkdtemp(path.join(tmpdir(), 'chatpcb-resistor-seq-'));
  const steps = [
    ['Change the status LED series resistor to 330 ohm.', '330Ω'],
    ['Change the status LED series resistor to 680 ohm.', '680Ω'],
    ['LED 저항을 1kΩ으로 바꿔줘', '1k'],
    ['change the LED resistor to 4.7k', '4.7k'],
    ['set the status LED resistor to 1M', '1M']
  ];
  const plans = [];
  try {
    const generated = await generateMcuPeripheralProject({
      projectDir,
      prompt: STM32_USER_PROMPT,
      projectName: 'stm32_i2c'
    });
    for (const [prompt, value] of steps) {
      const plan = await createSchematicPatchPlan({
        projectDir,
        prompt,
        projectName: 'stm32_i2c',
        validateProjectImpl: passingErc,
        validateBoardImpl: passingDrc
      });
      plans.push(plan);
      const applied = await applySchematicPatch({
        projectDir,
        prompt,
        approved: true,
        expectedPatchId: plan.patchId,
        patchPlan: plan,
        validateProjectImpl: passingErc,
        validateBoardImpl: passingDrc,
        verifyAppliedProjectImpl: passingVerify
      });
      assert.equal(applied.applied, true, JSON.stringify(applied.reason));
      const schematic = await readFile(generated.files.schematic, 'utf8');
      assert.equal(schematicRefValue(schematic, 'R3'), value, prompt);
      assert.match(schematic, /I2C_CONNECTOR/);
      assert.match(schematic, /\(property "Reference" "J2"/);
    }
  } finally {
    await Promise.all(plans.map((plan) => disposeSchematicPatchPlan(plan)));
    await rm(projectDir, { force: true, recursive: true });
  }
});

test('lossless labels keep every significant digit of an E-series value', () => {
  for (const [prompt, ohms, label, ohmsText] of [
    ['LED 저항 4.99k로', 4990, '4.99k', '4990'],
    ['LED resistor 4.75k', 4750, '4.75k', '4750'],
    ['LED resistor 2.49k', 2490, '2.49k', '2490'],
    ['LED resistor 1.24k', 1240, '1.24k', '1240'],
    ['LED resistor 1.05M', 1050000, '1.05M', '1050000'],
    ['LED resistor 680Ω', 680, '680Ω', '680'],
    ['LED resistor 1k', 1000, '1k', '1000'],
    ['LED resistor 4.7k', 4700, '4.7k', '4700'],
    ['LED resistor 1.5Ω', 1.5, '1.5Ω', '1.5'],
    ['LED resistor 1.5 ohm', 1.5, '1.5Ω', '1.5']
  ]) {
    const decision = classifyExistingProjectRequest(prompt, SPEC);
    assert.equal(decision.mode, 'merge', prompt);
    assert.equal(decision.edit?.ohms, ohms, prompt);
    assert.equal(decision.edit?.label, label, prompt);
    assert.equal(decision.edit?.ohmsText, ohmsText, prompt);
  }
});

const E96_MANTISSA = [
  '1.00', '1.02', '1.05', '1.07', '1.10', '1.13', '1.15', '1.18', '1.21', '1.24',
  '1.27', '1.30', '1.33', '1.37', '1.40', '1.43', '1.47', '1.50', '1.54', '1.58',
  '1.62', '1.65', '1.69', '1.74', '1.78', '1.82', '1.87', '1.91', '1.96', '2.00',
  '2.05', '2.10', '2.15', '2.21', '2.26', '2.32', '2.37', '2.43', '2.49', '2.55',
  '2.61', '2.67', '2.74', '2.80', '2.87', '2.94', '3.01', '3.09', '3.16', '3.24',
  '3.32', '3.40', '3.48', '3.57', '3.65', '3.74', '3.83', '3.92', '4.02', '4.12',
  '4.22', '4.32', '4.42', '4.53', '4.64', '4.75', '4.87', '4.99', '5.11', '5.23',
  '5.36', '5.49', '5.62', '5.76', '5.90', '6.04', '6.19', '6.34', '6.49', '6.65',
  '6.81', '6.98', '7.15', '7.32', '7.50', '7.68', '7.87', '8.06', '8.25', '8.45',
  '8.66', '8.87', '9.09', '9.31', '9.53', '9.76'
];
const E24_MANTISSA = [
  '1.0', '1.1', '1.2', '1.3', '1.5', '1.6', '1.8', '2.0', '2.2', '2.4', '2.7',
  '3.0', '3.3', '3.6', '3.9', '4.3', '4.7', '5.1', '5.6', '6.2', '6.8', '7.5',
  '8.2', '9.1'
];

function seriesOhmsText(mantissa, exponent) {
  const [whole, frac = ''] = mantissa.split('.');
  const digits = `${whole}${frac}`.replace(/^0+(?=\d)/, '');
  const scale = exponent - frac.length;
  if (scale >= 0) return digits + '0'.repeat(scale);
  const places = -scale;
  const padded = digits.padStart(places + 1, '0');
  const splitAt = padded.length - places;
  const head = padded.slice(0, splitAt).replace(/^0+(?=\d)/, '') || '0';
  const tail = padded.slice(splitAt).replace(/0+$/, '');
  return tail ? `${head}.${tail}` : head;
}

function expectedResistorLabel(ohmsText) {
  const value = Number(ohmsText);
  if (value >= 1_000_000) return `${scaleSeries(ohmsText, 6)}M`;
  if (value >= 1000) return `${scaleSeries(ohmsText, 3)}k`;
  return `${ohmsText}Ω`;
}

function scaleSeries(text, places) {
  const [whole, frac = ''] = text.split('.');
  const digits = `${whole}${frac}`.replace(/^0+(?=\d)/, '') || '0';
  const pointFromRight = places + frac.length;
  const padded = digits.padStart(pointFromRight + 1, '0');
  const splitAt = padded.length - pointFromRight;
  const head = padded.slice(0, splitAt).replace(/^0+(?=\d)/, '') || '0';
  const tail = padded.slice(splitAt).replace(/0+$/, '');
  return tail ? `${head}.${tail}` : head;
}

test('every E96 and E24 value from 1Ω to 10MΩ round-trips through the label and the SPICE number', () => {
  const seen = new Set();
  for (const mantissa of [...E96_MANTISSA, ...E24_MANTISSA]) {
    for (let exponent = 0; exponent <= 7; exponent += 1) {
      const ohmsText = seriesOhmsText(mantissa, exponent);
      const ohms = Number(ohmsText);
      if (!(ohms >= 1 && ohms <= 10e6)) continue;
      const token = `${ohmsText}Ω`;
      if (seen.has(token)) continue;
      seen.add(token);
      const parsed = parseResistorOhms(token);
      const decision = classifyExistingProjectRequest(`LED resistor ${token}`, SPEC);
      assert.equal(decision.mode, 'merge', token);
      assert.equal(decision.edit?.label, expectedResistorLabel(parsed), token);
      assert.equal(decision.edit?.ohmsText, parsed, token);
      assert.equal(parseResistorOhms(decision.edit?.label), parsed, token);
      assert.equal(parseResistorOhms(decision.edit?.ohmsText), parsed, token);
    }
  }
  assert.ok(seen.size > 700, seen.size);
});

test('mixed sentences keep only real resistor tokens', () => {
  const accepted = [
    ['LED 저항 680옴, 0603', 680, '680Ω', '680'],
    ['LED 저항 0603 680옴', 680, '680Ω', '680'],
    ['LED 저항 330옴 1/4W로', 330, '330Ω', '330'],
    ['LED 저항 1/4W 330옴', 330, '330Ω', '330'],
    ['LED resistor 680Ω 5%', 680, '680Ω', '680'],
    ['change LED resistor to 680 ohm at 3.3V', 680, '680Ω', '680'],
    ['LED resistor 680 ohm 20mA', 680, '680Ω', '680'],
    ['LED resistor 0805 package, 1k ohm', 1000, '1k', '1000'],
    ['LED resistor R3 330Ω', 330, '330Ω', '330'],
    ['set LED resistor R3 330Ω', 330, '330Ω', '330']
  ];
  for (const [prompt, ohms, label, ohmsText] of accepted) {
    const decision = classifyExistingProjectRequest(prompt, SPEC);
    assert.equal(decision.mode, 'merge', prompt);
    assert.equal(decision.edit?.ohms, ohms, prompt);
    assert.equal(decision.edit?.label, label, prompt);
    assert.equal(decision.edit?.ohmsText, ohmsText, prompt);
  }

  for (const prompt of [
    'LED 저항 1/4W로',
    'change the LED resistor to 5.k',
    'LED resistor 5.k',
    'LED resistor 1.0.0k',
    'LED resistor 10kk',
    'LED resistor 1,000 ohm',
    'LED resistor 1.000 ohm',
    'LED resistor 4.700 ohm',
    'LED resistor 1.000Ω',
    'LED resistor -10 ohm'
  ]) {
    const decision = classifyExistingProjectRequest(prompt, SPEC);
    assert.equal(decision.mode, 'refuse', prompt);
    assert.equal(decision.code, 'RESISTOR_VALUE_INVALID', prompt);
    assert.equal(decision.edit, undefined, prompt);
  }

  const ambiguous = [
    ['set R3 330Ω 680Ω', 'Which value should R3 use: 330Ω or 680Ω? Nothing was changed.\nR3에 330Ω과 680Ω 중 어느 값을 쓸까요? 아무것도 바꾸지 않았어요.'],
    ['LED resistor 330 ohm or 680 ohm', 'Which value should the resistor use: 330Ω or 680Ω? Nothing was changed.\n저항에 330Ω과 680Ω 중 어느 값을 쓸까요? 아무것도 바꾸지 않았어요.'],
    ['LED 저항 330옴 680옴', 'Which value should the resistor use: 330Ω or 680Ω? Nothing was changed.\n저항에 330Ω과 680Ω 중 어느 값을 쓸까요? 아무것도 바꾸지 않았어요.'],
    ['LED resistor 330 and 470 ohm', 'Which value should the resistor use: 330Ω or 470Ω? Nothing was changed.\n저항에 330Ω과 470Ω 중 어느 값을 쓸까요? 아무것도 바꾸지 않았어요.'],
    ['LED 저항 330하고 470옴', 'Which value should the resistor use: 330Ω or 470Ω? Nothing was changed.\n저항에 330Ω과 470Ω 중 어느 값을 쓸까요? 아무것도 바꾸지 않았어요.']
  ];
  for (const [prompt, message] of ambiguous) {
    const decision = classifyExistingProjectRequest(prompt, SPEC);
    assert.equal(decision.mode, 'refuse', prompt);
    assert.equal(decision.code, 'RESISTOR_VALUE_AMBIGUOUS', prompt);
    assert.equal(decision.edit, undefined, prompt);
    assert.equal(decision.message, message, prompt);
  }
});

test('explicit transition forms pick the destination value', () => {
  for (const [prompt, ohms, label] of [
    ['change the LED resistor from 330Ω to 680Ω', 680, '680Ω'],
    ['R3 330 ohm -> 680 ohm', 680, '680Ω'],
    ['LED 저항 330옴에서 680옴으로', 680, '680Ω'],
    ['LED 저항 330Ω에서 680Ω로', 680, '680Ω'],
    ['change the LED resistor from 680 to 1k', 1000, '1k']
  ]) {
    const decision = classifyExistingProjectRequest(prompt, SPEC);
    assert.equal(decision.mode, 'merge', prompt);
    assert.equal(decision.edit?.ohms, ohms, prompt);
    assert.equal(decision.edit?.label, label, prompt);
  }
});

test('values outside 1Ω to 10MΩ are refused with the allowed range', () => {
  for (const prompt of [
    'LED resistor R47',
    'LED resistor 1p',
    'LED resistor 100f',
    'LED resistor 1u',
    'LED resistor 10n',
    'LED resistor 1G',
    'LED resistor 1T',
    'LED resistor 0.99Ω',
    'LED resistor 10.1M'
  ]) {
    const decision = classifyExistingProjectRequest(prompt, SPEC);
    assert.equal(decision.mode, 'refuse', prompt);
    assert.equal(decision.code, 'RESISTOR_VALUE_INVALID', prompt);
    assert.equal(decision.edit, undefined, prompt);
    assert.match(decision.message, /1Ω~10MΩ 사이 값으로 알려 주세요/, prompt);
    assert.match(decision.message, /아무것도 바꾸지 않았어요/, prompt);
    assert.equal(decision.message.includes('않았습니다'), false, prompt);
    assert.match(decision.message, /1Ω/, prompt);
    assert.match(decision.message, /10MΩ/, prompt);
  }

  for (const [prompt, ohms, label, ohmsText] of [
    ['LED resistor 1Ω', 1, '1Ω', '1'],
    ['LED resistor 1R', 1, '1Ω', '1'],
    ['LED resistor 10M', 10000000, '10M', '10000000'],
    ['LED resistor 10MΩ', 10000000, '10M', '10000000']
  ]) {
    const decision = classifyExistingProjectRequest(prompt, SPEC);
    assert.equal(decision.mode, 'merge', prompt);
    assert.equal(decision.edit?.ohms, ohms, prompt);
    assert.equal(decision.edit?.label, label, prompt);
    assert.equal(decision.edit?.ohmsText, ohmsText, prompt);
  }
});

test('a lone m suffix asks for M instead of guessing megaohms', () => {
  const milli = resistorMilliSuffixMessage();
  for (const prompt of [
    'LED resistor 4m7',
    'LED resistor 1m',
    'LED resistor 2m2',
    'LED resistor 4.7m',
    // 1000m would be 1Ω, inside the allowed window. The suffix is still refused.
    'LED resistor 1000m'
  ]) {
    const decision = classifyExistingProjectRequest(prompt, SPEC);
    assert.equal(decision.mode, 'refuse', prompt);
    assert.equal(decision.code, 'RESISTOR_VALUE_INVALID', prompt);
    assert.equal(decision.edit, undefined, prompt);
    assert.equal(decision.message, milli, prompt);
    assert.match(decision.message, /Use M for megaohms, e\.g\. 4M7\./);
    assert.match(decision.message, /메가옴은 M을 써 주세요\. 예: 4M7\./);
    assert.equal(decision.message.includes('1Ω~10MΩ'), false, prompt);
  }

  for (const [prompt, ohms, label, ohmsText] of [
    ['LED resistor 4M7', 4700000, '4.7M', '4700000'],
    ['LED resistor 1M', 1000000, '1M', '1000000'],
    ['status LED resistor 1meg', 1000000, '1M', '1000000'],
    ['LED resistor 1MEG', 1000000, '1M', '1000000'],
    ['LED resistor 1Meg', 1000000, '1M', '1000000']
  ]) {
    const decision = classifyExistingProjectRequest(prompt, SPEC);
    assert.equal(decision.mode, 'merge', prompt);
    assert.equal(decision.edit?.ohms, ohms, prompt);
    assert.equal(decision.edit?.label, label, prompt);
    assert.equal(decision.edit?.ohmsText, ohmsText, prompt);
  }
});

test('SPICE validation and edit classification agree after the range check', () => {
  const rows = [
    ['R47', null],
    ['4k7', '4700'],
    ['470R', '470'],
    ['1R5', '1.5'],
    ['2M2', '2200000'],
    ['1meg', '1000000'],
    ['1MEG', '1000000'],
    ['1Meg', '1000000'],
    ['4M7', '4700000'],
    ['4m7', null],
    ['1m', null],
    ['2m2', null],
    ['4.7m', null],
    ['1000m', null],
    ['1.000 ohm', null],
    ['4.700 ohm', null],
    ['1.000Ω', null],
    ['1.5 ohm', '1.5'],
    ['4.75k', '4750'],
    ['4.99k', '4990'],
    ['1.05M', '1050000'],
    ['1.24k', '1240'],
    ['1p', null],
    ['1G', null],
    ['10kk', null],
    ['1e3', null],
    ['0', null],
    ['0R', null],
    ['100f', null],
    ['1.000k', null],
    ['1.000옴', null]
  ];
  for (const [token, ohmsText] of rows) {
    const spice = spiceResistorOhms(token);
    const decision = classifyExistingProjectRequest(`LED resistor ${token}`, SPEC);
    assert.equal(spice, ohmsText, token);
    if (ohmsText == null) {
      assert.equal(decision.mode, 'refuse', token);
      assert.equal(decision.code, 'RESISTOR_VALUE_INVALID', token);
      assert.equal(decision.edit, undefined, token);
    } else {
      assert.equal(decision.mode, 'merge', token);
      assert.equal(decision.edit?.ohmsText, ohmsText, token);
      assert.equal(decision.edit?.ohms, Number(ohmsText), token);
    }
  }
});

test('an RKM fraction is written to the schematic and the SPICE line', async () => {
  const projectDir = await mkdtemp(path.join(tmpdir(), 'chatpcb-resistor-rkm-'));
  const prompt = 'LED resistor 1R5';
  let plan;
  try {
    const generated = await generateMcuPeripheralProject({
      projectDir,
      prompt: STM32_USER_PROMPT,
      projectName: 'stm32_i2c'
    });
    plan = await createSchematicPatchPlan({
      projectDir,
      prompt,
      projectName: 'stm32_i2c',
      validateProjectImpl: passingErc,
      validateBoardImpl: passingDrc
    });
    const applied = await applySchematicPatch({
      projectDir,
      prompt,
      approved: true,
      expectedPatchId: plan.patchId,
      patchPlan: plan,
      validateProjectImpl: passingErc,
      validateBoardImpl: passingDrc,
      verifyAppliedProjectImpl: passingVerify
    });
    assert.equal(applied.applied, true, JSON.stringify(applied.reason));
    const schematic = await readFile(generated.files.schematic, 'utf8');
    assert.equal(schematicRefValue(schematic, 'R3'), '1.5Ω');
    const spice = await readFile(generated.files.spice, 'utf8');
    assert.match(spice, /^RLED\s+\S+\s+\S+\s+1\.5$/m);
  } finally {
    if (plan) await disposeSchematicPatchPlan(plan);
    await rm(projectDir, { force: true, recursive: true });
  }
});

test('4.99k is the schematic value and 4990 is the SPICE number', async () => {
  const projectDir = await mkdtemp(path.join(tmpdir(), 'chatpcb-resistor-499-'));
  const prompt = 'LED 저항 4.99k로';
  let plan;
  try {
    const generated = await generateMcuPeripheralProject({
      projectDir,
      prompt: STM32_USER_PROMPT,
      projectName: 'stm32_i2c'
    });
    plan = await createSchematicPatchPlan({
      projectDir,
      prompt,
      projectName: 'stm32_i2c',
      validateProjectImpl: passingErc,
      validateBoardImpl: passingDrc
    });
    const applied = await applySchematicPatch({
      projectDir,
      prompt,
      approved: true,
      expectedPatchId: plan.patchId,
      patchPlan: plan,
      validateProjectImpl: passingErc,
      validateBoardImpl: passingDrc,
      verifyAppliedProjectImpl: passingVerify
    });
    assert.equal(applied.applied, true, JSON.stringify(applied.reason));
    const schematic = await readFile(generated.files.schematic, 'utf8');
    assert.equal(schematicRefValue(schematic, 'R3'), '4.99k');
    const spice = await readFile(generated.files.spice, 'utf8');
    assert.match(spice, /^RLED\s+\S+\s+\S+\s+4990$/m);
    const saved = JSON.parse(await readFile(generated.files.spec, 'utf8'));
    const resistor = saved.peripherals.find((item) => item.kind === 'status-led-resistor');
    assert.equal(resistor?.value, '4990');
  } finally {
    if (plan) await disposeSchematicPatchPlan(plan);
    await rm(projectDir, { force: true, recursive: true });
  }
});
