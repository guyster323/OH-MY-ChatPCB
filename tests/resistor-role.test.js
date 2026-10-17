import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyExistingProjectEdit,
  classifyExistingProjectRequest,
  resistorRefAmbiguousMessage,
  resistorRefNotFoundMessage,
  resistorRefUnsupportedMessage,
  resistorTargetUnclearMessage,
  resistorValueAmbiguousMessage,
  resistorValueUnchangedMessage
} from '../src/workflow/existing-project-edit.js';

function seriesSpec(value = '330Ω') {
  return {
    mcu: { family: 'STM32' },
    schematic: {
      components: [
        { ref: 'R1', libId: 'Device:R', value: '5.1k' },
        { ref: 'R3', libId: 'ChatPCB:LED_RESISTOR', value },
        { ref: 'R4', libId: 'ChatPCB:I2C_PULLUP', value: '4.7k' }
      ]
    },
    peripherals: [
      { kind: 'status-led' },
      { kind: 'status-led-resistor', value }
    ],
    boardProfile: {
      productionParts: [
        { ref: 'R1', role: 'usb-c-cc1-pulldown', value: '5.1k' },
        { ref: 'R3', role: 'status-led-resistor', value },
        { ref: 'R4', role: 'i2c-scl-pullup', value: '4.7k' }
      ]
    }
  };
}

function componentValue(spec, ref) {
  return spec.schematic.components.find((part) => part.ref === ref)?.value;
}

test('another resistor role is refused and does not change the LED resistor', () => {
  const spec = seriesSpec('1k');
  const unsupported = resistorRefUnsupportedMessage('R3');
  const rows = [
    'CC 저항 5.1k → 10k',
    'I2C 저항 2.2k로',
    'SDA 저항 2.2k',
    'pull up resistor 2.2k',
    'USB CC resistor to 10k',
    '풀업 저항 4.7k로',
    'SCL 저항 4.7k로',
    'pull-up resistor 10k',
    'pullup resistor to 4.7k',
    'pull-down resistor 10k',
    '풀다운 저항 4.7k로',
    'change the CC1 pull-down to 5.1kΩ',
    'change the I2C pull-up to 2.2k',
    'BOOT 저항 10k로',
    '프로그래밍 저항 10k로',
    'reset resistor to 10k',
    '리셋 저항 10k로',
    'I2C 저항 470'
  ];
  for (const prompt of rows) {
    const before = structuredClone(spec);
    const decision = classifyExistingProjectRequest(prompt, spec);
    assert.equal(decision.mode, 'refuse', prompt);
    assert.equal(decision.code, 'RESISTOR_REF_UNSUPPORTED', prompt);
    assert.equal(decision.edit, undefined, prompt);
    assert.equal(decision.message, unsupported, prompt);
    assert.deepEqual(spec, before, prompt);
    assert.equal(componentValue(spec, 'R3'), '1k', prompt);
    assert.equal(componentValue(spec, 'R1'), '5.1k', prompt);
    assert.equal(componentValue(spec, 'R4'), '4.7k', prompt);
  }
});

test('an LED resistor edit still applies when the other role is only kept', () => {
  const spec = seriesSpec('1k');
  const rows = [
    ['LED 저항 680옴으로', 680, '680Ω'],
    ['status LED resistor to 680Ω', 680, '680Ω'],
    ['LED 저항 680옴으로. I2C는 그대로', 680, '680Ω'],
    ['LED 저항 680옴으로. I2C 저항은 그대로', 680, '680Ω'],
    ['keep I2C, set LED resistor 680 ohm', 680, '680Ω'],
    ['set the LED resistor to 680Ω, keep the pull-up', 680, '680Ω'],
    ['change the LED resistor to 680 ohm without removing I2C', 680, '680Ω']
  ];
  for (const [prompt, ohms, label] of rows) {
    const decision = classifyExistingProjectRequest(prompt, spec);
    assert.equal(decision.mode, 'merge', prompt);
    assert.equal(decision.code, undefined, prompt);
    assert.equal(decision.edit?.kind, 'resistor', prompt);
    assert.equal(decision.edit?.ohms, ohms, prompt);
    assert.equal(decision.edit?.label, label, prompt);
    const next = applyExistingProjectEdit(spec, decision.edit);
    assert.equal(componentValue(next, 'R3'), label, prompt);
    assert.equal(componentValue(next, 'R4'), '4.7k', prompt);
    assert.equal(componentValue(next, 'R1'), '5.1k', prompt);
    assert.equal(componentValue(spec, 'R3'), '1k', prompt);
  }
});

