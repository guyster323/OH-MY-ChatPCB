import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyExistingProjectRequest
} from '../src/workflow/existing-project-edit.js';
import { assessRequestCoverage } from '../src/workflow/resistor-vocabulary.js';

function spec() {
  return {
    mcu: { family: 'STM32' },
    schematic: {
      components: [
        { ref: 'R3', libId: 'ChatPCB:LED_RESISTOR', value: '1k' },
        { ref: 'R4', libId: 'ChatPCB:I2C_PULLUP', value: '4.7k' },
        { ref: 'C1', libId: 'Device:C', value: '100nF' }
      ]
    },
    peripherals: [
      { kind: 'status-led' },
      { kind: 'status-led-resistor', value: '1k' }
    ],
    boardProfile: {
      productionParts: [
        { ref: 'R3', role: 'status-led-resistor', value: '1k' },
        { ref: 'R4', role: 'i2c-scl-pullup', value: '4.7k' }
      ]
    }
  };
}

function decision(prompt) {
  return classifyExistingProjectRequest(prompt, spec());
}

// A4 turns the daemon's second !covered check into false. classify already
// refuses that edit, and the daemon only reaches the gate when the user prompt
// and the generate prompt are the same text. This assertion stays green if A4
// is applied. It records that the gate is not an independent behavior.
test('mutant A4 an uncovered resistor edit is refused by classify', () => {
  const prompt = 'change the LED resistor to 680Ω please xyzzy';
  const result = decision(prompt);
  assert.equal(result.mode, 'refuse');
  assert.equal(result.code, 'RESISTOR_TARGET_UNCLEAR');
  assert.equal(result.edit, undefined);
  assert.equal(assessRequestCoverage(prompt).covered, false);
});

test('mutant K2 a kept cable length is not a resistor keep', () => {
  const prompt = 'LED 저항 680Ω으로, 케이블 저항은 그대로';
  const coverage = assessRequestCoverage(prompt);
  const result = decision(prompt);
  assert.equal(coverage.keepNonResistor, true, 'length keep');
  assert.equal(coverage.covered, false);
  assert.equal(result.mode, 'refuse');
  assert.equal(result.code, 'RESISTOR_TARGET_UNCLEAR');
  assert.equal(result.edit, undefined);
});

test('mutant K5 keep the widget is leftover, not a resistor keep', () => {
  const prompt = 'set the LED resistor to 680Ω and keep the widget';
  const coverage = assessRequestCoverage(prompt);
  const result = decision(prompt);
  assert.equal(coverage.unknownLeftover, true);
  assert.equal(coverage.covered, false);
  assert.equal(result.code, 'RESISTOR_TARGET_UNCLEAR');
  assert.equal(result.edit, undefined);
});

test('mutant K6 a non-resistor keep with an unknown word is still an unknown role', () => {
  const prompt = 'LED 저항 680Ω으로, 커패시터 저항 xyzzy 4.7k는 건드리지 마';
  const coverage = assessRequestCoverage(prompt);
  assert.equal(coverage.keepNonResistor, true);
  assert.equal(coverage.unknownRoleValue, true);
  assert.equal(coverage.covered, false);
  assert.equal(decision(prompt).code, 'RESISTOR_REF_UNSUPPORTED');
});

test('mutant K7 건드리지 마 on a capacitor resistor is a non-resistor keep', () => {
  const prompt = 'LED 저항 680Ω으로, 커패시터 저항은 건드리지 마';
  const coverage = assessRequestCoverage(prompt);
  const result = decision(prompt);
  assert.equal(coverage.keepNonResistor, true);
  assert.equal(coverage.covered, false);
  assert.equal(result.code, 'RESISTOR_TARGET_UNCLEAR');
  assert.equal(result.edit, undefined);
});

test('mutant Q1 should I change, please stays a question for the provider', () => {
  const prompt = 'should I change the LED resistor to 680Ω, please?';
  const coverage = assessRequestCoverage(prompt);
  const result = decision(prompt);
  assert.equal(coverage.adviceQuestion, true);
  assert.equal(coverage.permittedEdit, false);
  assert.equal(result.mode, 'refuse');
  assert.equal(result.code, undefined);
  assert.equal(result.edit, undefined);
});

test('mutant R3 a malformed RKM next to a real value asks which resistor', () => {
  const prompt = 'change the LED resistor to 680Ω near the 4K75 display';
  const coverage = assessRequestCoverage(prompt);
  const result = decision(prompt);
  assert.equal(coverage.malformedRkm, true);
  assert.equal(coverage.unknownLeftover, false);
  assert.equal(coverage.covered, false);
  assert.equal(result.code, 'RESISTOR_TARGET_UNCLEAR');
  assert.equal(result.edit, undefined);
});

test('mutant A2 an unknown leftover word blocks the edit', () => {
  const prompt = 'change the LED resistor to 680Ω, xyzzy';
  const coverage = assessRequestCoverage(prompt);
  const result = decision(prompt);
  assert.equal(coverage.unknownLeftover, true);
  assert.equal(coverage.covered, false);
  assert.equal(result.code, 'RESISTOR_TARGET_UNCLEAR');
  assert.equal(result.edit, undefined);
});

test('mutant K3 a non-resistor keep is not covered', () => {
  const prompt = 'change the LED resistor to 680Ω, leave C1 alone';
  const coverage = assessRequestCoverage(prompt);
  const result = decision(prompt);
  assert.equal(coverage.keepNonResistor, true);
  assert.equal(coverage.covered, false);
  assert.equal(result.code, 'RESISTOR_TARGET_UNCLEAR');
  assert.equal(result.edit, undefined);
});

test('mutant P11 roughly is not a covered edit', () => {
  const prompt = 'change the LED resistor to 680Ω roughly';
  const coverage = assessRequestCoverage(prompt);
  const result = decision(prompt);
  assert.equal(coverage.approximate, true);
  assert.equal(coverage.unknownLeftover, false);
  assert.equal(coverage.covered, false);
  assert.equal(result.code, 'RESISTOR_TARGET_UNCLEAR');
  assert.equal(result.edit, undefined);
});

test('mutant Q12 an advice question is not covered', () => {
  const prompt = 'why change the LED resistor to 680Ω?';
  const coverage = assessRequestCoverage(prompt);
  const result = decision(prompt);
  assert.equal(coverage.adviceQuestion, true);
  assert.equal(coverage.unknownLeftover, false);
  assert.equal(coverage.covered, false);
  assert.equal(result.mode, 'refuse');
  assert.equal(result.code, undefined);
  assert.equal(result.edit, undefined);
});
