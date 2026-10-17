import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { classifyExistingProjectRequest } from '../src/workflow/existing-project-edit.js';
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
  assert.match(decision.message, /저항 값/);
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
          assert.match(error.message, /저항 값/);
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