test('an LED edit and another role edit in one request asks instead of changing R3', () => {
  const spec = seriesSpec('1k');
  const decision = classifyExistingProjectRequest('LED 저항이랑 I2C 저항 2.2k로', spec);
  assert.equal(decision.mode, 'refuse');
  assert.equal(decision.code, 'RESISTOR_TARGET_UNCLEAR');
  assert.equal(decision.edit, undefined);
  assert.equal(decision.message, resistorTargetUnclearMessage('2200'));
  assert.equal(componentValue(spec, 'R3'), '1k');

  const unitless = classifyExistingProjectRequest('LED랑 I2C 저항 470', spec);
  assert.equal(unitless.mode, 'refuse');
  assert.equal(unitless.code, 'RESISTOR_REF_UNSUPPORTED');
  assert.equal(unitless.edit, undefined);
  assert.equal(componentValue(spec, 'R3'), '1k');

  const keptLed = classifyExistingProjectRequest('I2C 저항 2.2k로. LED는 그대로', spec);
  assert.equal(keptLed.mode, 'refuse');
  assert.equal(keptLed.code, 'RESISTOR_REF_UNSUPPORTED');
  assert.equal(keptLed.edit, undefined);
  assert.equal(componentValue(spec, 'R3'), '1k');
});

test('a kept reference is not a second resistor target', () => {
  const spec = seriesSpec('330Ω');
  const rows = [
    ['R3 680Ω, R4 그대로', 680, '680Ω'],
    ['set R3 to 680Ω, keep R4', 680, '680Ω'],
    ['R3 680Ω으로, R4는 유지', 680, '680Ω'],
    ['keep R4, set R3 to 680Ω', 680, '680Ω']
  ];
  for (const [prompt, ohms, label] of rows) {
    const decision = classifyExistingProjectRequest(prompt, spec);
    assert.equal(decision.mode, 'merge', `${prompt} ${decision.code ?? ''} ${decision.message ?? ''}`);
    assert.equal(decision.edit?.ohms, ohms, prompt);
    assert.equal(decision.edit?.label, label, prompt);
    const next = applyExistingProjectEdit(spec, decision.edit);
    assert.equal(componentValue(next, 'R3'), label, prompt);
    assert.equal(componentValue(next, 'R4'), '4.7k', prompt);
    assert.equal(componentValue(spec, 'R3'), '330Ω', prompt);
    assert.equal(componentValue(spec, 'R4'), '4.7k', prompt);
  }

  const both = classifyExistingProjectRequest('change R3 and R4 to 680Ω', spec);
  assert.equal(both.mode, 'refuse');
  assert.equal(both.code, 'RESISTOR_REF_AMBIGUOUS');
  assert.equal(both.message, resistorRefAmbiguousMessage(['R3', 'R4']));
  assert.equal(both.edit, undefined);
  const pair = classifyExistingProjectRequest('change R1 and R3 to 680Ω', spec);
  assert.equal(pair.code, 'RESISTOR_REF_AMBIGUOUS');
  assert.equal(pair.message, resistorRefAmbiguousMessage(['R1', 'R3']));
  const twoValues = classifyExistingProjectRequest('R3 680Ω, R4 470Ω', spec);
  assert.equal(twoValues.mode, 'refuse');
  assert.equal(twoValues.code, 'RESISTOR_VALUE_AMBIGUOUS');
  assert.equal(twoValues.message, resistorValueAmbiguousMessage('R3', ['680Ω', '470Ω']));
  assert.equal(componentValue(spec, 'R3'), '330Ω');
  assert.equal(componentValue(spec, 'R4'), '4.7k');
});

test('naming R3 on a board with no series resistor points at the LED resistor wording', () => {
  const hinted = [
    'There is no part R3 in this project. Say "LED resistor" instead, like "LED resistor to 470Ω". Nothing was changed.',
    '이 프로젝트에는 R3 부품이 없어요. "LED 저항 470Ω으로"처럼 \'LED 저항\'이라고 말해 주세요. 아무것도 바꾸지 않았어요.'
  ].join('\n');
  assert.equal(resistorRefNotFoundMessage('R3', { ledHint: true }), hinted);
  assert.equal(
    resistorRefNotFoundMessage('R9'),
    'There is no part R9 in this project. Nothing was changed.\n이 프로젝트에는 R9 부품이 없어요. 아무것도 바꾸지 않았어요.'
  );

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
  for (const prompt of ['change R3 to 470', 'change R3 to 470Ω', 'R3 680Ω으로']) {
    const decision = classifyExistingProjectRequest(prompt, noSeries);
    assert.equal(decision.mode, 'refuse', prompt);
    assert.equal(decision.code, 'RESISTOR_REF_NOT_FOUND', prompt);
    assert.equal(decision.message, hinted, prompt);
    assert.equal(decision.edit, undefined, prompt);
    assert.equal(componentValue(noSeries, 'R1'), '1k', prompt);
  }
  const otherRef = classifyExistingProjectRequest('change R9 to 470Ω', noSeries);
  assert.equal(otherRef.code, 'RESISTOR_REF_NOT_FOUND');
  assert.equal(otherRef.message, resistorRefNotFoundMessage('R9'));
  const present = seriesSpec('1k');
  const missingOnSeriesBoard = classifyExistingProjectRequest('change R9 to 470Ω', present);
  assert.equal(missingOnSeriesBoard.message, resistorRefNotFoundMessage('R9'));
});

test('the same LED resistor value is refused before anything is edited', () => {
  assert.equal(
    resistorValueUnchangedMessage('R3', '330Ω'),
    'R3 is already 330Ω. Nothing was changed.\nR3는 이미 330Ω이에요. 바꾼 것은 없어요.'
  );
  assert.equal(
    resistorValueUnchangedMessage('R5', '4.7k'),
    'R5 is already 4.7k. Nothing was changed.\nR5는 이미 4.7k예요. 바꾼 것은 없어요.'
  );

  const spec = seriesSpec('330Ω');
  const message = resistorValueUnchangedMessage('R3', '330Ω');
  const rows = [
    'LED 저항 330Ω으로',
    'change R3 to 330Ω',
    'LED resistor to 330 ohm',
    'LED resistor 330R',
    'change the LED resistor to 0.33k',
    'R3 330Ω으로'
  ];
  for (const prompt of rows) {
    const before = structuredClone(spec);
    const decision = classifyExistingProjectRequest(prompt, spec);
    assert.equal(decision.mode, 'refuse', prompt);
    assert.equal(decision.code, 'RESISTOR_VALUE_UNCHANGED', prompt);
    assert.equal(decision.edit, undefined, prompt);
    assert.equal(decision.message, message, prompt);
    assert.deepEqual(spec, before, prompt);
  }

  const different = classifyExistingProjectRequest('LED 저항 680옴으로', spec);
  assert.equal(different.mode, 'merge');
  assert.equal(different.edit?.ohms, 680);

  const kilo = seriesSpec('1k');
  const sameKilo = classifyExistingProjectRequest('LED resistor to 1000 ohm', kilo);
  assert.equal(sameKilo.code, 'RESISTOR_VALUE_UNCHANGED');
  assert.equal(sameKilo.message, resistorValueUnchangedMessage('R3', '1k'));

  const renamed = {
    mcu: { family: 'STM32' },
    schematic: {
      components: [
        { ref: 'R5', libId: 'ChatPCB:LED_RESISTOR', value: '330Ω', role: 'status-led-resistor' }
      ]
    },
    peripherals: [{ kind: 'status-led-resistor', value: '330' }]
  };
  const byRole = classifyExistingProjectRequest('LED resistor to 330 ohm', renamed);
  assert.equal(byRole.code, 'RESISTOR_VALUE_UNCHANGED');
  assert.equal(byRole.message, resistorValueUnchangedMessage('R5', '330Ω'));
  assert.equal(renamed.schematic.components[0].value, '330Ω');
});
