import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  applyExistingProjectEdit,
  applyMergedProjectEdit,
  appliesBeforeProvider,
  blocksBeforeProvider,
  classifyExistingProjectRequest,
  splitResistorClauses,
  resistorRefAmbiguousMessage,
  resistorRefNotFoundMessage,
  resistorRefUnsupportedMessage,
  resistorTargetUnclearMessage,
  resistorAmbiguousMessage,
  resistorUnitlessMessage,
  resistorValueAmbiguousMessage,
  resistorValueInvalidMessage,
  resistorValueOutOfRangeMessage,
  resistorValueUnchangedMessage
} from '../src/workflow/existing-project-edit.js';
import { assessRequestCoverage, CHOICE_JOINERS, editVerbNegationSpans, geonaHedgeSpans, KEEP_CUES, LED_RESISTOR_SYNONYMS, ledResistorSynonymIsNoun, vocabularyAllowLists } from '../src/workflow/resistor-vocabulary.js';

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
    ['LED 저항 680옴으로. I2C 저항은 그대로', 680, '680Ω'],
    ['set the LED resistor to 680Ω, keep the pull-up', 680, '680Ω']
  ];
  const bareI2c = [
    'LED 저항 680옴으로. I2C는 그대로',
    'keep I2C, set LED resistor 680 ohm',
    'change the LED resistor to 680 ohm without removing I2C'
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
  for (const prompt of bareI2c) {
    const decision = classifyExistingProjectRequest(prompt, spec);
    assert.equal(decision.mode, 'refuse', prompt);
    assert.equal(decision.code, 'RESISTOR_TARGET_UNCLEAR', `${prompt} ${decision.code ?? ''}`);
    assert.equal(decision.edit, undefined, prompt);
    assert.equal(appliesBeforeProvider(prompt, decision), false, prompt);
    assert.equal(blocksBeforeProvider(prompt, decision), true, prompt);
    assert.equal(componentValue(spec, 'R3'), '1k', prompt);
    assert.equal(componentValue(spec, 'R4'), '4.7k', prompt);
  }
});

test('a bare leave of the target is RESISTOR_AMBIGUOUS', () => {
  const spec = seriesSpec('1k');
  const message = resistorAmbiguousMessage();
  const ambiguous = [
    'leave R3, set the LED resistor to 680Ω',
    'leave R3 and set the LED resistor to 680Ω',
    'leave R3 alone and set the LED resistor to 680Ω',
    'leave the LED resistor and set R3 to 680Ω'
  ];
  for (const prompt of ambiguous) {
    const before = structuredClone(spec);
    const decision = classifyExistingProjectRequest(prompt, spec);
    assert.equal(decision.mode, 'refuse', `${prompt} ${decision.code ?? ''}`);
    assert.equal(decision.code, 'RESISTOR_AMBIGUOUS', prompt);
    assert.equal(decision.message, message, prompt);
    assert.equal(decision.edit, undefined, prompt);
    assert.equal(blocksBeforeProvider(prompt, decision), true, prompt);
    assert.equal(appliesBeforeProvider(prompt, decision), false, prompt);
    assert.deepEqual(spec, before, prompt);
    assert.equal(componentValue(spec, 'R3'), '1k', prompt);
    assert.equal(componentValue(spec, 'R1'), '5.1k', prompt);
    assert.equal(componentValue(spec, 'R4'), '4.7k', prompt);
  }

  const applies = [
    ['leave R1, set the LED resistor to 680Ω', 680, '680Ω'],
    ['leave R1 and change the LED resistor to 680Ω', 680, '680Ω']
  ];
  for (const [prompt, ohms, label] of applies) {
    const before = structuredClone(spec);
    const decision = classifyExistingProjectRequest(prompt, spec);
    assert.equal(decision.mode, 'merge', `${prompt} ${decision.code ?? ''} ${decision.message ?? ''}`);
    assert.equal(decision.code, undefined, prompt);
    assert.equal(decision.edit?.kind, 'resistor', prompt);
    assert.equal(decision.edit?.ohms, ohms, prompt);
    assert.equal(decision.edit?.label, label, prompt);
    assert.equal(decision.edit?.ref, 'R3', prompt);
    assert.equal(appliesBeforeProvider(prompt, decision), true, prompt);
    assert.equal(blocksBeforeProvider(prompt, decision), false, prompt);
    const next = applyExistingProjectEdit(spec, decision.edit);
    assert.equal(componentValue(next, 'R3'), label, prompt);
    assert.equal(componentValue(next, 'R1'), '5.1k', prompt);
    assert.equal(componentValue(next, 'R4'), '4.7k', prompt);
    assert.deepEqual(spec, before, prompt);
  }
});

test("don't touch of another resistor role applies the LED edit", () => {
  const spec = seriesSpec('1k');
  const prompts = [
    "don't touch the pull-ups, set the LED resistor to 680Ω",
    "don't touch the I2C pull-up, set the LED resistor to 680Ω",
    "don't touch R1 or the pull-ups, set the LED resistor to 680Ω",
    "don't touch the I2C pull-up R1 and set the LED resistor to 680Ω",
    "don't touch R1 the pull-up and set the LED resistor to 680Ω"
  ];
  for (const prompt of prompts) {
    const before = structuredClone(spec);
    const decision = classifyExistingProjectRequest(prompt, spec);
    assert.equal(decision.mode, 'merge', `${prompt} ${decision.code ?? ''} ${decision.message ?? ''}`);
    assert.equal(decision.code, undefined, prompt);
    assert.equal(decision.edit?.kind, 'resistor', prompt);
    assert.equal(decision.edit?.ohms, 680, prompt);
    assert.equal(decision.edit?.label, '680Ω', prompt);
    assert.equal(decision.edit?.ref, 'R3', prompt);
    assert.equal(appliesBeforeProvider(prompt, decision), true, prompt);
    assert.equal(blocksBeforeProvider(prompt, decision), false, prompt);
    const next = applyExistingProjectEdit(spec, decision.edit);
    assert.equal(componentValue(next, 'R3'), '680Ω', prompt);
    assert.equal(componentValue(next, 'R1'), '5.1k', prompt);
    assert.equal(componentValue(next, 'R4'), '4.7k', prompt);
    assert.deepEqual(spec, before, prompt);
  }
});

test('an LED edit and another role edit in one request asks instead of changing R3', () => {
  const spec = seriesSpec('1k');
  const decision = classifyExistingProjectRequest('LED 저항이랑 I2C 저항 2.2k로', spec);
  assert.equal(decision.mode, 'refuse');
  assert.equal(decision.code, 'RESISTOR_REF_UNSUPPORTED');
  assert.equal(decision.edit, undefined);
  assert.equal(decision.message, resistorRefUnsupportedMessage('R3'));
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

test("two values for one resistor target ('680Ω and 1k', '1k~680Ω', 'vs', '|', '이나', '둘 중') are RESISTOR_VALUE_AMBIGUOUS regardless of the current value", () => {
  const rows = [
    ['change the LED resistor to 680Ω and 1k', ['680Ω', '1k']],
    ['LED resistor 470~680Ω', ['470Ω', '680Ω']],
    ['LED 저항 470~680Ω으로', ['470Ω', '680Ω']],
    ['LED resistor 680Ω vs 1k', ['680Ω', '1k']],
    ['LED resistor 680Ω | 1kΩ', ['680Ω', '1k']],
    ['set the LED resistor to either 680Ω or 1k', ['680Ω', '1k']],
    ['LED 저항 680Ω, 1k 둘 중 하나로', ['680Ω', '1k']],
    ['LED 저항을 680Ω이나 1k로 바꿔줘', ['680Ω', '1k']],
    ['LED 저항 680Ω하고 1kΩ으로', ['680Ω', '1k']],
    ['680Ω이나 1kΩ', ['680Ω', '1k']],
    ['LED 저항 680Ω이나 1kΩ으로', ['680Ω', '1k']],
    ['1k and 680Ω', ['1k', '680Ω']],
    ['1k~680Ω', ['1k', '680Ω']]
  ];
  for (const current of ['330Ω', '1k']) {
    const spec = seriesSpec(current);
    for (const [prompt, labels] of rows) {
      const decision = classifyExistingProjectRequest(prompt, spec);
      assert.equal(decision.mode, 'refuse', `${current} ${prompt} ${decision.code ?? ''}`);
      assert.equal(decision.code, 'RESISTOR_VALUE_AMBIGUOUS', `${current} ${prompt} ${decision.code ?? ''} ${decision.edit?.label ?? ''}`);
      assert.equal(decision.edit, undefined, prompt);
      assert.equal(decision.message, resistorValueAmbiguousMessage(null, labels), `${current} ${prompt}`);
      assert.equal(assessRequestCoverage(prompt).alternative, true, prompt);
      assert.equal(blocksBeforeProvider(prompt, decision), true, prompt);
      assert.equal(componentValue(spec, 'R3'), current, prompt);
    }
  }
  for (const prompt of ['change R3 to 470 or 680', 'set R3 to 330 680', 'LED 저항 330 680']) {
    const decision = classifyExistingProjectRequest(prompt, seriesSpec('330Ω'));
    assert.equal(decision.code, 'RESISTOR_VALUE_INVALID', `${prompt} ${decision.code ?? ''}`);
    assert.match(decision.message ?? '', /단위/, prompt);
    assert.equal(decision.edit, undefined, prompt);
  }
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

// R5 is the LED series resistor by role and libId. R3 is an I2C pull-up.
function renumberedLedSpec() {
  return {
    sourcePrompt: 'existing',
    mcu: { family: 'STM32' },
    schematic: {
      components: [
        { ref: 'R3', libId: 'Device:R', value: '4.7k', role: 'i2c-sda-pullup' },
        { ref: 'R5', libId: 'ChatPCB:LED_RESISTOR', value: '330', role: 'status-led-resistor' },
        { ref: 'C1', libId: 'Device:C', value: '100n' },
        { ref: 'D1', libId: 'ChatPCB:STATUS_LED', value: 'STATUS_LED', role: 'status-led' }
      ]
    },
    peripherals: [
      { kind: 'status-led' },
      { kind: 'status-led-resistor', value: '330Ω' },
      { kind: 'i2c-sensor-header' }
    ],
    boardProfile: {
      productionParts: [
        { ref: 'R3', role: 'i2c-sda-pullup', libId: 'Device:R', value: '4.7k' },
        { ref: 'R5', role: 'status-led-resistor', libId: 'ChatPCB:LED_RESISTOR', value: '330' }
      ]
    }
  };
}

function schematicSymbol(ref, libId, value, at) {
  return [
    `  (symbol (lib_id "${libId}") (at ${at} 0 0)`,
    `    (property "Reference" "${ref}" (at ${at} 0 0))`,
    `    (property "Value" "${value}" (at ${at} 0 0)))`
  ].join('\n');
}

test('a renumbered LED resistor is the only part the value is written to', async () => {
  const spec = renumberedLedSpec();
  const unsupported = resistorRefUnsupportedMessage('R5');
  const refused = classifyExistingProjectRequest('change R3 to 680Ω', spec);
  assert.equal(refused.mode, 'refuse');
  assert.equal(refused.code, 'RESISTOR_REF_UNSUPPORTED');
  assert.equal(refused.edit, undefined);
  assert.equal(refused.message, unsupported);
  assert.match(refused.message, /\(R5\)/);
  assert.equal(componentValue(spec, 'R3'), '4.7k');
  assert.equal(componentValue(spec, 'R5'), '330');

  for (const prompt of ['LED 저항 680Ω으로', 'change R5 to 680Ω']) {
    const before = renumberedLedSpec();
    const decision = classifyExistingProjectRequest(prompt, before);
    assert.equal(decision.mode, 'merge', prompt);
    assert.equal(decision.edit?.kind, 'resistor', prompt);
    assert.equal(decision.edit?.ohms, 680, prompt);
    assert.equal(decision.edit?.ref, 'R5', prompt);
    const next = applyExistingProjectEdit(before, decision.edit);
    assert.equal(componentValue(next, 'R5'), '680Ω', prompt);
    assert.equal(componentValue(next, 'R3'), '4.7k', prompt);
    assert.equal(componentValue(before, 'R5'), '330', prompt);
    assert.equal(next.peripherals.find((item) => item.kind === 'status-led-resistor').value, '680', prompt);
    const pullup = next.boardProfile.productionParts.find((part) => part.ref === 'R3');
    const series = next.boardProfile.productionParts.find((part) => part.ref === 'R5');
    assert.equal(pullup.value, '4.7k', prompt);
    assert.equal(series.value, '680Ω', prompt);
  }

  const projectDir = await mkdtemp(path.join(tmpdir(), 'chatpcb-r5-led-'));
  const stored = renumberedLedSpec();
  const schematic = [
    '(kicad_sch (version 20250114) (generator chatpcb)',
    schematicSymbol('R3', 'Device:R', '4.7k', 0),
    schematicSymbol('R5', 'ChatPCB:LED_RESISTOR', '330', 10),
    schematicSymbol('D1', 'ChatPCB:STATUS_LED', 'STATUS_LED', 20),
    ')'
  ].join('\n');
  const spice = ['* renumbered', 'R3 v3v3 sda 4700', 'RLED v3v3 led 330', '.end', ''].join('\n');
  await writeFile(path.join(projectDir, 'board.chatpcb.json'), `${JSON.stringify(stored, null, 2)}\n`);
  await writeFile(path.join(projectDir, 'board.kicad_sch'), schematic);
  await writeFile(path.join(projectDir, 'board_simulation.cir'), spice);
  try {
    const blocked = classifyExistingProjectRequest('change R3 to 680Ω', stored);
    assert.equal(blocked.code, 'RESISTOR_REF_UNSUPPORTED');
    assert.equal(await readFile(path.join(projectDir, 'board.kicad_sch'), 'utf8'), schematic);
    assert.equal(await readFile(path.join(projectDir, 'board_simulation.cir'), 'utf8'), spice);

    for (const prompt of ['LED 저항 680Ω으로', 'change R5 to 680Ω']) {
      await writeFile(path.join(projectDir, 'board.kicad_sch'), schematic);
      await writeFile(path.join(projectDir, 'board_simulation.cir'), spice);
      await writeFile(path.join(projectDir, 'board.chatpcb.json'), `${JSON.stringify(renumberedLedSpec(), null, 2)}\n`);
      const decision = classifyExistingProjectRequest(prompt, renumberedLedSpec());
      await applyMergedProjectEdit({
        projectDir,
        existingSpec: renumberedLedSpec(),
        edit: decision.edit
      });
      const written = await readFile(path.join(projectDir, 'board.kicad_sch'), 'utf8');
      const netlist = await readFile(path.join(projectDir, 'board_simulation.cir'), 'utf8');
      assert.equal(schematicRefValue(written, 'R5'), '680Ω', prompt);
      assert.equal(schematicRefValue(written, 'R3'), '4.7k', prompt);
      assert.match(netlist, /^RLED v3v3 led 680$/m, prompt);
      assert.match(netlist, /^R3 v3v3 sda 4700$/m, prompt);
      const saved = JSON.parse(await readFile(path.join(projectDir, 'board.chatpcb.json'), 'utf8'));
      assert.equal(saved.schematic.components.find((part) => part.ref === 'R5').value, '680Ω', prompt);
      assert.equal(saved.schematic.components.find((part) => part.ref === 'R3').value, '4.7k', prompt);
    }
  } finally {
    await rm(projectDir, { force: true, recursive: true });
  }
});

function schematicRefValue(schematic, ref) {
  const match = schematic.match(new RegExp(`\\(property "Reference" "${ref}"[\\s\\S]*?\\(property "Value" "([^"]*)"`));
  return match?.[1] ?? null;
}

test('a non-resistor ref is not edited as the LED resistor', () => {
  const spec = renumberedLedSpec();
  const unsupported = resistorRefUnsupportedMessage('R5');
  const rows = [
    ['change C1 to 470Ω', 'RESISTOR_REF_UNSUPPORTED', unsupported],
    ['change D1 to 680Ω', 'RESISTOR_REF_UNSUPPORTED', unsupported],
    ['J2 저항 680옴으로', 'RESISTOR_REF_NOT_FOUND', resistorRefNotFoundMessage('J2')]
  ];
  for (const [prompt, code, message] of rows) {
    const before = structuredClone(spec);
    const decision = classifyExistingProjectRequest(prompt, spec);
    assert.equal(decision.mode, 'refuse', prompt);
    assert.equal(decision.code, code, prompt);
    assert.equal(decision.edit, undefined, prompt);
    assert.equal(decision.message, message, prompt);
    assert.deepEqual(spec, before, prompt);
    assert.equal(componentValue(spec, 'R3'), '4.7k', prompt);
    assert.equal(componentValue(spec, 'R5'), '330', prompt);
  }

  const withHeader = renumberedLedSpec();
  withHeader.schematic.components.push({ ref: 'J2', libId: 'Connector_Generic:Conn_01x04', value: 'I2C_CONNECTOR', role: 'i2c-sensor-header' });
  const namedHeader = classifyExistingProjectRequest('J2 저항 680옴으로', withHeader);
  assert.equal(namedHeader.code, 'RESISTOR_REF_UNSUPPORTED');
  assert.equal(namedHeader.message, unsupported);
  assert.equal(withHeader.schematic.components.find((part) => part.ref === 'J2').value, 'I2C_CONNECTOR');
  assert.equal(componentValue(withHeader, 'R5'), '330');
});

// The only resistor role is the LED series resistor. Bare "저항" may name it.
function ledOnlySpec(value = '1k') {
  return {
    mcu: { family: 'STM32' },
    schematic: {
      components: [
        { ref: 'R3', libId: 'ChatPCB:LED_RESISTOR', value, role: 'status-led-resistor' },
        { ref: 'D1', libId: 'ChatPCB:STATUS_LED', value: 'STATUS_LED', role: 'status-led' },
        { ref: 'C1', libId: 'Device:C', value: '100n' }
      ]
    },
    peripherals: [
      { kind: 'status-led' },
      { kind: 'status-led-resistor', value }
    ],
    boardProfile: {
      productionParts: [
        { ref: 'R3', role: 'status-led-resistor', value }
      ]
    }
  };
}

const DENIED_ROLE_PROMPTS = [
  '디바운스 저항 10k로',
  'debounce resistor 10k',
  '분압 저항 10k',
  'divider resistor 10k',
  'feedback resistor 10k',
  '피드백 저항 10k로',
  '버튼 저항 10k로',
  'button resistor 10k',
  'gate resistor 10Ω',
  '게이트 저항 10Ω으로',
  'termination resistor 120Ω',
  '종단 저항 120Ω',
  '베이스 저항 680Ω으로',
  'base resistor 680Ω',
  'bias resistor 10k',
  '바이어스 저항 10k로',
  'sense resistor 10Ω',
  '센스 저항 10Ω',
  'shunt resistor 10Ω',
  '션트 저항 10Ω',
  'sense resistor 0.1Ω',
  'change the sense resistor to 0.1Ω',
  '센스 저항 0.1Ω으로',
  'shunt resistor 10mΩ',
  '션트 저항 0.05Ω',
  'current sense resistor 0.1Ω',
  'current-sense resistor 0.1Ω',
  'pull-up resistor 2.2k',
  '풀업 저항 2.2k로',
  'CC resistor 10k',
  'CC 저항 10k로',
  'I2C resistor 2.2k',
  'I2C 저항 2.2k로',
  'foo resistor 10k',
  '파란 저항 10k',
  'big resistor 10k',
  '큰 저항 10k로',
  'the second resistor 10k',
  '두 번째 저항 10k로'
];

const ALLOWED_ROLE_PROMPTS = [
  ['LED 저항 680Ω으로', 680, '680Ω'],
  ['change the LED resistor to 680Ω', 680, '680Ω'],
  ['전류 제한 저항 680Ω', 680, '680Ω'],
  ['current-limiting resistor 680Ω', 680, '680Ω'],
  ['current limiting resistor 470Ω', 470, '470Ω'],
  ['current-limiting resistor 470Ω', 470, '470Ω'],
  ['전류제한 저항 470Ω', 470, '470Ω'],
  ['전류 제한 저항 470Ω으로', 470, '470Ω'],
  ['R3 680Ω', 680, '680Ω'],
  ['change R3 to 680Ω', 680, '680Ω'],
  ['LED의 저항 680Ω으로', 680, '680Ω'],
  ['set the resistor for the LED to 680Ω', 680, '680Ω'],
  ['상태 LED 저항 680Ω으로', 680, '680Ω'],
  ['LED 직렬 저항 680Ω', 680, '680Ω']
];

test('a modifier that is not an LED phrase does not change the LED resistor', () => {
  const spec = seriesSpec('1k');
  const unsupported = resistorRefUnsupportedMessage('R3');
  for (const prompt of DENIED_ROLE_PROMPTS) {
    const before = structuredClone(spec);
    const decision = classifyExistingProjectRequest(prompt, spec);
    assert.equal(decision.mode, 'refuse', `${prompt} ${decision.code ?? ''} ${decision.message ?? ''}`);
    assert.equal(decision.code, 'RESISTOR_REF_UNSUPPORTED', prompt);
    assert.equal(decision.message, unsupported, prompt);
    assert.equal(decision.edit, undefined, prompt);
    assert.deepEqual(spec, before, prompt);
    assert.equal(componentValue(spec, 'R3'), '1k', prompt);
    assert.equal(componentValue(spec, 'R1'), '5.1k', prompt);
    assert.equal(componentValue(spec, 'R4'), '4.7k', prompt);
  }
});

test('LED phrases and the series ref still change only the LED resistor', () => {
  const spec = seriesSpec('1k');
  for (const [prompt, ohms, label] of ALLOWED_ROLE_PROMPTS) {
    const decision = classifyExistingProjectRequest(prompt, spec);
    assert.equal(decision.mode, 'merge', `${prompt} ${decision.code ?? ''} ${decision.message ?? ''}`);
    assert.equal(decision.edit?.kind, 'resistor', prompt);
    assert.equal(decision.edit?.ohms, ohms, prompt);
    assert.equal(decision.edit?.label, label, prompt);
    const next = applyExistingProjectEdit(spec, decision.edit);
    assert.equal(componentValue(next, 'R3'), label, prompt);
    assert.equal(componentValue(next, 'R1'), '5.1k', prompt);
    assert.equal(componentValue(next, 'R4'), '4.7k', prompt);
    assert.equal(componentValue(spec, 'R3'), '1k', prompt);
  }
});

test('a current-limiting phrase with no LED word applies before the provider', () => {
  const spec = seriesSpec('1k');
  const local = [
    'current limiting resistor 470Ω',
    'current-limiting resistor 470Ω',
    '전류제한 저항 470Ω',
    '전류 제한 저항 470Ω으로'
  ];
  for (const prompt of local) {
    const decision = classifyExistingProjectRequest(prompt, spec);
    assert.equal(decision.mode, 'merge', prompt);
    assert.equal(decision.edit?.ohms, 470, prompt);
    assert.equal(appliesBeforeProvider(prompt, decision), true, prompt);
  }
  const covered = [
    'Change the status LED series resistor to 680 ohm',
    'current-limiting resistor 680Ω and set the LED',
    '전류 제한 저항 680Ω LED'
  ];
  for (const prompt of covered) {
    const decision = classifyExistingProjectRequest(prompt, spec);
    assert.equal(decision.mode, 'merge', `${prompt} ${decision.code ?? ''}`);
    assert.equal(appliesBeforeProvider(prompt, decision), true, prompt);
  }
  // Sense/shunt is another role. A cable keep is leftover. 1k is already the value.
  // 0.1Ω is outside the LED resistor range.
  const held = [
    'current sense resistor 0.1Ω',
    'change the sense resistor to 0.1Ω',
    'current-sense resistor 0.1Ω',
    'change R3 to 2.2kΩ and keep the 1 m cable',
    'set the LED resistor to 1kΩ',
    'current limiting resistor 0.1Ω'
  ];
  for (const prompt of held) {
    const decision = classifyExistingProjectRequest(prompt, spec);
    assert.equal(appliesBeforeProvider(prompt, decision), false, `${prompt} ${decision.mode} ${decision.code ?? ''}`);
  }
});

test('a synonym fragment outside the modifier, or a leftover non-ohm measurement, leaves R3 unchanged', () => {
  const spec = seriesSpec('1k');
  const unclear = resistorTargetUnclearMessage('680');
  const refused = [
    'set the LED resistor to 680Ω with current limit 10mA',
    'set the LED resistor to 680Ω, current limit 10mA',
    'set the LED resistor to 680Ω for a 10mA current limit',
    'set the LED resistor to 680Ω limit 10mA',
    'set the LED resistor to 680Ω and current-limit the LED at 10mA',
    'set the LED resistor to 680Ω, current 10mA',
    'set the LED resistor to 680Ω and status 3.3V',
    'LED 저항 680Ω, 전류 제한 10mA'
  ];
  for (const prompt of refused) {
    const before = structuredClone(spec);
    const decision = classifyExistingProjectRequest(prompt, spec);
    assert.equal(decision.mode, 'refuse', `${prompt} ${decision.code ?? ''} ${decision.message ?? ''}`);
    assert.equal(decision.code, 'RESISTOR_TARGET_UNCLEAR', prompt);
    assert.equal(decision.message, unclear, prompt);
    assert.equal(decision.edit, undefined, prompt);
    assert.equal(blocksBeforeProvider(prompt, decision), true, prompt);
    assert.equal(appliesBeforeProvider(prompt, decision), false, prompt);
    assert.deepEqual(spec, before, prompt);
    assert.equal(componentValue(spec, 'R3'), '1k', prompt);
  }
  for (const prompt of ['set the current limit resistor to 680Ω', 'LED 전류 제한용 저항 680Ω']) {
    const decision = classifyExistingProjectRequest(prompt, spec);
    assert.equal(decision.mode, 'merge', `${prompt} ${decision.code ?? ''} ${decision.message ?? ''}`);
    assert.equal(decision.edit?.ohms, 680, prompt);
    assert.equal(decision.edit?.ref, 'R3', prompt);
    assert.equal(appliesBeforeProvider(prompt, decision), true, prompt);
    assert.equal(blocksBeforeProvider(prompt, decision), false, prompt);
    const next = applyExistingProjectEdit(spec, decision.edit);
    assert.equal(componentValue(next, 'R3'), '680Ω', prompt);
    assert.equal(componentValue(next, 'R1'), '5.1k', prompt);
    assert.equal(componentValue(next, 'R4'), '4.7k', prompt);
    assert.equal(componentValue(spec, 'R3'), '1k', prompt);
  }
});

function noLedSpec() {
  return {
    mcu: { family: 'STM32' },
    schematic: {
      components: [
        { ref: 'R1', libId: 'Device:R', value: '4.7k', role: 'i2c-scl-pullup' },
        { ref: 'R2', libId: 'Device:R', value: '4.7k', role: 'i2c-sda-pullup' },
        { ref: 'C1', libId: 'Device:C', value: '100n' }
      ]
    },
    peripherals: [{ kind: 'i2c-sensor-header' }]
  };
}

test('current limiting on a board with no LED series resistor asks which resistor', () => {
  const spec = noLedSpec();
  const localOnLed = [
    '전류제한 저항 680Ω으로',
    '전류 제한 저항 470Ω으로',
    'current limiting resistor to 680Ω',
    'current-limiting resistor 470Ω'
  ];
  for (const prompt of localOnLed) {
    const before = structuredClone(spec);
    const decision = classifyExistingProjectRequest(prompt, spec);
    assert.equal(decision.mode, 'refuse', `${prompt} ${decision.code ?? ''} ${decision.message ?? ''}`);
    assert.equal(decision.code, 'RESISTOR_TARGET_UNCLEAR', `${prompt} ${decision.code ?? ''}`);
    assert.equal(decision.edit, undefined, prompt);
    assert.equal(appliesBeforeProvider(prompt, decision), false, prompt);
    assert.equal(blocksBeforeProvider(prompt, decision), true, prompt);
    assert.deepEqual(spec, before, prompt);
  }
  const ask = [
    'LED 저항 680Ω',
    'LED 저항 680Ω으로 바꿔줘',
    'change the LED resistor to 680Ω',
    'set the LED resistor to 470Ω'
  ];
  for (const prompt of ask) {
    const decision = classifyExistingProjectRequest(prompt, spec);
    assert.equal(decision.mode, 'refuse', `${prompt} ${decision.code ?? ''}`);
    assert.equal(decision.code, 'RESISTOR_TARGET_UNCLEAR', `${prompt} ${decision.code ?? ''}`);
    assert.equal(decision.edit, undefined, prompt);
    assert.equal(componentValue(spec, 'R1'), '4.7k', prompt);
    assert.equal(componentValue(spec, 'R2'), '4.7k', prompt);
  }
});

test('a bare resistor word applies only when the LED series resistor is the only resistor role', () => {
  const ask = resistorTargetUnclearMessage('680');
  const shared = [
    '저항 680Ω으로',
    'resistor 680Ω',
    'change the resistor to 680Ω',
    '抵抗 680Ω'
  ];
  const many = seriesSpec('1k');
  for (const prompt of shared) {
    const before = structuredClone(many);
    const decision = classifyExistingProjectRequest(prompt, many);
    assert.equal(decision.mode, 'refuse', `${prompt} ${decision.code ?? ''} ${decision.message ?? ''}`);
    assert.equal(decision.code, 'RESISTOR_TARGET_UNCLEAR', prompt);
    assert.equal(decision.message, ask, prompt);
    assert.equal(decision.edit, undefined, prompt);
    assert.deepEqual(many, before, prompt);
    assert.equal(componentValue(many, 'R3'), '1k', prompt);
    assert.equal(componentValue(many, 'R4'), '4.7k', prompt);
  }

  const only = ledOnlySpec('1k');
  for (const prompt of shared) {
    const decision = classifyExistingProjectRequest(prompt, only);
    assert.equal(decision.mode, 'merge', `${prompt} ${decision.code ?? ''} ${decision.message ?? ''}`);
    assert.equal(decision.edit?.ohms, 680, prompt);
    assert.equal(decision.edit?.label, '680Ω', prompt);
    const next = applyExistingProjectEdit(only, decision.edit);
    assert.equal(componentValue(next, 'R3'), '680Ω', prompt);
    assert.equal(componentValue(next, 'C1'), '100n', prompt);
    assert.equal(componentValue(only, 'R3'), '1k', prompt);
  }
});

test('denied role words leave the schematic and the LED net unchanged', async () => {
  const spec = seriesSpec('1k');
  const projectDir = await mkdtemp(path.join(tmpdir(), 'chatpcb-role-allow-'));
  const schematic = [
    '(kicad_sch (version 20250114) (generator chatpcb)',
    schematicSymbol('R1', 'Device:R', '5.1k', 0),
    schematicSymbol('R3', 'ChatPCB:LED_RESISTOR', '1k', 10),
    schematicSymbol('R4', 'ChatPCB:I2C_PULLUP', '4.7k', 20),
    ')'
  ].join('\n');
  const spice = ['* role allow', 'R1 vbus cc 5100', 'R4 v3v3 sda 4700', 'RLED v3v3 led 1000', '.end', ''].join('\n');
  await writeFile(path.join(projectDir, 'board.chatpcb.json'), `${JSON.stringify(spec, null, 2)}\n`);
  await writeFile(path.join(projectDir, 'board.kicad_sch'), schematic);
  await writeFile(path.join(projectDir, 'board_simulation.cir'), spice);
  try {
    for (const prompt of DENIED_ROLE_PROMPTS) {
      const decision = classifyExistingProjectRequest(prompt, seriesSpec('1k'));
      assert.equal(decision.mode, 'refuse', prompt);
      assert.equal(decision.edit, undefined, prompt);
      assert.equal(await readFile(path.join(projectDir, 'board.kicad_sch'), 'utf8'), schematic, prompt);
      assert.equal(await readFile(path.join(projectDir, 'board_simulation.cir'), 'utf8'), spice, prompt);
      assert.equal(schematicRefValue(schematic, 'R3'), '1k', prompt);
    }
    for (const [prompt, ohms, label] of ALLOWED_ROLE_PROMPTS) {
      await writeFile(path.join(projectDir, 'board.kicad_sch'), schematic);
      await writeFile(path.join(projectDir, 'board_simulation.cir'), spice);
      await writeFile(path.join(projectDir, 'board.chatpcb.json'), `${JSON.stringify(seriesSpec('1k'), null, 2)}\n`);
      const decision = classifyExistingProjectRequest(prompt, seriesSpec('1k'));
      assert.equal(decision.mode, 'merge', prompt);
      await applyMergedProjectEdit({
        projectDir,
        existingSpec: seriesSpec('1k'),
        edit: decision.edit
      });
      const written = await readFile(path.join(projectDir, 'board.kicad_sch'), 'utf8');
      const netlist = await readFile(path.join(projectDir, 'board_simulation.cir'), 'utf8');
      assert.equal(schematicRefValue(written, 'R3'), label, prompt);
      assert.equal(schematicRefValue(written, 'R1'), '5.1k', prompt);
      assert.equal(schematicRefValue(written, 'R4'), '4.7k', prompt);
      assert.match(netlist, new RegExp(`^RLED v3v3 led ${ohms}$`, 'm'), prompt);
      assert.match(netlist, /^R1 vbus cc 5100$/m, prompt);
      assert.match(netlist, /^R4 v3v3 sda 4700$/m, prompt);
    }
  } finally {
    await rm(projectDir, { force: true, recursive: true });
  }
});

test('a polite request with a resistor target, an edit verb, and a unit value merges', () => {
  const spec = seriesSpec('1k');
  const mergeRows = [
    'can you set the LED resistor to 680Ω?',
    'LED 저항 680Ω으로 바꿔줄래?',
    'LED 저항 680Ω으로 바꿔 줄래?',
    'LED 저항 680Ω으로 바꿔 줄 수 있어?',
    'LED 저항 680Ω으로 바꿔줄 수 있어?',
    'could you change R3 to 680Ω?',
    'LED 저항 680Ω으로 바꿔주실래요?',
    'LED 저항 680Ω으로 해줄래?',
    'LED 저항 680Ω으로 할 수 있어?',
    'R3를 680Ω으로 바꿔줄래?',
    'would you change the LED resistor to 680Ω, ok?',
    'please set the LED resistor to 680Ω?',
    'LED 저항 680Ω으로 바꿔도 될까?',
    'LED 저항 680Ω으로 바꿔도 되나요?',
    'LED 저항 680Ω으로 바꿔도 돼?',
    'can I change the LED resistor to 680Ω?',
    'may I change the LED resistor to 680Ω?',
    'may I set the LED resistor to 680Ω?',
    'is it ok to set R3 to 680Ω?'
  ];
  for (const prompt of mergeRows) {
    const decision = classifyExistingProjectRequest(prompt, spec);
    assert.equal(decision.mode, 'merge', `${prompt} ${decision.code ?? ''} ${decision.message ?? ''}`);
    assert.equal(decision.code, undefined, prompt);
    assert.equal(decision.edit?.kind, 'resistor', prompt);
    assert.equal(decision.edit?.ohms, 680, prompt);
    assert.equal(decision.edit?.label, '680Ω', prompt);
    assert.equal(decision.edit?.ref, 'R3', prompt);
    const next = applyExistingProjectEdit(spec, decision.edit);
    assert.equal(componentValue(next, 'R3'), '680Ω', prompt);
    assert.equal(componentValue(next, 'R1'), '5.1k', prompt);
    assert.equal(componentValue(next, 'R4'), '4.7k', prompt);
    assert.equal(componentValue(spec, 'R3'), '1k', prompt);
  }

  const tenK = classifyExistingProjectRequest('LED 저항 10k로 바꿔도 돼?', spec);
  assert.equal(tenK.mode, 'merge', `${tenK.code ?? ''} ${tenK.message ?? ''}`);
  assert.equal(tenK.code, undefined);
  assert.equal(tenK.edit?.kind, 'resistor');
  assert.equal(tenK.edit?.ohms, 10000);
  assert.equal(tenK.edit?.label, '10k');
  assert.equal(tenK.edit?.ref, 'R3');
  const tenKNext = applyExistingProjectEdit(spec, tenK.edit);
  assert.equal(componentValue(tenKNext, 'R3'), '10k');
  assert.equal(componentValue(tenKNext, 'R1'), '5.1k');
  assert.equal(componentValue(tenKNext, 'R4'), '4.7k');
  assert.equal(componentValue(spec, 'R3'), '1k');

  const providerRows = [
    'why is R3 330?',
    'what does R3 do?',
    'R3가 뭐야?',
    'R3는 왜 330이야?',
    'how about R3 = 2.2k?',
    'LED 저항 1kΩ 괜찮아?',
    'R3 470?',
    'is 1kΩ ok for the LED resistor?',
    'is 680Ω ok for the LED resistor?',
    'LED 저항 680Ω 가능?',
    '680Ω 가능?',
    'can you add a 1kΩ resistor?',
    'should I change the LED resistor to 680Ω?',
    'why not change the LED resistor to 680Ω?',
    'how do I change the LED resistor to 680Ω?',
    'what happens if I change the LED resistor to 680Ω?',
    'which resistor should I change to 680Ω?',
    '왜 LED 저항을 680Ω으로 바꿔야 해?',
    'LED 저항 680Ω으로 바꿔야 할까?',
    'LED resistor to 2.2k ok?',
    'LED resistor to 2.2k okay?',
    'LED 저항 680Ω으로 바꾸면 어떻게 돼?'
  ];
  for (const prompt of providerRows) {
    const decision = classifyExistingProjectRequest(prompt, spec);
    assert.equal(decision.mode, 'refuse', prompt);
    assert.equal(decision.code, undefined, `${prompt} ${decision.code ?? ''}`);
    assert.equal(decision.edit, undefined, prompt);
    assert.equal(blocksBeforeProvider(prompt, decision), false, prompt);
    assert.equal(componentValue(spec, 'R3'), '1k', prompt);
  }

  const invalid = classifyExistingProjectRequest('can you set the LED resistor to 0R?', spec);
  assert.equal(invalid.mode, 'refuse');
  assert.equal(invalid.code, 'RESISTOR_VALUE_INVALID');
  assert.equal(invalid.message, resistorValueOutOfRangeMessage());
  assert.equal(invalid.edit, undefined);
  assert.equal(blocksBeforeProvider('can you set the LED resistor to 0R?', invalid), true);
  assert.equal(componentValue(spec, 'R3'), '1k');

  const pullUp = classifyExistingProjectRequest('could you change the pull-up to 10k?', spec);
  assert.equal(pullUp.mode, 'refuse');
  assert.equal(pullUp.code, 'RESISTOR_REF_UNSUPPORTED');
  assert.equal(pullUp.message, resistorRefUnsupportedMessage('R3'));
  assert.equal(pullUp.edit, undefined);
  assert.equal(blocksBeforeProvider('could you change the pull-up to 10k?', pullUp), true);
  assert.equal(componentValue(spec, 'R3'), '1k');
  assert.equal(componentValue(spec, 'R4'), '4.7k');
});

test('an R ref with another role modifier is unsupported', () => {
  const spec = seriesSpec('1k');
  const unsupported = resistorRefUnsupportedMessage('R3');
  for (const prompt of [
    'R3 풀업 저항 4.7kΩ으로',
    'change the R3 pull-up resistor to 4.7kΩ',
    'R3 디바운스 저항을 10kΩ으로'
  ]) {
    const decision = classifyExistingProjectRequest(prompt, spec);
    assert.equal(decision.mode, 'refuse', `${prompt} ${decision.code ?? ''} ${decision.message ?? ''}`);
    assert.equal(decision.code, 'RESISTOR_REF_UNSUPPORTED', prompt);
    assert.equal(decision.message, unsupported, prompt);
    assert.equal(decision.edit, undefined, prompt);
    assert.equal(componentValue(spec, 'R3'), '1k', prompt);
    assert.equal(componentValue(spec, 'R1'), '5.1k', prompt);
    assert.equal(componentValue(spec, 'R4'), '4.7k', prompt);
  }
});

test('a Korean keep clause hides that role and still edits only the LED resistor', () => {
  const spec = seriesSpec('1k');
  const rows = [
    '풀업은 그대로 두고 LED 저항 680Ω으로 바꿔줘',
    '풀업 저항은 건드리지 말고 LED 저항 680Ω으로',
    'CC 저항은 유지하고 LED 저항 680Ω으로 바꿔줘',
    '풀업 빼고 LED 저항 680Ω으로',
    'I2C 풀업 저항은 그대로 두고 LED 저항 680Ω으로',
    'R4는 건드리지 말고 LED 저항 680Ω으로'
  ];
  const bareI2c = [
    'I2C는 그대로 두고 LED 저항 680옴으로',
    'I2C는 놔두고 LED 저항 680Ω으로'
  ];
  for (const prompt of rows) {
    const decision = classifyExistingProjectRequest(prompt, spec);
    assert.equal(decision.mode, 'merge', `${prompt} ${decision.code ?? ''} ${decision.message ?? ''}`);
    assert.equal(decision.edit?.ohms, 680, prompt);
    assert.equal(decision.edit?.label, '680Ω', prompt);
    assert.equal(decision.edit?.ref, 'R3', prompt);
    const next = applyExistingProjectEdit(spec, decision.edit);
    assert.equal(componentValue(next, 'R3'), '680Ω', prompt);
    assert.equal(componentValue(next, 'R1'), '5.1k', prompt);
    assert.equal(componentValue(next, 'R4'), '4.7k', prompt);
    assert.equal(componentValue(spec, 'R3'), '1k', prompt);
  }
  for (const prompt of bareI2c) {
    const decision = classifyExistingProjectRequest(prompt, spec);
    assert.equal(decision.mode, 'refuse', prompt);
    assert.equal(decision.code, 'RESISTOR_TARGET_UNCLEAR', `${prompt} ${decision.code ?? ''}`);
    assert.equal(decision.edit, undefined, prompt);
    assert.equal(appliesBeforeProvider(prompt, decision), false, prompt);
    assert.equal(blocksBeforeProvider(prompt, decision), true, prompt);
    assert.equal(componentValue(spec, 'R3'), '1k', prompt);
    assert.equal(componentValue(spec, 'R4'), '4.7k', prompt);
  }

  const keptLed = classifyExistingProjectRequest('LED 저항은 그대로 두고 풀업 저항 10k로', spec);
  assert.equal(keptLed.mode, 'refuse');
  assert.equal(keptLed.code, 'RESISTOR_REF_UNSUPPORTED');
  assert.equal(keptLed.edit, undefined);
  assert.equal(componentValue(spec, 'R3'), '1k');

  const keptLedValue = classifyExistingProjectRequest('LED 저항은 그대로 두고 680Ω으로', spec);
  assert.equal(keptLedValue.mode, 'refuse');
  assert.equal(keptLedValue.code, 'RESISTOR_AMBIGUOUS');
  assert.equal(keptLedValue.edit, undefined);
  assert.equal(componentValue(spec, 'R3'), '1k');

  const touch = classifyExistingProjectRequest('R3 680Ω, R4는 건드리지 마', spec);
  assert.equal(touch.mode, 'merge');
  assert.equal(touch.edit?.ohms, 680);
  assert.equal(touch.edit?.label, '680Ω');
  assert.equal(touch.edit?.ref, 'R3');
  const touched = applyExistingProjectEdit(spec, touch.edit);
  assert.equal(componentValue(touched, 'R3'), '680Ω');
  assert.equal(componentValue(touched, 'R4'), '4.7k');
  assert.equal(componentValue(spec, 'R3'), '1k');
  assert.equal(componentValue(spec, 'R4'), '4.7k');

  const unsupported = resistorRefUnsupportedMessage('R3');
  for (const prompt of [
    '풀업은 2.2k로, LED 저항은 680Ω으로',
    'LED resistor to 680Ω and pull-up to 2.2k',
    'LED resistor to 680Ω, pull-up to 2.2k',
    '풀업을 그대로 두지 말고 2.2k로'
  ]) {
    const decision = classifyExistingProjectRequest(prompt, spec);
    assert.equal(decision.mode, 'refuse', `${prompt} ${decision.code ?? ''} ${decision.message ?? ''}`);
    assert.equal(decision.code, 'RESISTOR_REF_UNSUPPORTED', prompt);
    assert.equal(decision.message, unsupported, prompt);
    assert.equal(decision.edit, undefined, prompt);
    assert.equal(componentValue(spec, 'R3'), '1k', prompt);
    assert.equal(componentValue(spec, 'R1'), '5.1k', prompt);
    assert.equal(componentValue(spec, 'R4'), '4.7k', prompt);
  }
});

test('LED synonyms, plurals, and non-resistor quantities edit only the LED resistor', () => {
  const spec = seriesSpec('1k');
  const ledOnly = ledOnlySpec('1k');
  const mergeRows = [
    ['엘예디 저항 680Ω으로', spec, 680, '680Ω'],
    ['발광 다이오드 저항 680Ω으로', spec, 680, '680Ω'],
    ['LED들 저항 680Ω으로', spec, 680, '680Ω'],
    ['LED들의 저항 680Ω으로', spec, 680, '680Ω'],
    ['port 8080 LED 저항 330Ω', spec, 330, '330Ω'],
    ['포트 8080 LED 저항 330Ω', spec, 330, '330Ω'],
    ['pin 13 LED 저항 330Ω', spec, 330, '330Ω'],
    ['GPIO 4 LED 저항 330Ω', spec, 330, '330Ω'],
    ['3.3V LED 저항 330Ω', spec, 330, '330Ω'],
    ['100nF LED 저항 330Ω', spec, 330, '330Ω'],
    ['port 8080 저항 330Ω', ledOnly, 330, '330Ω']
  ];
  for (const [prompt, board, ohms, label] of mergeRows) {
    const decision = classifyExistingProjectRequest(prompt, board);
    assert.equal(decision.mode, 'merge', `${prompt} ${decision.code ?? ''} ${decision.message ?? ''}`);
    assert.equal(decision.edit?.ohms, ohms, prompt);
    assert.equal(decision.edit?.label, label, prompt);
    assert.equal(decision.edit?.ref, 'R3', prompt);
    const next = applyExistingProjectEdit(board, decision.edit);
    assert.equal(componentValue(next, 'R3'), label, prompt);
    assert.equal(componentValue(board, 'R3'), '1k', prompt);
  }

  const barePort = classifyExistingProjectRequest('port 8080 저항 330Ω', spec);
  assert.equal(barePort.mode, 'refuse');
  assert.equal(barePort.code, 'RESISTOR_TARGET_UNCLEAR');
  assert.equal(barePort.edit, undefined);
  assert.equal(componentValue(spec, 'R3'), '1k');

  for (const board of [spec, ledOnly]) {
    for (const prompt of ['그 저항 10k로', '이 저항 10k로', 'that resistor to 10k', 'this resistor to 10k']) {
      const decision = classifyExistingProjectRequest(prompt, board);
      assert.equal(decision.mode, 'refuse', prompt);
      assert.equal(decision.code, 'RESISTOR_TARGET_UNCLEAR', `${prompt} ${decision.code ?? ''}`);
      assert.equal(decision.edit, undefined, prompt);
      assert.equal(componentValue(board, 'R3'), '1k', prompt);
    }
  }

  for (const board of [spec, ledOnly]) {
    const plain = classifyExistingProjectRequest('이 저항', board);
    assert.equal(plain.mode, 'refuse');
    assert.notEqual(plain.code, 'RESISTOR_REF_UNSUPPORTED');
    assert.equal(plain.edit, undefined);
    assert.equal(componentValue(board, 'R3'), '1k');
  }

  const counted = classifyExistingProjectRequest('LED 3개, 저항 330Ω', spec);
  assert.equal(counted.mode, 'refuse');
  assert.equal(counted.code, 'RESISTOR_TARGET_UNCLEAR');
  assert.equal(counted.edit, undefined);
  assert.equal(componentValue(spec, 'R3'), '1k');

  const diode = classifyExistingProjectRequest('다이오드 저항 330Ω으로', spec);
  assert.equal(diode.mode, 'refuse');
  assert.equal(diode.code, 'RESISTOR_REF_UNSUPPORTED');
  assert.equal(diode.edit, undefined);
});

test("current limiting with the role in a following clause ('…, 풀업용', '…, for SDA') refuses and never applies R3", () => {
  const spec = seriesSpec('1k');
  const unsupported = resistorRefUnsupportedMessage('R3');
  for (const prompt of [
    '전류 제한 저항 680Ω, 풀업용',
    '전류제한 저항 680Ω, 리셋용',
    'current limiting resistor to 680Ω, for SDA',
    'current limiting resistor to 680Ω, it is for the pull-up'
  ]) {
    const before = structuredClone(spec);
    const decision = classifyExistingProjectRequest(prompt, spec);
    assert.equal(decision.mode, 'refuse', `${prompt} ${decision.code ?? ''} ${decision.message ?? ''}`);
    assert.equal(decision.code, 'RESISTOR_REF_UNSUPPORTED', prompt);
    assert.equal(decision.message, unsupported, prompt);
    assert.equal(decision.edit, undefined, prompt);
    assert.equal(appliesBeforeProvider(prompt, decision), false, prompt);
    assert.equal(blocksBeforeProvider(prompt, decision), true, prompt);
    assert.deepEqual(spec, before, prompt);
    assert.equal(componentValue(spec, 'R3'), '1k', prompt);
    assert.equal(componentValue(spec, 'R4'), '4.7k', prompt);
  }
});

test('an LED clause plus an unknown role clause with its own value asks which resistor instead of silently dropping it', () => {
  const spec = seriesSpec('1k');
  const rows = [
    'LED resistor to 680Ω, terminator to 120Ω',
    'LED resistor to 680Ω, NRST 10k',
    'LED resistor to 680Ω, BOOT0 10k',
    'LED resistor to 680Ω, transistor 1k',
    'LED resistor to 680Ω, opamp 10k',
    'LED resistor to 680Ω, ADC 10k',
    'LED 저항 680Ω으로, 풀 업 2.2k로',
    'LED 저항 680Ω으로, 플업 2.2k로',
    'LED 680Ω, terminator 120Ω',
    'terminator 120Ω',
    'NRST 10k',
    'BOOT0 10k',
    'transistor 1k',
    'opamp 10k',
    'ADC 10k',
    '풀 업 2.2k',
    '플업 2.2k'
  ];
  for (const prompt of rows) {
    const before = structuredClone(spec);
    const decision = classifyExistingProjectRequest(prompt, spec);
    assert.equal(decision.mode, 'refuse', `${prompt} ${decision.code ?? ''} ${decision.message ?? ''}`);
    assert.equal(decision.code, 'RESISTOR_TARGET_UNCLEAR', prompt);
    assert.equal(decision.edit, undefined, prompt);
    assert.equal(appliesBeforeProvider(prompt, decision), false, prompt);
    assert.equal(blocksBeforeProvider(prompt, decision), true, prompt);
    assert.deepEqual(spec, before, prompt);
    assert.equal(componentValue(spec, 'R3'), '1k', prompt);
  }
  const ledOnly = classifyExistingProjectRequest('LED 680Ω', spec);
  assert.equal(ledOnly.mode, 'merge', ledOnly.code ?? '');
  assert.equal(ledOnly.edit?.ohms, 680);
  assert.equal(ledOnly.edit?.ref, 'R3');
});

test('가능하면 is an ignorable prefix and the LED resistor edit still merges', () => {
  const spec = seriesSpec('1k');
  for (const prompt of [
    '가능하면 LED 저항 680Ω으로 바꿔줘',
    '괜찮으면 LED 저항 680Ω으로 바꿔줘'
  ]) {
    const decision = classifyExistingProjectRequest(prompt, spec);
    assert.equal(decision.mode, 'merge', `${prompt} ${decision.code ?? ''} ${decision.message ?? ''}`);
    assert.equal(decision.edit?.ohms, 680, prompt);
    assert.equal(decision.edit?.ref, 'R3', prompt);
    assert.equal(appliesBeforeProvider(prompt, decision), true, prompt);
    const next = applyExistingProjectEdit(spec, decision.edit);
    assert.equal(componentValue(next, 'R3'), '680Ω', prompt);
    assert.equal(componentValue(spec, 'R3'), '1k', prompt);
  }
});

test('clause separators keep and and comma, and a digit comma stays inside the value', () => {
  assert.equal(splitResistorClauses('LED resistor to 680Ω and pull-up to 2.2k').length, 2);
  assert.equal(splitResistorClauses('LED resistor to 680Ω, pull-up to 2.2k').length, 2);
  assert.equal(splitResistorClauses('LED resistor to 4,7k').length, 1);
});

test('vocabulary allow lists contain no negation or alternative word', () => {
  const lists = vocabularyAllowLists();
  const forbiddenWords = ['not', 'no', "don't", 'dont', 'never', 'or', '말고', '또는', '아니면', '혹은'];
  const forbiddenPhrases = ['do not', 'does not', 'did not', '지 말고', '지 마', '하지 마'];
  for (const word of ['do', 'does', 'did', 'up', 'down', 'not', 'no', 'or', 'if']) {
    assert.equal(lists.functionWords.has(word), false, `FUNCTION_WORDS has ${word}`);
  }
  for (const [name, list] of Object.entries(lists)) {
    for (const value of list) {
      const text = String(value);
      const folded = text.toLowerCase();
      assert.equal(text.includes('않'), false, `${name} ${text} contains 않`);
      const tokens = folded.split(/[^a-z0-9가-힣']+/u).filter(Boolean);
      if (name !== 'politeIfPhrases') {
        assert.equal(tokens.includes('if'), false, `${name} ${text}`);
      }
      for (const word of forbiddenWords) {
        assert.equal(tokens.includes(word), false, `${name} ${text} has ${word}`);
      }
      for (const phrase of forbiddenPhrases) {
        assert.equal(folded.includes(phrase), false, `${name} ${text} has ${phrase}`);
      }
    }
  }
  assert.deepEqual([...lists.politeIfPhrases], ['if possible', 'if you can', 'if you could']);
});

test('a from-value that does not match the current R3 value is RESISTOR_VALUE_AMBIGUOUS', () => {
  const mismatched = [
    'change the LED resistor from 2.2k to 680Ω',
    '2.2k에서 680Ω으로',
    '2.2k -> 680Ω'
  ];
  const spec = seriesSpec('1k');
  const message = resistorValueAmbiguousMessage(null, ['2.2k', '680Ω']);
  for (const prompt of mismatched) {
    const decision = classifyExistingProjectRequest(prompt, spec);
    assert.equal(decision.mode, 'refuse', `${prompt} ${decision.code ?? ''} ${decision.message ?? ''}`);
    assert.equal(decision.code, 'RESISTOR_VALUE_AMBIGUOUS', prompt);
    assert.equal(decision.edit, undefined, prompt);
    assert.equal(decision.message, message, prompt);
    assert.equal(blocksBeforeProvider(prompt, decision), true, prompt);
    assert.equal(componentValue(spec, 'R3'), '1k', prompt);
  }

  const matched = seriesSpec('2.2k');
  for (const prompt of mismatched) {
    const decision = classifyExistingProjectRequest(prompt, matched);
    assert.equal(decision.mode, 'merge', `${prompt} ${decision.code ?? ''} ${decision.message ?? ''}`);
    assert.equal(decision.edit?.ohms, 680, prompt);
    assert.equal(decision.edit?.label, '680Ω', prompt);
    assert.equal(decision.edit?.ref, 'R3', prompt);
    assert.equal(appliesBeforeProvider(prompt, decision), true, prompt);
    assert.equal(componentValue(matched, 'R3'), '2.2k', prompt);
  }

  const kept = classifyExistingProjectRequest('change the LED resistor from 1k to 680Ω', spec);
  assert.equal(kept.mode, 'merge');
  assert.equal(kept.edit?.ohms, 680);
  assert.equal(kept.edit?.ref, 'R3');
  assert.equal(appliesBeforeProvider('change the LED resistor from 1k to 680Ω', kept), true);
});

test('a keep of the LED itself is not a keep of its resistor', () => {
  const spec = seriesSpec('1k');
  const merges = [
    'LED는 그대로 두고 LED 저항만 680Ω으로',
    'keep the LED, set the LED resistor to 680Ω',
    'keep the status LED, set the LED resistor to 680Ω',
    'keep the LED as is, set the LED resistor to 680Ω',
    "don't touch R4, LED, set to 680Ω"
  ];
  for (const prompt of merges) {
    const before = structuredClone(spec);
    const decision = classifyExistingProjectRequest(prompt, spec);
    assert.equal(decision.mode, 'merge', `${prompt} ${decision.code ?? ''} ${decision.message ?? ''}`);
    assert.equal(decision.code, undefined, prompt);
    assert.equal(decision.edit?.ohms, 680, prompt);
    assert.equal(decision.edit?.label, '680Ω', prompt);
    assert.equal(decision.edit?.ref, 'R3', prompt);
    assert.equal(appliesBeforeProvider(prompt, decision), true, prompt);
    assert.equal(blocksBeforeProvider(prompt, decision), false, prompt);
    const next = applyExistingProjectEdit(spec, decision.edit);
    assert.equal(componentValue(next, 'R3'), '680Ω', prompt);
    assert.equal(componentValue(next, 'R4'), '4.7k', prompt);
    assert.deepEqual(spec, before, prompt);
  }

  const ambiguous = resistorAmbiguousMessage();
  for (const prompt of [
    'keep the LED resistor, set R3 to 680Ω',
    'keep R3, set the LED resistor to 680Ω'
  ]) {
    const before = structuredClone(spec);
    const decision = classifyExistingProjectRequest(prompt, spec);
    assert.equal(decision.mode, 'refuse', `${prompt} ${decision.code ?? ''}`);
    assert.equal(decision.code, 'RESISTOR_AMBIGUOUS', prompt);
    assert.equal(decision.message, ambiguous, prompt);
    assert.equal(decision.edit, undefined, prompt);
    assert.equal(blocksBeforeProvider(prompt, decision), true, prompt);
    assert.equal(appliesBeforeProvider(prompt, decision), false, prompt);
    assert.deepEqual(spec, before, prompt);
  }
});

// The R board: series resistor R3, status LED D1, and another diode D2.
function seriesLedBoard(value = '1k') {
  const spec = seriesSpec(value);
  spec.schematic.components.push(
    { ref: 'D1', libId: 'ChatPCB:STATUS_LED', value: 'STATUS_LED', role: 'status-led' },
    { ref: 'D2', libId: 'ChatPCB:USB_ESD', value: 'PRTR5V0U2X' }
  );
  spec.boardProfile.productionParts.push(
    { ref: 'D1', role: 'status-led', libId: 'ChatPCB:STATUS_LED', value: 'STATUS_LED' },
    { ref: 'D2', role: 'usb-esd', libId: 'ChatPCB:USB_ESD', value: 'PRTR5V0U2X' }
  );
  return spec;
}

function assertAmbiguousKeep(spec, prompt) {
  const before = structuredClone(spec);
  const decision = classifyExistingProjectRequest(prompt, spec);
  assert.equal(decision.mode, 'refuse', `${prompt} ${decision.code ?? ''} ${decision.edit?.ohms ?? ''}`);
  assert.equal(decision.code, 'RESISTOR_AMBIGUOUS', prompt);
  assert.equal(decision.message, resistorAmbiguousMessage(), prompt);
  assert.equal(decision.edit, undefined, prompt);
  assert.equal(blocksBeforeProvider(prompt, decision), true, prompt);
  assert.equal(appliesBeforeProvider(prompt, decision, spec), false, prompt);
  assert.deepEqual(spec, before, prompt);
  assert.equal(componentValue(spec, 'R3'), '1k', prompt);
}

function assertLedKeepApplies(spec, prompt) {
  const before = structuredClone(spec);
  const decision = classifyExistingProjectRequest(prompt, spec);
  assert.equal(decision.mode, 'merge', `${prompt} ${decision.code ?? ''} ${decision.message ?? ''}`);
  assert.equal(decision.code, undefined, prompt);
  assert.equal(decision.edit?.ohms, 680, prompt);
  assert.equal(decision.edit?.label, '680Ω', prompt);
  assert.equal(decision.edit?.ref, 'R3', prompt);
  assert.equal(appliesBeforeProvider(prompt, decision, spec), true, prompt);
  assert.equal(blocksBeforeProvider(prompt, decision), false, prompt);
  const next = applyExistingProjectEdit(spec, decision.edit);
  assert.equal(componentValue(next, 'R3'), '680Ω', prompt);
  assert.equal(componentValue(next, 'R4'), '4.7k', prompt);
  assert.deepEqual(spec, before, prompt);
}

test('an LED keep followed by its resistor is RESISTOR_AMBIGUOUS', () => {
  const spec = seriesLedBoard();
  for (const prompt of [
    'keep the LED and its resistor, set the LED resistor to 680Ω',
    "keep the LED's resistor, set 680Ω",
    'keep the LED. The resistor too. Set the LED resistor to 680Ω',
    'LED는 그대로, 저항도 그대로. LED 저항 680Ω',
    'keep the LED resistance, set the LED resistor to 680Ω',
    'keep D1 and its resistor, set the LED resistor to 680Ω'
  ]) {
    assertAmbiguousKeep(spec, prompt);
  }
  for (const prompt of [
    'keep the LED & resistor, set the LED resistor to 680Ω',
    'LED랑 저항 그대로. LED 저항 680Ω',
    'LED 및 저항 유지, LED 저항 680Ω',
    'keep the LED (R3), set the LED resistor to 680Ω'
  ]) {
    assertAmbiguousKeep(spec, prompt);
  }
  for (const prompt of [
    'keep the LED & resistor',
    'LED랑 저항 그대로',
    'LED 및 저항 유지',
    'keep the LED (R3)'
  ]) {
    const decision = classifyExistingProjectRequest(prompt, spec);
    assert.notEqual(decision.mode, 'merge', `${prompt} ${decision.code ?? ''}`);
    assert.equal(decision.edit, undefined, prompt);
  }
});

test("keep the LED circuit/stuff or 'set it' after an LED keep is RESISTOR_AMBIGUOUS", () => {
  const spec = seriesLedBoard();
  for (const prompt of [
    'keep the LED circuit, set the LED resistor to 680Ω',
    'keep the LED stuff, set the LED resistor to 680Ω',
    'keep the LEDs, set the LED resistor to 680Ω',
    'keep the LED, set it to 680Ω',
    'LED는 그대로 두고 저항 680Ω'
  ]) {
    assertAmbiguousKeep(spec, prompt);
  }
  for (const prompt of [
    'LED는 그대로 두고 LED 저항만 680Ω으로',
    'keep the LED, set the LED resistor to 680Ω',
    'keep the status LED, set the LED resistor to 680Ω',
    'keep the LED as is, set the LED resistor to 680Ω',
    "don't touch R4, LED, set to 680Ω"
  ]) {
    assertLedKeepApplies(spec, prompt);
  }
});

test('a keep of the series LED D ref applies R3 and another diode does not', () => {
  const spec = seriesLedBoard();
  for (const prompt of [
    'keep D1, LED resistor 680Ω',
    'keep D1 and change the LED resistor to 680Ω',
    'keep the LED D1, LED resistor 680Ω',
    'D1은 유지하고 LED 저항 680Ω으로'
  ]) {
    assertLedKeepApplies(spec, prompt);
  }
  const other = classifyExistingProjectRequest('keep D2, LED resistor 680Ω', spec);
  assert.equal(other.mode, 'refuse', other.code ?? '');
  assert.equal(other.code, 'RESISTOR_TARGET_UNCLEAR');
  assert.equal(other.edit, undefined);
  assert.equal(componentValue(spec, 'R3'), '1k');
  assert.equal(componentValue(spec, 'D2'), 'PRTR5V0U2X');
});

const LED_KEEP_SPELLINGS = ['LED', 'D1', 'the LED D1'];
const LED_KEEP_SUFFIXES = ['and its resistor', "'s resistor", 'The resistor too.', '저항도 그대로', 'resistance'];
const LED_KEEP_SPLITS = ['same', 'comma', 'period'];

function ledKeepHead(spelling) {
  if (spelling === 'D1') return 'keep D1';
  if (spelling === 'the LED D1') return 'keep the LED D1';
  return 'keep the LED';
}

function ledKeepKoHead(spelling) {
  if (spelling === 'D1') return 'D1은 그대로';
  if (spelling === 'the LED D1') return 'LED D1은 그대로';
  return 'LED는 그대로';
}

function ledKeepAmbiguousPrompt(spelling, suffix, split) {
  const edit = 'set the LED resistor to 680Ω';
  const head = ledKeepHead(spelling);
  if (suffix === 'and its resistor') {
    if (split === 'period') return `${head}. And its resistor. ${edit}`;
    if (split === 'comma') return `${head}, and its resistor, ${edit}`;
    return `${head} and its resistor, ${edit}`;
  }
  if (suffix === "'s resistor") {
    const owned = spelling === 'D1'
      ? "keep D1's resistor"
      : spelling === 'the LED D1'
        ? "keep the LED D1's resistor"
        : "keep the LED's resistor";
    if (split === 'period') return `${owned}. ${edit}`;
    if (split === 'comma') return `${owned}, ${edit}`;
    return `${owned}, set 680Ω`;
  }
  if (suffix === 'The resistor too.') {
    if (split === 'comma') return `${head}, the resistor too, ${edit}`;
    if (split === 'same') return `${head} the resistor too, ${edit}`;
    return `${head}. The resistor too. ${edit}`;
  }
  if (suffix === '저항도 그대로') {
    const ko = ledKeepKoHead(spelling);
    const koEdit = 'LED 저항 680Ω';
    if (split === 'period') return `${ko}. 저항도 그대로. ${koEdit}`;
    if (split === 'comma') return `${ko}, 저항도 그대로. ${koEdit}`;
    return `${ko} 저항도 그대로. ${koEdit}`;
  }
  const resistance = spelling === 'D1'
    ? 'keep D1 resistance'
    : spelling === 'the LED D1'
      ? 'keep the LED D1 resistance'
      : 'keep the LED resistance';
  if (split === 'period') return `${resistance}. ${edit}`;
  if (split === 'comma') return `${resistance}, ${edit}`;
  return `${resistance}, ${edit}`;
}

function ledKeepApplyPrompt(spelling) {
  if (spelling === 'D1') return 'keep D1, LED resistor 680Ω';
  if (spelling === 'the LED D1') return 'keep the LED D1, LED resistor 680Ω';
  return 'keep the LED, set the LED resistor to 680Ω';
}

test('property: an LED keep times a resistor suffix times a sentence split is RESISTOR_AMBIGUOUS', () => {
  const spec = seriesLedBoard();
  const seed = propertySeed();
  const rng = mulberry32(seed);
  console.log(`led-keep property seed ${seed}`);
  const cases = [];
  for (const spelling of LED_KEEP_SPELLINGS) {
    for (const suffix of LED_KEEP_SUFFIXES) {
      for (const split of LED_KEEP_SPLITS) {
        cases.push({
          prompt: ledKeepAmbiguousPrompt(spelling, suffix, split),
          apply: false,
          spelling,
          suffix,
          split
        });
      }
    }
    cases.push({ prompt: ledKeepApplyPrompt(spelling), apply: true, spelling, suffix: 'bare', split: 'edit' });
  }
  shuffleItems(rng, cases);
  const failures = [];
  for (const sample of cases) {
    const decision = classifyExistingProjectRequest(sample.prompt, spec);
    const where = `${sample.spelling} ${sample.suffix} ${sample.split} ${sample.prompt}`;
    if (sample.apply) {
      if (decision.mode !== 'merge' || decision.edit?.ref !== 'R3' || decision.edit?.ohms !== 680) {
        failures.push(`${where} => ${decision.code ?? decision.mode} ${decision.edit?.ref ?? ''} ${decision.edit?.ohms ?? ''}`);
      } else if (appliesBeforeProvider(sample.prompt, decision, spec) !== true) failures.push(`${where} applies`);
      continue;
    }
    if (decision.code !== 'RESISTOR_AMBIGUOUS') failures.push(`${where} => ${decision.code ?? decision.mode} ${decision.edit?.ohms ?? ''}`);
    else if (decision.edit !== undefined) failures.push(`${where} edit`);
    else if (blocksBeforeProvider(sample.prompt, decision) !== true) failures.push(`${where} blocks`);
    else if (appliesBeforeProvider(sample.prompt, decision, spec) !== false) failures.push(`${where} applies`);
  }
  assert.equal(cases.length, LED_KEEP_SPELLINGS.length * LED_KEEP_SUFFIXES.length * LED_KEEP_SPLITS.length + LED_KEEP_SPELLINGS.length);
  assert.deepEqual(failures.slice(0, 12), []);
});

const LED_SYNONYM_KEEP_POSITIONS = ['leading', 'trailing', 'next'];

function ledResistorPhrase(synonym, lang) {
  const text = String(synonym);
  const hasNoun = /\bresistor\b/i.test(text) || text.includes('저항') || text.includes('抵抗');
  if (hasNoun) return text;
  return lang === 'en' ? `${text} resistor` : `${text} 저항`;
}

function ledSynonymKeep(synonym, lang) {
  const phrase = ledResistorPhrase(synonym, lang);
  return lang === 'en' ? `keep the ${phrase}` : `${phrase}은 그대로 두고`;
}

function ledSynonymEdit(lang) {
  return lang === 'en' ? 'LED resistor 680Ω' : 'LED 저항 680Ω';
}

function placeLedSynonymKeep(keep, edit, position) {
  if (position === 'leading') return `${keep}, ${edit}`;
  if (position === 'trailing') return `${edit}, ${keep}`;
  return `${edit}. ${keep}.`;
}

test('every LED-resistor synonym in a keep clause is RESISTOR_AMBIGUOUS', () => {
  const spec = seriesSpec('1k');
  const message = resistorAmbiguousMessage();
  const required = [
    'current-limiting',
    'current limiting',
    'current-limit',
    'series',
    'LED series',
    'status LED resistor',
    '직렬',
    '전류제한',
    '전류 제한',
    '전류 제한용',
    'current limiters',
    '전류 제한기',
    '전류제한기',
    '표시등 저항',
    '리미터'
  ];
  for (const synonym of required) {
    assert.equal(
      LED_RESISTOR_SYNONYMS.some((item) => item.toLowerCase() === synonym.toLowerCase()),
      true,
      synonym
    );
  }
  const failures = [];
  for (const synonym of LED_RESISTOR_SYNONYMS) {
    // "{led}" is the board's status LED ref. The alias property test fills it in.
    if (synonym.includes('{led}')) continue;
    for (const lang of ['en', 'ko']) {
      for (const position of LED_SYNONYM_KEEP_POSITIONS) {
        const prompt = placeLedSynonymKeep(ledSynonymKeep(synonym, lang), ledSynonymEdit(lang), position);
        const decision = classifyExistingProjectRequest(prompt, spec);
        const where = `${synonym} ${lang} ${position} ${prompt}`;
        if (decision.code !== 'RESISTOR_AMBIGUOUS') failures.push(`${where} => ${decision.code ?? decision.mode} ${decision.edit?.ohms ?? ''}`);
        else if (decision.message !== message) failures.push(`${where} message`);
        else if (decision.edit !== undefined) failures.push(`${where} edit`);
        else if (blocksBeforeProvider(prompt, decision) !== true) failures.push(`${where} blocks`);
        else if (appliesBeforeProvider(prompt, decision) !== false) failures.push(`${where} applies`);
      }
    }
  }
  for (const prompt of [
    'keep R4, LED resistor 680Ω',
    'keep R4, set the LED resistor to 680Ω',
    'R4는 그대로 두고 LED 저항 680Ω'
  ]) {
    const decision = classifyExistingProjectRequest(prompt, spec);
    if (decision.mode !== 'merge' || decision.edit?.ref !== 'R3' || decision.edit?.ohms !== 680) {
      failures.push(`control ${prompt} => ${decision.code ?? decision.mode} ${decision.edit?.ref ?? ''} ${decision.edit?.ohms ?? ''}`);
    } else if (appliesBeforeProvider(prompt, decision) !== true) failures.push(`control ${prompt} applies`);
    else if (blocksBeforeProvider(prompt, decision) !== false) failures.push(`control ${prompt} blocks`);
  }
  assert.equal(LED_RESISTOR_SYNONYMS.length > 0, true);
  assert.deepEqual(failures, []);
});

test('an LED keep plus a series-resistor synonym applies R3 and a resistor on the keep stays ambiguous', () => {
  const spec = seriesLedBoard();
  for (const prompt of [
    'keep the LED, set the current-limiting resistor to 680Ω',
    'keep the LED, set the series resistor to 680Ω',
    'keep the status LED, set the series resistor to 680Ω',
    'LED는 그대로, 전류제한 저항은 680Ω',
    'keep the LED and R4, set the LED resistor to 680Ω',
    'keep R4 and the LED, set the LED resistor to 680Ω'
  ]) {
    assertLedKeepApplies(spec, prompt);
  }
  for (const prompt of [
    'keep the LED and its resistor, set the LED resistor to 680Ω',
    'keep the LED & resistor, set the LED resistor to 680Ω'
  ]) {
    assertAmbiguousKeep(spec, prompt);
  }
});

const LED_KEEP_HEADS = ['the LED', 'the status LED', 'D1', 'LED는 그대로'];
const LED_KEEP_PARTNERS = ['R4', 'the pull-ups'];
const LED_KEEP_ORDERS = ['led-first', 'other-first'];
const LED_EDIT_SYNONYMS = ['LED resistor', 'current-limiting resistor', 'series resistor', '전류제한 저항', 'LED 저항'];
const LED_EDIT_VALUES = ['680Ω', '330 ohms'];
const LED_KEEP_NOUNS = [
  'keep the LED and its resistor',
  'keep the LED & resistor',
  "keep the LED's resistor",
  'keep the status LED and its resistor',
  'keep the status LED & resistor',
  "keep D1's resistor",
  'LED랑 저항은 그대로'
];

function ledKeepEditClause(synonym, value) {
  return `set the ${synonym} to ${value}`;
}

function ledKeepApplyHead(keep, partner, order) {
  if (!partner) {
    if (keep === 'LED는 그대로') return keep;
    return `keep ${keep}`;
  }
  if (keep === 'LED는 그대로') {
    const other = partner === 'the pull-ups' ? '풀업' : partner;
    const coord = partner === 'the pull-ups' ? '하고' : '랑';
    if (order === 'other-first') return `${other}${coord} LED는 그대로`;
    return `LED${coord} ${other}는 그대로`;
  }
  if (order === 'other-first') return `keep ${partner} and ${keep}`;
  return `keep ${keep} and ${partner}`;
}

function ledKeepOhms(value) {
  if (value === '330 ohms') return { ohms: 330, label: '330Ω' };
  return { ohms: 680, label: '680Ω' };
}

test('property: an LED keep, optional other part, and LED-resistor synonym applies R3', () => {
  const spec = seriesLedBoard();
  const seed = propertySeed();
  const rng = mulberry32(seed);
  console.log(`led-keep synonym property seed ${seed}`);
  const applies = [];
  for (const keep of LED_KEEP_HEADS) {
    const heads = [{ keep, partner: null, order: 'led-first' }];
    for (const partner of LED_KEEP_PARTNERS) {
      for (const order of LED_KEEP_ORDERS) heads.push({ keep, partner, order });
    }
    for (const head of heads) {
      for (const synonym of LED_EDIT_SYNONYMS) {
        for (const value of LED_EDIT_VALUES) {
          const prompt = `${ledKeepApplyHead(head.keep, head.partner, head.order)}, ${ledKeepEditClause(synonym, value)}`;
          applies.push({ prompt, value, keep: head.keep, partner: head.partner ?? '', order: head.order, synonym });
        }
      }
    }
  }
  const ambiguous = [];
  for (const keep of LED_KEEP_NOUNS) {
    for (const synonym of LED_EDIT_SYNONYMS) {
      for (const value of LED_EDIT_VALUES) {
        ambiguous.push({
          prompt: `${keep}, ${ledKeepEditClause(synonym, value)}`,
          keep,
          synonym,
          value
        });
      }
    }
  }
  shuffleItems(rng, applies);
  shuffleItems(rng, ambiguous);
  const failures = [];
  for (const sample of applies) {
    const before = structuredClone(spec);
    const decision = classifyExistingProjectRequest(sample.prompt, spec);
    const want = ledKeepOhms(sample.value);
    const where = `${sample.keep} ${sample.partner} ${sample.order} ${sample.synonym} ${sample.value} ${sample.prompt}`;
    if (decision.mode !== 'merge' || decision.code != null || decision.edit?.ref !== 'R3' || decision.edit?.ohms !== want.ohms || decision.edit?.label !== want.label) {
      failures.push(`${where} => ${decision.code ?? decision.mode} ${decision.edit?.ref ?? ''} ${decision.edit?.ohms ?? ''} ${decision.edit?.label ?? ''}`);
    } else if (appliesBeforeProvider(sample.prompt, decision, spec) !== true) failures.push(`${where} applies`);
    else if (blocksBeforeProvider(sample.prompt, decision) !== false) failures.push(`${where} blocks`);
    else {
      const next = applyExistingProjectEdit(spec, decision.edit);
      if (componentValue(next, 'R3') !== want.label || componentValue(next, 'R4') !== '4.7k') {
        failures.push(`${where} next R3 ${componentValue(next, 'R3')}`);
      }
    }
    if (JSON.stringify(spec) !== JSON.stringify(before)) failures.push(`${where} mutated`);
  }
  for (const sample of ambiguous) {
    const before = structuredClone(spec);
    const decision = classifyExistingProjectRequest(sample.prompt, spec);
    const where = `${sample.keep} ${sample.synonym} ${sample.value} ${sample.prompt}`;
    if (decision.mode !== 'refuse' || decision.code !== 'RESISTOR_AMBIGUOUS' || decision.edit != null) {
      failures.push(`${where} => ${decision.code ?? decision.mode} ${decision.edit?.ref ?? ''} ${decision.edit?.ohms ?? ''}`);
    } else if (decision.message !== resistorAmbiguousMessage()) failures.push(`${where} message`);
    else if (blocksBeforeProvider(sample.prompt, decision) !== true) failures.push(`${where} blocks`);
    else if (appliesBeforeProvider(sample.prompt, decision, spec) !== false) failures.push(`${where} applies`);
    if (componentValue(spec, 'R3') !== '1k' || JSON.stringify(spec) !== JSON.stringify(before)) failures.push(`${where} mutated`);
  }
  const applyCount = LED_KEEP_HEADS.length * (1 + LED_KEEP_PARTNERS.length * LED_KEEP_ORDERS.length) * LED_EDIT_SYNONYMS.length * LED_EDIT_VALUES.length;
  assert.equal(applies.length, applyCount);
  assert.equal(ambiguous.length, LED_KEEP_NOUNS.length * LED_EDIT_SYNONYMS.length * LED_EDIT_VALUES.length);
  assert.deepEqual(failures.slice(0, 12), []);
});

test('a keep clause that carries a value never applies that value to R3', () => {
  const spec = seriesSpec('1k');
  const message = resistorAmbiguousMessage();
  const prompts = [
    'keep R4 at 680Ω',
    'keep R4 at 680Ω please',
    'leave the pull-up at 2.2k',
    'R4는 680Ω으로 유지',
    'hold R4 at 10k',
    'keep R4 at 680 ohms',
    'keep R4 at 680 Ω',
    'keep R4 at 680 ohm',
    'keep R4 at 680Ω.',
    'keep R4 at 1 meg',
    "don't touch R4 at 680 ohms",
    'R4는 680 옴으로 유지',
    'hold R4 at 680 ohms',
    'leave R4 at 680 ohms'
  ];
  for (const prompt of prompts) {
    const before = structuredClone(spec);
    const decision = classifyExistingProjectRequest(prompt, spec);
    assert.equal(decision.mode, 'refuse', `${prompt} ${decision.code ?? ''} ${decision.message ?? ''}`);
    assert.equal(decision.code, 'RESISTOR_AMBIGUOUS', prompt);
    assert.equal(decision.message, message, prompt);
    assert.equal(decision.edit, undefined, prompt);
    assert.equal(blocksBeforeProvider(prompt, decision), true, prompt);
    assert.equal(appliesBeforeProvider(prompt, decision), false, prompt);
    assert.deepEqual(spec, before, prompt);
    assert.equal(componentValue(spec, 'R3'), '1k', prompt);
    assert.equal(componentValue(spec, 'R4'), '4.7k', prompt);
  }

  const control = 'keep R4, set the LED resistor to 680Ω';
  const applied = classifyExistingProjectRequest(control, spec);
  assert.equal(applied.mode, 'merge', `${control} ${applied.code ?? ''}`);
  assert.equal(applied.edit?.ohms, 680, control);
  assert.equal(applied.edit?.label, '680Ω', control);
  assert.equal(applied.edit?.ref, 'R3', control);
  assert.equal(appliesBeforeProvider(control, applied), true, control);
  assert.equal(blocksBeforeProvider(control, applied), false, control);
  const next = applyExistingProjectEdit(spec, applied.edit);
  assert.equal(componentValue(next, 'R3'), '680Ω', control);
  assert.equal(componentValue(next, 'R4'), '4.7k', control);
  assert.equal(componentValue(spec, 'R3'), '1k', control);
});

test('a unitless from-value is compared with the saved R3 value', () => {
  const mismatched = [
    'change the LED resistor from 220 to 680Ω',
    'LED resistor 220 -> 680Ω',
    'LED 저항 220에서 680Ω으로'
  ];
  const spec = seriesSpec('1k');
  const message = resistorValueAmbiguousMessage(null, ['220Ω', '680Ω']);
  for (const prompt of mismatched) {
    const before = structuredClone(spec);
    const decision = classifyExistingProjectRequest(prompt, spec);
    assert.equal(decision.mode, 'refuse', `${prompt} ${decision.code ?? ''} ${decision.message ?? ''}`);
    assert.equal(decision.code, 'RESISTOR_VALUE_AMBIGUOUS', prompt);
    assert.equal(decision.message, message, prompt);
    assert.equal(decision.edit, undefined, prompt);
    assert.equal(blocksBeforeProvider(prompt, decision), true, prompt);
    assert.equal(appliesBeforeProvider(prompt, decision), false, prompt);
    assert.deepEqual(spec, before, prompt);
    assert.equal(componentValue(spec, 'R3'), '1k', prompt);
  }

  const matched = seriesSpec('220Ω');
  for (const prompt of mismatched) {
    const before = structuredClone(matched);
    const decision = classifyExistingProjectRequest(prompt, matched);
    assert.equal(decision.mode, 'merge', `${prompt} ${decision.code ?? ''} ${decision.message ?? ''}`);
    assert.equal(decision.edit?.ohms, 680, prompt);
    assert.equal(decision.edit?.label, '680Ω', prompt);
    assert.equal(decision.edit?.ref, 'R3', prompt);
    assert.equal(appliesBeforeProvider(prompt, decision), true, prompt);
    const next = applyExistingProjectEdit(matched, decision.edit);
    assert.equal(componentValue(next, 'R3'), '680Ω', prompt);
    assert.equal(componentValue(matched, 'R3'), '220Ω', prompt);
    assert.deepEqual(matched, before, prompt);
  }

  const from1k = classifyExistingProjectRequest('change the LED resistor from 1k to 680Ω', spec);
  assert.equal(from1k.mode, 'merge');
  assert.equal(from1k.edit?.ohms, 680);
  assert.equal(from1k.edit?.ref, 'R3');
  assert.equal(appliesBeforeProvider('change the LED resistor from 1k to 680Ω', from1k), true);
  const bareFrom = classifyExistingProjectRequest('from 1k to 680Ω', spec);
  assert.equal(bareFrom.code, undefined);
  assert.equal(bareFrom.edit, undefined);
  assert.equal(componentValue(spec, 'R3'), '1k');
});

test('a from-value with a grouping separator (1.000, 1,000) is RESISTOR_VALUE_AMBIGUOUS', () => {
  // d{1,3}[.,]ddd is one separator and exactly three digits. 1Ω and 1000 are both readings.
  const grouped = [
    ['change the LED resistor from 1.000 to 680Ω', '1.000'],
    ['from 1,000 to 680Ω', '1,000'],
    ['1.000에서 680Ω으로', '1.000'],
    ['1,000에서 680Ω으로', '1,000'],
    ['LED resistor 1.000 -> 680Ω', '1.000'],
    ['change the LED resistor from 12.345 to 680Ω', '12.345'],
    ['from 4,700 to 680Ω', '4,700']
  ];
  for (const current of ['1k', '330Ω']) {
    const spec = seriesSpec(current);
    for (const [prompt, fromRaw] of grouped) {
      const before = structuredClone(spec);
      const decision = classifyExistingProjectRequest(prompt, spec);
      const detail = `${current} ${prompt} ${decision.code ?? ''} ${decision.edit?.ohms ?? ''}`;
      assert.equal(decision.mode, 'refuse', detail);
      assert.equal(decision.code, 'RESISTOR_VALUE_AMBIGUOUS', detail);
      assert.equal(decision.edit, undefined, detail);
      assert.equal(decision.message, resistorValueAmbiguousMessage(null, [fromRaw, '680Ω']), detail);
      assert.equal(blocksBeforeProvider(prompt, decision), true, detail);
      assert.equal(appliesBeforeProvider(prompt, decision), false, detail);
      assert.deepEqual(spec, before, detail);
      assert.equal(componentValue(spec, 'R3'), current, detail);
    }
  }

  const matched = [
    ['change the LED resistor from 1000 to 680Ω', '1k'],
    ['change the LED resistor from 1k to 680Ω', '1k'],
    ['1000에서 680Ω으로', '1k'],
    ['1k에서 680Ω으로', '1k'],
    ['change the LED resistor from 1000.0 to 680Ω', '1k'],
    ['change the LED resistor from 1.5k to 680Ω', '1.5k'],
    ['1.5k에서 680Ω으로', '1.5k']
  ];
  for (const [prompt, current] of matched) {
    const spec = seriesSpec(current);
    const decision = classifyExistingProjectRequest(prompt, spec);
    assert.equal(decision.mode, 'merge', `${prompt} ${decision.code ?? ''}`);
    assert.equal(decision.edit?.ohms, 680, prompt);
    assert.equal(decision.edit?.ref, 'R3', prompt);
    assert.equal(appliesBeforeProvider(prompt, decision), true, prompt);
    assert.equal(blocksBeforeProvider(prompt, decision), false, prompt);
    assert.equal(componentValue(spec, 'R3'), current, prompt);
  }

  const bare = seriesSpec('1k');
  for (const prompt of ['from 1k to 680Ω', 'from 1000 to 680Ω', 'from 1.5k to 680Ω']) {
    const decision = classifyExistingProjectRequest(prompt, bare);
    assert.equal(decision.code, undefined, `${prompt} ${decision.code ?? ''}`);
    assert.equal(decision.edit, undefined, prompt);
    assert.equal(blocksBeforeProvider(prompt, decision), false, prompt);
    assert.equal(appliesBeforeProvider(prompt, decision), false, prompt);
    assert.equal(componentValue(bare, 'R3'), '1k', prompt);
  }

  const mismatch = classifyExistingProjectRequest('change the LED resistor from 1.5k to 680Ω', bare);
  assert.equal(mismatch.code, 'RESISTOR_VALUE_AMBIGUOUS');
  assert.equal(mismatch.message, resistorValueAmbiguousMessage(null, ['1.5k', '680Ω']));
  assert.equal(mismatch.edit, undefined);
  assert.equal(componentValue(bare, 'R3'), '1k');

  for (const prompt of ['change the LED resistor from 680 to 1,000 ohm', 'LED 저항 1.000', 'change the LED resistor from 1.000 ohm to 680Ω']) {
    const decision = classifyExistingProjectRequest(prompt, bare);
    assert.equal(decision.mode, 'refuse', prompt);
    assert.equal(decision.code, 'RESISTOR_VALUE_INVALID', `${prompt} ${decision.code ?? ''} ${decision.edit?.ohms ?? ''}`);
    assert.equal(decision.edit, undefined, prompt);
    assert.equal(componentValue(bare, 'R3'), '1k', prompt);
  }
});

test('a grouping-separator from-value on the R3 ref is RESISTOR_VALUE_AMBIGUOUS before the provider', () => {
  const spec = seriesSpec('1k');
  const ambiguous = [
    ['change R3 from 1.000 to 680', '1.000'],
    ['change R3 from 1,000 to 680', '1,000'],
    ['R3 1.000에서 680으로', '1.000'],
    ['R3 1.000 -> 680', '1.000']
  ];
  for (const [prompt, fromRaw] of ambiguous) {
    const before = structuredClone(spec);
    const decision = classifyExistingProjectRequest(prompt, spec);
    const detail = `${prompt} ${decision.code ?? ''} ${decision.edit?.ohms ?? ''}`;
    assert.equal(decision.mode, 'refuse', detail);
    assert.equal(decision.code, 'RESISTOR_VALUE_AMBIGUOUS', detail);
    assert.equal(decision.edit, undefined, detail);
    assert.equal(decision.message, resistorValueAmbiguousMessage('R3', [fromRaw, '680Ω']), detail);
    assert.equal(blocksBeforeProvider(prompt, decision), true, detail);
    assert.equal(appliesBeforeProvider(prompt, decision), false, detail);
    assert.deepEqual(spec, before, detail);
    assert.equal(componentValue(spec, 'R3'), '1k', detail);
  }

  const invalidMessage = resistorValueInvalidMessage();
  for (const prompt of [
    'change R3 from 1.000Ω to 680Ω',
    'change R3 from 1,000Ω to 680Ω',
    'change R3 from 1,000 ohms to 680 ohms',
    'change R3 from 1.000 Ω to 680 Ω',
    'R3 1,000Ω에서 680Ω으로'
  ]) {
    const before = structuredClone(spec);
    const decision = classifyExistingProjectRequest(prompt, spec);
    const detail = `${prompt} ${decision.code ?? ''} ${decision.edit?.ohms ?? ''}`;
    assert.equal(decision.mode, 'refuse', detail);
    assert.equal(decision.code, 'RESISTOR_VALUE_INVALID', detail);
    assert.equal(decision.message, invalidMessage, detail);
    assert.equal(decision.edit, undefined, detail);
    assert.equal(blocksBeforeProvider(prompt, decision), true, detail);
    assert.deepEqual(spec, before, detail);
    assert.equal(componentValue(spec, 'R3'), '1k', detail);
  }
});

test('property: a grouping-separator from-value on R3 or an LED resistor is RESISTOR_VALUE_AMBIGUOUS', () => {
  const targets = ['R3', 'r3', 'the LED resistor', 'LED 저항'];
  const values = ['1.000', '1,000', '2.200', '4,700'];
  const forms = [
    (target, value) => `change ${target} from ${value} to 680`,
    (target, value) => `${target} ${value}에서 680으로`,
    (target, value) => `${target} ${value} -> 680`
  ];
  const samples = [];
  for (const target of targets) {
    for (const form of forms) {
      for (const value of values) samples.push({ target, value, prompt: form(target, value) });
    }
  }
  assert.equal(samples.length, targets.length * forms.length * values.length);
  for (const current of ['1k', '330Ω']) {
    const spec = seriesSpec(current);
    for (const sample of samples) {
      const before = structuredClone(spec);
      const decision = classifyExistingProjectRequest(sample.prompt, spec);
      const ref = /^r\d+$/i.test(sample.target) ? sample.target.toUpperCase() : null;
      const detail = `${current} ${sample.prompt} ${decision.code ?? ''} ${decision.edit?.ohms ?? ''}`;
      assert.equal(decision.mode, 'refuse', detail);
      assert.equal(decision.code, 'RESISTOR_VALUE_AMBIGUOUS', detail);
      assert.equal(decision.edit, undefined, detail);
      assert.equal(decision.message, resistorValueAmbiguousMessage(ref, [sample.value, '680Ω']), detail);
      assert.equal(blocksBeforeProvider(sample.prompt, decision), true, detail);
      assert.equal(appliesBeforeProvider(sample.prompt, decision), false, detail);
      assert.deepEqual(spec, before, detail);
      assert.equal(componentValue(spec, 'R3'), current, detail);
    }
  }
});

test("'&' is a value separator", () => {
  const rows = [
    ['LED resistor 680Ω & 1k', ['680Ω', '1k']],
    ['LED 저항 680Ω & 1kΩ', ['680Ω', '1k']]
  ];
  for (const current of ['330Ω', '1k']) {
    const spec = seriesSpec(current);
    for (const [prompt, labels] of rows) {
      const decision = classifyExistingProjectRequest(prompt, spec);
      assert.equal(decision.mode, 'refuse', `${current} ${prompt} ${decision.code ?? ''} ${decision.message ?? ''}`);
      assert.equal(decision.code, 'RESISTOR_VALUE_AMBIGUOUS', prompt);
      assert.equal(decision.edit, undefined, prompt);
      assert.equal(decision.message, resistorValueAmbiguousMessage(null, labels), prompt);
      assert.equal(assessRequestCoverage(prompt).alternative, true, prompt);
      assert.equal(blocksBeforeProvider(prompt, decision), true, prompt);
      assert.equal(componentValue(spec, 'R3'), current, prompt);
    }
  }
});

test('duplicate equal values apply once', () => {
  const spec = seriesSpec('330Ω');
  const rows = [
    ['LED resistor 4k7 and 4.7k', 4700, '4.7k'],
    ['1k & 1000Ω', 1000, '1k']
  ];
  for (const [prompt, ohms, label] of rows) {
    const decision = classifyExistingProjectRequest(prompt, spec);
    assert.equal(decision.mode, 'merge', `${prompt} ${decision.code ?? ''} ${decision.message ?? ''}`);
    assert.equal(decision.edit?.ohms, ohms, prompt);
    assert.equal(decision.edit?.label, label, prompt);
    assert.equal(decision.edit?.ref, 'R3', prompt);
    assert.equal(appliesBeforeProvider(prompt, decision), true, prompt);
    assert.equal(assessRequestCoverage(prompt).alternative, false, prompt);
    const next = applyExistingProjectEdit(spec, decision.edit);
    assert.equal(componentValue(next, 'R3'), label, prompt);
    assert.equal(componentValue(spec, 'R3'), '330Ω', prompt);
  }

  const same = seriesSpec('1k');
  const unchanged = classifyExistingProjectRequest('1k & 1000Ω', same);
  assert.equal(unchanged.code, 'RESISTOR_VALUE_UNCHANGED');
  assert.equal(unchanged.edit, undefined);
  assert.equal(componentValue(same, 'R3'), '1k');
});

test('transitions and resistor keep clauses still apply, and questions stay with the provider', () => {
  const spec = seriesSpec('1k');
  const merges = [
    ['1k에서 680Ω으로', 680],
    ['LED 저항을 1k에서 680Ω으로', 680],
    ['change the LED resistor from 1k to 680Ω', 680],
    ['LED resistor from 1k to 680Ω', 680],
    ['LED resistor -> 680Ω', 680],
    ['keep the pull-up resistors, set the LED resistor to 680Ω', 680],
    ['풀업 저항은 건드리지 말고 LED 저항 680Ω으로', 680],
    ['keep R4, set R3 to 680Ω', 680],
    ['LED resistor to 680Ω if you can', 680],
    ['LED resistor to 680Ω if you could', 680],
    ['if you could change the LED resistor to 680Ω', 680],
    ['the LED resistor should be 680Ω', 680],
    ['LED resistor to 680Ω if possible', 680],
    ['R4는 건드리지 말고 LED 저항 680Ω으로', 680],
    ["don't touch R4, set the LED resistor to 680Ω", 680],
    ['keep R4, set the LED resistor to 680Ω', 680]
  ];
  for (const [prompt, ohms] of merges) {
    const decision = classifyExistingProjectRequest(prompt, spec);
    assert.equal(decision.mode, 'merge', `${prompt} ${decision.code ?? ''} ${decision.message ?? ''}`);
    assert.equal(decision.edit?.ohms, ohms, prompt);
    assert.equal(decision.edit?.ref, 'R3', prompt);
    assert.equal(appliesBeforeProvider(prompt, decision), true, prompt);
    assert.equal(assessRequestCoverage(prompt).covered, true, prompt);
    assert.notEqual(assessRequestCoverage(prompt).negatedOrAlternative, true, prompt);
  }

  const bareFrom = classifyExistingProjectRequest('from 1k to 680Ω', spec);
  assert.equal(bareFrom.mode, 'refuse');
  assert.equal(bareFrom.code, undefined);
  assert.equal(bareFrom.edit, undefined);
  assert.equal(blocksBeforeProvider('from 1k to 680Ω', bareFrom), false);
  assert.equal(appliesBeforeProvider('from 1k to 680Ω', bareFrom), false);

  for (const prompt of [
    'why not change the LED resistor to 680Ω?',
    'what happens if I change the LED resistor to 680Ω?',
    'how do I change the LED resistor to 680Ω?',
    'what does R3 do?'
  ]) {
    const decision = classifyExistingProjectRequest(prompt, spec);
    assert.equal(decision.mode, 'refuse', prompt);
    assert.equal(decision.code, undefined, `${prompt} ${decision.code ?? ''}`);
    assert.equal(decision.edit, undefined, prompt);
    assert.equal(blocksBeforeProvider(prompt, decision), false, prompt);
  }

  const unitless = classifyExistingProjectRequest('change R3 to 470 or 680', spec);
  assert.equal(unitless.code, 'RESISTOR_VALUE_INVALID');
  assert.equal(unitless.message, resistorUnitlessMessage());
  assert.equal(unitless.edit, undefined);

  const twoValues = classifyExistingProjectRequest('LED resistor 330 ohm or 680 ohm', spec);
  assert.equal(twoValues.code, 'RESISTOR_VALUE_AMBIGUOUS');
  assert.equal(twoValues.message, resistorValueAmbiguousMessage(null, ['330Ω', '680Ω']));
  const twoRef = classifyExistingProjectRequest('set R3 330Ω 680Ω', spec);
  assert.equal(twoRef.code, 'RESISTOR_VALUE_AMBIGUOUS');
  assert.equal(twoRef.message, resistorValueAmbiguousMessage('R3', ['330Ω', '680Ω']));

  const unsupported = resistorRefUnsupportedMessage('R3');
  for (const prompt of [
    '풀업을 그대로 두지 말고 2.2k로',
    "don't leave the pull-up as is, change it to 2.2k",
    'LED resistor to 680Ω or the pull-up to 2.2k'
  ]) {
    const decision = classifyExistingProjectRequest(prompt, spec);
    assert.equal(decision.mode, 'refuse', prompt);
    assert.equal(decision.code, 'RESISTOR_REF_UNSUPPORTED', `${prompt} ${decision.code ?? ''} ${decision.message ?? ''}`);
    assert.equal(decision.message, unsupported, prompt);
    assert.equal(decision.edit, undefined, prompt);
    assert.equal(appliesBeforeProvider(prompt, decision), false, prompt);
  }

  for (const prompt of [
    'do not remove I2C and set LED resistor to 680Ω',
    "don't delete I2C, LED resistor to 680Ω",
    '680옴으로 바꿔줘. I2C는 삭제하지 마',
    'LED 저항 삭제하지 말고 680Ω으로'
  ]) {
    const decision = classifyExistingProjectRequest(prompt, spec);
    assert.equal(decision.mode, 'refuse', prompt);
    assert.equal(decision.code, 'RESISTOR_TARGET_UNCLEAR', `${prompt} ${decision.code ?? ''} ${decision.message ?? ''}`);
    assert.equal(decision.edit, undefined, prompt);
    assert.equal(appliesBeforeProvider(prompt, decision), false, prompt);
  }
});

test('a valued keep of another part still applies the LED resistor', () => {
  const spec = seriesSpec('1k');
  const merges = [
    'set the LED resistor to 680Ω but keep R4 at 4.7k',
    'keep R4 at 680Ω, set the LED resistor to 680Ω'
  ];
  for (const prompt of merges) {
    const before = structuredClone(spec);
    const decision = classifyExistingProjectRequest(prompt, spec);
    assert.equal(decision.mode, 'merge', `${prompt} ${decision.code ?? ''} ${decision.message ?? ''}`);
    assert.equal(decision.code, undefined, prompt);
    assert.equal(decision.edit?.ohms, 680, prompt);
    assert.equal(decision.edit?.label, '680Ω', prompt);
    assert.equal(decision.edit?.ref, 'R3', prompt);
    assert.equal(appliesBeforeProvider(prompt, decision), true, prompt);
    assert.equal(blocksBeforeProvider(prompt, decision), false, prompt);
    const next = applyExistingProjectEdit(spec, decision.edit);
    assert.equal(componentValue(next, 'R3'), '680Ω', prompt);
    assert.equal(componentValue(next, 'R4'), '4.7k', prompt);
    assert.equal(componentValue(next, 'R1'), '5.1k', prompt);
    assert.equal(componentValue(spec, 'R3'), '1k', prompt);
    assert.deepEqual(spec, before, prompt);
  }

  const prompt = 'keep R4 at 680Ω';
  const before = structuredClone(spec);
  const decision = classifyExistingProjectRequest(prompt, spec);
  assert.equal(decision.mode, 'refuse', prompt);
  assert.equal(decision.code, 'RESISTOR_AMBIGUOUS', prompt);
  assert.equal(decision.message, resistorAmbiguousMessage(), prompt);
  assert.equal(decision.edit, undefined, prompt);
  assert.equal(blocksBeforeProvider(prompt, decision), true, prompt);
  assert.equal(appliesBeforeProvider(prompt, decision), false, prompt);
  assert.equal(componentValue(spec, 'R3'), '1k', prompt);
  assert.equal(componentValue(spec, 'R4'), '4.7k', prompt);
  assert.deepEqual(spec, before, prompt);
});

test('or so approximates a value and does not join a valued keep as a choice', () => {
  const spec = seriesSpec('1k');
  const merges = [
    'set the LED resistor to 680Ω and keep R4 at 4.7k or so',
    'keep R4 at 4.7k or so, set the LED resistor to 680Ω',
    'set the LED resistor to 680Ω or so'
  ];
  for (const prompt of merges) {
    const before = structuredClone(spec);
    const decision = classifyExistingProjectRequest(prompt, spec);
    assert.equal(decision.mode, 'merge', `${prompt} ${decision.code ?? ''} ${decision.message ?? ''}`);
    assert.equal(decision.code, undefined, prompt);
    assert.equal(decision.edit?.ohms, 680, prompt);
    assert.equal(decision.edit?.label, '680Ω', prompt);
    assert.equal(decision.edit?.ref, 'R3', prompt);
    assert.equal(appliesBeforeProvider(prompt, decision), true, prompt);
    assert.equal(blocksBeforeProvider(prompt, decision), false, prompt);
    const next = applyExistingProjectEdit(spec, decision.edit);
    assert.equal(componentValue(next, 'R3'), '680Ω', prompt);
    assert.equal(componentValue(next, 'R4'), '4.7k', prompt);
    assert.equal(componentValue(next, 'R1'), '5.1k', prompt);
    assert.equal(componentValue(spec, 'R3'), '1k', prompt);
    assert.deepEqual(spec, before, prompt);
  }

  const message = resistorAmbiguousMessage();
  const ambiguous = [
    'set the LED resistor to 680Ω or keep R4 at 4.7k',
    'keep R4 at 4.7k or so'
  ];
  for (const prompt of ambiguous) {
    const before = structuredClone(spec);
    const decision = classifyExistingProjectRequest(prompt, spec);
    assert.equal(decision.mode, 'refuse', `${prompt} ${decision.code ?? ''} ${decision.message ?? ''}`);
    assert.equal(decision.code, 'RESISTOR_AMBIGUOUS', prompt);
    assert.equal(decision.message, message, prompt);
    assert.equal(decision.edit, undefined, prompt);
    assert.equal(blocksBeforeProvider(prompt, decision), true, prompt);
    assert.equal(appliesBeforeProvider(prompt, decision), false, prompt);
    assert.equal(componentValue(spec, 'R3'), '1k', prompt);
    assert.equal(componentValue(spec, 'R4'), '4.7k', prompt);
    assert.deepEqual(spec, before, prompt);
  }
});

test('a valued keep joined by or, 또는, or 아니면 is RESISTOR_AMBIGUOUS', () => {
  const spec = seriesSpec('1k');
  const message = resistorAmbiguousMessage();
  const prompts = [
    'set the LED resistor to 680Ω or keep R4 at 4.7k',
    'keep R4 at 4.7k or set the LED resistor to 680Ω',
    'LED 저항을 680Ω으로 또는 R4는 4.7k로 유지',
    'LED 저항을 680Ω으로 아니면 R4는 4.7k로 유지'
  ];
  for (const prompt of prompts) {
    const before = structuredClone(spec);
    const decision = classifyExistingProjectRequest(prompt, spec);
    assert.equal(decision.mode, 'refuse', `${prompt} ${decision.code ?? ''} ${decision.message ?? ''}`);
    assert.equal(decision.code, 'RESISTOR_AMBIGUOUS', prompt);
    assert.equal(decision.message, message, prompt);
    assert.equal(decision.edit, undefined, prompt);
    assert.equal(blocksBeforeProvider(prompt, decision), true, prompt);
    assert.equal(appliesBeforeProvider(prompt, decision), false, prompt);
    assert.equal(componentValue(spec, 'R3'), '1k', prompt);
    assert.equal(componentValue(spec, 'R4'), '4.7k', prompt);
    assert.deepEqual(spec, before, prompt);
  }
});

test('a verb-ending or 혹은 choice keep is RESISTOR_AMBIGUOUS and a but or 고 keep applies R3', () => {
  const spec = seriesSpec('1k');
  const message = resistorAmbiguousMessage();
  const ambiguous = [
    'LED 저항 680Ω으로 바꾸거나 R4는 4.7k로 유지',
    'LED 저항 680Ω으로 바꾸든지 R4는 4.7k로 유지',
    'LED 저항 680Ω으로 바꾸든가 R4는 4.7k로 유지',
    'LED 저항 680Ω으로 바꾸던지 R4는 4.7k로 유지',
    'LED 저항 680Ω으로 바꾸든 R4는 4.7k로 유지',
    'LED 저항 680Ω으로 바꾸거나요 R4는 4.7k로 유지',
    'LED 저항 680Ω으로 바꾸든지요 R4는 4.7k로 유지',
    'LED 저항 680Ω으로 바꾸든가도 R4는 4.7k로 유지',
    'LED 저항 680Ω으로 바꾸던지나 R4는 4.7k로 유지',
    'LED 저항 680Ω으로 바꾸든요 R4는 4.7k로 유지',
    'LED 저항 680Ω으로 바꾸거나요, R4는 4.7k로 유지',
    'LED 저항 680Ω으로 혹은 R4는 4.7k로 유지',
    'LED는 그대로 두고 저항 680Ω'
  ];
  for (const prompt of ambiguous) {
    const before = structuredClone(spec);
    const decision = classifyExistingProjectRequest(prompt, spec);
    assert.equal(decision.mode, 'refuse', `${prompt} ${decision.code ?? ''} ${decision.message ?? ''}`);
    assert.equal(decision.code, 'RESISTOR_AMBIGUOUS', prompt);
    assert.equal(decision.message, message, prompt);
    assert.equal(decision.edit, undefined, prompt);
    assert.equal(blocksBeforeProvider(prompt, decision), true, prompt);
    assert.equal(appliesBeforeProvider(prompt, decision), false, prompt);
    assert.equal(componentValue(spec, 'R3'), '1k', prompt);
    assert.equal(componentValue(spec, 'R4'), '4.7k', prompt);
    assert.deepEqual(spec, before, prompt);
  }

  const applies = [
    'set the LED resistor to 680Ω but keep R4 at 4.7k',
    'LED 저항 680Ω으로 바꾸고 R4는 4.7k로 유지'
  ];
  for (const prompt of applies) {
    const before = structuredClone(spec);
    const decision = classifyExistingProjectRequest(prompt, spec);
    assert.equal(decision.mode, 'merge', `${prompt} ${decision.code ?? ''} ${decision.message ?? ''}`);
    assert.equal(decision.code, undefined, prompt);
    assert.equal(decision.edit?.ohms, 680, prompt);
    assert.equal(decision.edit?.label, '680Ω', prompt);
    assert.equal(decision.edit?.ref, 'R3', prompt);
    assert.equal(appliesBeforeProvider(prompt, decision), true, prompt);
    assert.equal(blocksBeforeProvider(prompt, decision), false, prompt);
    const next = applyExistingProjectEdit(spec, decision.edit);
    assert.equal(componentValue(next, 'R3'), '680Ω', prompt);
    assert.equal(componentValue(next, 'R4'), '4.7k', prompt);
    assert.equal(componentValue(next, 'R1'), '5.1k', prompt);
    assert.equal(componentValue(spec, 'R3'), '1k', prompt);
    assert.deepEqual(spec, before, prompt);
  }
});

const CHOICE_ENDING_TEXTS = ['거나', '든지', '든가', '던지', '든'];
const CHOICE_ENDING_PARTICLES = ['', '요', '도', '나'];

const CHOICE_KEEP_JOINERS = [
  { kind: 'en', text: 'or' },
  { kind: 'ko-word', text: '또는' },
  { kind: 'ko-word', text: '아니면' },
  { kind: 'ko-word', text: '혹은' },
  ...CHOICE_ENDING_TEXTS.flatMap((ending) => (
    CHOICE_ENDING_PARTICLES.map((particle) => ({ kind: 'ko-end', text: `${ending}${particle}` }))
  ))
];

const CONTROL_KEEP_JOINERS = [
  { kind: 'en', text: 'but' },
  { kind: 'en', text: 'and' },
  { kind: 'ko-end', text: '고' },
  { kind: 'ko-word', text: '하고' }
];

const VALUED_KEEP_CLAUSES = [
  { en: 'R4 at 4.7k', ko: 'R4는 4.7k로 유지' },
  { en: 'R1 at 5.1k', ko: 'R1은 5.1k로 유지' },
  { en: 'the pull-ups at 10k', ko: '풀업은 10k로 유지' }
];

function valuedKeepJoinerSentence(joiner, keep, order) {
  if (joiner.kind === 'en') {
    const kept = `keep ${keep.en}`;
    const edit = 'set the LED resistor to 680Ω';
    return order === 'edit-first' ? `${edit} ${joiner.text} ${kept}` : `${kept} ${joiner.text} ${edit}`;
  }
  if (joiner.kind === 'ko-word') {
    const edit = 'LED 저항 680Ω으로';
    return order === 'edit-first' ? `${edit} ${joiner.text} ${keep.ko}` : `${keep.ko} ${joiner.text} ${edit}`;
  }
  const edit = `LED 저항 680Ω으로 바꾸${joiner.text}`;
  const kept = keep.ko.replace(/유지$/u, `유지하${joiner.text}`);
  return order === 'edit-first' ? `${edit} ${keep.ko}` : `${kept} LED 저항 680Ω으로`;
}

// Full clauses. English already includes the verb. As-is Korean is "그대로 두" plus the ending.
const CHOICE_KEEP_KINDS = [
  { id: 'valued', en: 'keep R4 at 4.7k', ko: 'R4는 4.7k로 유지' },
  { id: 'unvalued', en: 'keep R4', ko: 'R4 유지' },
  { id: 'as-is', en: 'leave it as is', ko: '그대로 두거나' }
];

function choiceKeepKindSentence(joiner, kind, order) {
  if (joiner.kind === 'en') {
    const edit = 'set the LED resistor to 680Ω';
    return order === 'edit-first' ? `${edit} ${joiner.text} ${kind.en}` : `${kind.en} ${joiner.text} ${edit}`;
  }
  if (joiner.kind === 'ko-word') {
    const edit = 'LED 저항 680Ω으로';
    return order === 'edit-first' ? `${edit} ${joiner.text} ${kind.ko}` : `${kind.ko} ${joiner.text} ${edit}`;
  }
  const edit = `LED 저항 680Ω으로 바꾸${joiner.text}`;
  const kept = kind.id === 'as-is'
    ? `그대로 두${joiner.text}`
    : kind.ko.replace(/유지$/u, `유지하${joiner.text}`);
  const keepClause = kind.id === 'as-is' ? '그대로 두거나' : kind.ko;
  return order === 'edit-first' ? `${edit} ${keepClause}` : `${kept} LED 저항 680Ω으로`;
}

test('뭐든 and 언제든 keep today\'s outcome and are not choice joiners', () => {
  const spec = seriesSpec('1k');
  const unsupported = resistorRefUnsupportedMessage('R3');
  const bare = '뭐든 LED 저항 680Ω으로';
  const bareBefore = structuredClone(spec);
  const bareDecision = classifyExistingProjectRequest(bare, spec);
  assert.equal(bareDecision.mode, 'refuse', bare);
  assert.equal(bareDecision.code, undefined, bare);
  assert.equal(bareDecision.message, undefined, bare);
  assert.equal(bareDecision.edit, undefined, bare);
  assert.equal(blocksBeforeProvider(bare, bareDecision), false, bare);
  assert.equal(appliesBeforeProvider(bare, bareDecision), false, bare);
  assert.equal(componentValue(spec, 'R3'), '1k', bare);
  assert.equal(componentValue(spec, 'R4'), '4.7k', bare);
  assert.deepEqual(spec, bareBefore, bare);

  const when = '언제든 LED 저항 680Ω으로 바꿔줘';
  const whenBefore = structuredClone(spec);
  const whenDecision = classifyExistingProjectRequest(when, spec);
  assert.equal(whenDecision.mode, 'refuse', when);
  assert.equal(whenDecision.code, 'RESISTOR_REF_UNSUPPORTED', when);
  assert.equal(whenDecision.message, unsupported, when);
  assert.equal(whenDecision.edit, undefined, when);
  assert.equal(blocksBeforeProvider(when, whenDecision), true, when);
  assert.equal(appliesBeforeProvider(when, whenDecision), false, when);
  assert.equal(componentValue(spec, 'R3'), '1k', when);
  assert.equal(componentValue(spec, 'R4'), '4.7k', when);
  assert.deepEqual(spec, whenBefore, when);
});

test('a choice joiner before any keep, valued or not, or before leaving it as is, is RESISTOR_AMBIGUOUS', () => {
  const spec = seriesSpec('1k');
  const message = resistorAmbiguousMessage();
  const ambiguous = [
    'LED 저항 680Ω으로 바꾸거나 R4 유지',
    'LED 저항을 680Ω으로 바꾸거나 그대로 두거나',
    'set the LED resistor to 680Ω or keep R4',
    'set the LED resistor to 680Ω or leave it as is'
  ];
  for (const prompt of ambiguous) {
    const before = structuredClone(spec);
    const decision = classifyExistingProjectRequest(prompt, spec);
    assert.equal(decision.mode, 'refuse', `${prompt} ${decision.code ?? ''} ${decision.message ?? ''}`);
    assert.equal(decision.code, 'RESISTOR_AMBIGUOUS', prompt);
    assert.equal(decision.message, message, prompt);
    assert.equal(decision.edit, undefined, prompt);
    assert.equal(blocksBeforeProvider(prompt, decision), true, prompt);
    assert.equal(appliesBeforeProvider(prompt, decision), false, prompt);
    assert.equal(componentValue(spec, 'R3'), '1k', prompt);
    assert.equal(componentValue(spec, 'R4'), '4.7k', prompt);
    assert.deepEqual(spec, before, prompt);
  }

  const applies = [
    'LED 저항 680Ω으로 바꾸고 R4 유지',
    'set the LED resistor to 680Ω and keep R4'
  ];
  for (const prompt of applies) {
    const before = structuredClone(spec);
    const decision = classifyExistingProjectRequest(prompt, spec);
    assert.equal(decision.mode, 'merge', `${prompt} ${decision.code ?? ''} ${decision.message ?? ''}`);
    assert.equal(decision.code, undefined, prompt);
    assert.equal(decision.edit?.ohms, 680, prompt);
    assert.equal(decision.edit?.label, '680Ω', prompt);
    assert.equal(decision.edit?.ref, 'R3', prompt);
    assert.equal(appliesBeforeProvider(prompt, decision), true, prompt);
    assert.equal(blocksBeforeProvider(prompt, decision), false, prompt);
    const next = applyExistingProjectEdit(spec, decision.edit);
    assert.equal(componentValue(next, 'R3'), '680Ω', prompt);
    assert.equal(componentValue(next, 'R4'), '4.7k', prompt);
    assert.equal(componentValue(next, 'R1'), '5.1k', prompt);
    assert.equal(componentValue(spec, 'R3'), '1k', prompt);
    assert.deepEqual(spec, before, prompt);
  }
});

test('a non-choice -거나 hedge applies R3 and a real choice stays a refusal', () => {
  const spec = seriesSpec('1k');
  const message = resistorAmbiguousMessage();
  const unclear = resistorTargetUnclearMessage('680');
  const unsupported = resistorRefUnsupportedMessage('R3');
  const applies = [
    'LED 저항이 너무 밝거나 해서 680Ω으로 바꿔줘',
    '밝기가 거슬리거나 하니 LED 저항 680Ω으로',
    '밝기가 약하거나 해서 LED 저항 680Ω으로 바꿔줘',
    'LED 저항 680Ω으로 바꿔주시거나 하면 좋겠어요',
    'LED 저항 680Ω으로 바꿔 주시거나 하면 감사하겠어요',
    'LED 저항 680Ω으로 바꾸거나 한다면 좋겠어요',
    '거나한 건 아니고 LED 저항 680Ω으로 바꿔줘',
    '거나 한 건 아니고 LED 저항 680Ω으로 바꿔줘',
    'LED 저항이 너무 밝거나 하고 680Ω으로 바꿔줘',
    'LED가 어둡거나 하면 LED 저항을 680Ω으로 바꿔줘'
  ];
  for (const prompt of applies) {
    const before = structuredClone(spec);
    const decision = classifyExistingProjectRequest(prompt, spec);
    assert.equal(decision.mode, 'merge', `${prompt} ${decision.code ?? ''} ${decision.message ?? ''}`);
    assert.equal(decision.code, undefined, prompt);
    assert.equal(decision.edit?.ohms, 680, prompt);
    assert.equal(decision.edit?.label, '680Ω', prompt);
    assert.equal(decision.edit?.ref, 'R3', prompt);
    assert.equal(appliesBeforeProvider(prompt, decision), true, prompt);
    assert.equal(blocksBeforeProvider(prompt, decision), false, prompt);
    const next = applyExistingProjectEdit(spec, decision.edit);
    assert.equal(componentValue(next, 'R3'), '680Ω', prompt);
    assert.equal(componentValue(next, 'R4'), '4.7k', prompt);
    assert.equal(componentValue(next, 'R1'), '5.1k', prompt);
    assert.equal(componentValue(spec, 'R3'), '1k', prompt);
    assert.deepEqual(spec, before, prompt);
  }

  const ambiguous = [
    'LED 저항을 680Ω으로 바꾸거나 두거나 R4는 그대로 둬',
    'LED 저항 680Ω으로 바꾸거나 R4는 그대로 둬',
    'LED 저항 680Ω으로 바꾸든 R4는 4.7k로 유지',
    'LED 저항 680Ω으로 바꾸거나요 R4는 4.7k로 유지',
    'LED 저항을 680Ω으로 하든 말든 R4는 그대로 둬',
    'LED 저항을 680Ω으로 하거나 말거나 R4는 그대로 둬',
    'LED 저항을 680Ω으로 바꾸거나 하면 R4는 그대로 둬'
  ];
  for (const prompt of ambiguous) {
    const before = structuredClone(spec);
    const decision = classifyExistingProjectRequest(prompt, spec);
    assert.equal(decision.mode, 'refuse', `${prompt} ${decision.code ?? ''}`);
    assert.equal(decision.code, 'RESISTOR_AMBIGUOUS', prompt);
    assert.equal(decision.message, message, prompt);
    assert.equal(decision.edit, undefined, prompt);
    assert.equal(blocksBeforeProvider(prompt, decision), true, prompt);
    assert.equal(appliesBeforeProvider(prompt, decision), false, prompt);
    assert.equal(componentValue(spec, 'R3'), '1k', prompt);
    assert.equal(componentValue(spec, 'R4'), '4.7k', prompt);
    assert.deepEqual(spec, before, prompt);
  }

  const unclearPrompts = [
    '너무 밝거나 해서 680Ω으로 바꿔줘',
    'R3나 R4 중 하나를 680Ω으로',
    'R3 또는 R4 중 하나를 680Ω으로'
  ];
  for (const prompt of unclearPrompts) {
    const before = structuredClone(spec);
    const decision = classifyExistingProjectRequest(prompt, spec);
    assert.equal(decision.mode, 'refuse', `${prompt} ${decision.code ?? ''}`);
    assert.equal(decision.code, 'RESISTOR_TARGET_UNCLEAR', prompt);
    assert.equal(decision.message, unclear, prompt);
    assert.equal(decision.edit, undefined, prompt);
    assert.equal(blocksBeforeProvider(prompt, decision), true, prompt);
    assert.equal(appliesBeforeProvider(prompt, decision), false, prompt);
    assert.equal(componentValue(spec, 'R3'), '1k', prompt);
    assert.equal(componentValue(spec, 'R4'), '4.7k', prompt);
    assert.deepEqual(spec, before, prompt);
  }

  const valueMessage = resistorValueAmbiguousMessage(null, ['680Ω', '1k']);
  const secondValue = [
    'LED 저항 680Ω으로 바꾸거나 하면 1k',
    'LED 저항 680Ω으로 바꾸거나 해서 1k',
    'LED 저항 680Ω으로 바꾸거나 하고 1k'
  ];
  for (const prompt of secondValue) {
    const before = structuredClone(spec);
    const decision = classifyExistingProjectRequest(prompt, spec);
    assert.equal(decision.mode, 'refuse', `${prompt} ${decision.code ?? ''}`);
    assert.equal(decision.code, 'RESISTOR_VALUE_AMBIGUOUS', prompt);
    assert.equal(decision.message, valueMessage, prompt);
    assert.equal(decision.edit, undefined, prompt);
    assert.equal(blocksBeforeProvider(prompt, decision), true, prompt);
    assert.equal(appliesBeforeProvider(prompt, decision), false, prompt);
    assert.equal(componentValue(spec, 'R3'), '1k', prompt);
    assert.equal(componentValue(spec, 'R4'), '4.7k', prompt);
    assert.deepEqual(spec, before, prompt);
  }

  const bare = '바꿔주시거나 하면 좋겠어요';
  const bareBefore = structuredClone(spec);
  const bareDecision = classifyExistingProjectRequest(bare, spec);
  assert.equal(bareDecision.mode, 'refuse', bare);
  assert.equal(bareDecision.code, undefined, bare);
  assert.equal(bareDecision.message, undefined, bare);
  assert.equal(bareDecision.edit, undefined, bare);
  assert.equal(blocksBeforeProvider(bare, bareDecision), false, bare);
  assert.equal(appliesBeforeProvider(bare, bareDecision), false, bare);
  assert.equal(componentValue(spec, 'R3'), '1k', bare);
  assert.equal(componentValue(spec, 'R4'), '4.7k', bare);
  assert.deepEqual(spec, bareBefore, bare);

  const contrast = 'LED가 너무 밝거나 어두우면 LED 저항을 680Ω으로 바꿔줘';
  const contrastBefore = structuredClone(spec);
  const contrastDecision = classifyExistingProjectRequest(contrast, spec);
  assert.equal(contrastDecision.mode, 'refuse', contrast);
  assert.equal(contrastDecision.code, 'RESISTOR_REF_UNSUPPORTED', contrast);
  assert.equal(contrastDecision.message, unsupported, contrast);
  assert.equal(contrastDecision.edit, undefined, contrast);
  assert.equal(blocksBeforeProvider(contrast, contrastDecision), true, contrast);
  assert.equal(appliesBeforeProvider(contrast, contrastDecision), false, contrast);
  assert.equal(componentValue(spec, 'R3'), '1k', contrast);
  assert.equal(componentValue(spec, 'R4'), '4.7k', contrast);
  assert.deepEqual(spec, contrastBefore, contrast);
});

// Q1, Q2, and the three 'LED 저항 680Ω으로 바꾸거나 하면/해서/하고 1k' sentences
// are already asserted in 'a non-choice -거나 hedge applies R3 and a real choice stays a refusal'.
// Q5 is the hygiene review wording: a keep makes the choice, and '하든 말든' with no keep does not.
// 'LED 저항을 거나하게 680Ω으로' is the other 거나하게 form.
test('Hygiene pr28-r1 pinned hedge decisions', () => {
  const spec = seriesSpec('1k');
  const message = resistorAmbiguousMessage();
  const unclear = resistorTargetUnclearMessage('680');
  const applies = [
    'R4는 그대로 두거나 하고 LED 저항 680Ω으로',
    '거나하게 LED 저항 680Ω으로 바꿔줘',
    'LED 저항을 거나하게 680Ω으로'
  ];
  for (const prompt of applies) {
    const before = structuredClone(spec);
    const decision = classifyExistingProjectRequest(prompt, spec);
    assert.equal(decision.mode, 'merge', `${prompt} ${decision.code ?? ''} ${decision.message ?? ''}`);
    assert.equal(decision.code, undefined, prompt);
    assert.equal(decision.edit?.ohms, 680, prompt);
    assert.equal(decision.edit?.label, '680Ω', prompt);
    assert.equal(decision.edit?.ref, 'R3', prompt);
    assert.equal(appliesBeforeProvider(prompt, decision), true, prompt);
    assert.equal(blocksBeforeProvider(prompt, decision), false, prompt);
    const next = applyExistingProjectEdit(spec, decision.edit);
    assert.equal(componentValue(next, 'R3'), '680Ω', prompt);
    assert.equal(componentValue(next, 'R4'), '4.7k', prompt);
    assert.equal(componentValue(next, 'R1'), '5.1k', prompt);
    assert.equal(componentValue(spec, 'R3'), '1k', prompt);
    assert.deepEqual(spec, before, prompt);
  }

  const ambiguous = 'LED 저항을 680Ω으로 바꾸거나 하든 R4는 그대로';
  const ambiguousBefore = structuredClone(spec);
  const ambiguousDecision = classifyExistingProjectRequest(ambiguous, spec);
  assert.equal(ambiguousDecision.mode, 'refuse', ambiguous);
  assert.equal(ambiguousDecision.code, 'RESISTOR_AMBIGUOUS', ambiguous);
  assert.equal(ambiguousDecision.message, message, ambiguous);
  assert.equal(ambiguousDecision.edit, undefined, ambiguous);
  assert.equal(blocksBeforeProvider(ambiguous, ambiguousDecision), true, ambiguous);
  assert.equal(appliesBeforeProvider(ambiguous, ambiguousDecision), false, ambiguous);
  assert.equal(componentValue(spec, 'R3'), '1k', ambiguous);
  assert.equal(componentValue(spec, 'R4'), '4.7k', ambiguous);
  assert.deepEqual(spec, ambiguousBefore, ambiguous);

  const unclearPrompt = 'LED 저항 680Ω으로 바꾸거나 하든 말든';
  const unclearBefore = structuredClone(spec);
  const unclearDecision = classifyExistingProjectRequest(unclearPrompt, spec);
  assert.equal(unclearDecision.mode, 'refuse', unclearPrompt);
  assert.equal(unclearDecision.code, 'RESISTOR_TARGET_UNCLEAR', unclearPrompt);
  assert.equal(unclearDecision.message, unclear, unclearPrompt);
  assert.equal(unclearDecision.edit, undefined, unclearPrompt);
  assert.equal(blocksBeforeProvider(unclearPrompt, unclearDecision), true, unclearPrompt);
  assert.equal(appliesBeforeProvider(unclearPrompt, unclearDecision), false, unclearPrompt);
  assert.equal(componentValue(spec, 'R3'), '1k', unclearPrompt);
  assert.equal(componentValue(spec, 'R4'), '4.7k', unclearPrompt);
  assert.deepEqual(spec, unclearBefore, unclearPrompt);
});

// The 고 of "-거나 하-" is the hedge auxiliary, not a clause break. Splitting
// there would drop the keep and apply 680Ω to R3.
test('a 거나 하고 keep does not apply the following ohms to R3', () => {
  const spec = seriesSpec('1k');
  const prompt = 'R4는 그대로 두거나 하고 680Ω으로 바꿔줘';
  const before = structuredClone(spec);
  const decision = classifyExistingProjectRequest(prompt, spec);
  assert.equal(decision.mode, 'refuse', decision.code ?? '');
  assert.equal(decision.code, 'RESISTOR_AMBIGUOUS');
  assert.equal(decision.message, resistorAmbiguousMessage());
  assert.equal(decision.edit, undefined);
  assert.equal(blocksBeforeProvider(prompt, decision), true);
  assert.equal(appliesBeforeProvider(prompt, decision), false);
  assert.equal(componentValue(spec, 'R3'), '1k');
  assert.equal(componentValue(spec, 'R4'), '4.7k');
  assert.deepEqual(spec, before);
});

// The hedgeHada negation guard keeps "하고" a clause break when -거나 is negated.
// Without that break, a bare following value asks which resistor.
test('negation before 거나 하고 leaves a bare second value as a plain refusal', () => {
  const spec = seriesSpec('1k');
  const prompt = '안 바꾸거나 하고 1k';
  const before = structuredClone(spec);
  const decision = classifyExistingProjectRequest(prompt, spec);
  assert.equal(decision.mode, 'refuse');
  assert.equal(decision.code, undefined);
  assert.equal(decision.message, undefined);
  assert.equal(decision.edit, undefined);
  assert.equal(blocksBeforeProvider(prompt, decision), false);
  assert.equal(appliesBeforeProvider(prompt, decision), false);
  assert.equal(componentValue(spec, 'R3'), '1k');
  assert.equal(componentValue(spec, 'R4'), '4.7k');
  assert.deepEqual(spec, before);
});

// A negated edit before -거나 is not the "~거나 하다" hedge. The matrix is the
// negation, the 하다 tail, and the board. R3 must stay put on every cell.
const NEGATED_EDIT_GEONA = [
  ['-지 않', 'LED 저항을 680Ω으로 바꾸지 않거나'],
  ['-지 말', 'LED 저항을 680Ω으로 바꾸지 말거나'],
  ['안 V', 'LED 저항 680Ω으로 안 바꾸거나'],
  ['-기 싫', 'LED 저항을 680Ω으로 바꾸기 싫거나'],
  ['-는 건 아니', 'LED 저항 680Ω으로 바꾸는 건 아니거나'],
  ['-시- space -지 않', 'LED 저항을 680Ω으로 바꿔 주시지 않거나'],
  ['-시- space -지 말', 'LED 저항을 680Ω으로 바꿔 주시지 말거나'],
  ['-시- space 안 V', 'LED 저항 680Ω으로 안 바꿔 주시거나'],
  ['-시- space -기 싫', 'LED 저항을 680Ω으로 바꿔 주시기 싫거나'],
  ['-시- space -는 건 아니', 'LED 저항 680Ω으로 바꿔 주시는 건 아니거나']
];
const NEGATED_EDIT_TAILS = ['해', '하면 돼', '해서'];

function negatedEditGeonaPrompts() {
  const rows = [];
  for (const [form, phrase] of NEGATED_EDIT_GEONA) {
    for (const tail of NEGATED_EDIT_TAILS) rows.push([form, tail, `${phrase} ${tail}`]);
  }
  return rows;
}

function negatedEditBoards() {
  return [
    ['base', seriesSpec('1k')],
    ['d1led', probeBoard('d1led')]
  ];
}

test('a negated edit verb before -거나 하- is a refusal and does not change R3', () => {
  const failures = [];
  const prompts = negatedEditGeonaPrompts();
  for (const [form, tail, prompt] of prompts) {
    for (const [board, spec] of negatedEditBoards()) {
      const before = structuredClone(spec);
      const decision = classifyExistingProjectRequest(prompt, spec);
      if (decision.mode !== 'refuse' || decision.edit != null || appliesBeforeProvider(prompt, decision)) {
        failures.push(`${board} ${form} ${tail} => ${decision.mode} ${decision.code ?? ''} ${decision.edit?.ref ?? ''}=${decision.edit?.label ?? ''}`);
      }
      if (!blocksBeforeProvider(prompt, decision)) failures.push(`${board} ${form} ${tail} reached provider`);
      if (componentValue(spec, 'R3') !== '1k' || JSON.stringify(spec) !== JSON.stringify(before)) {
        failures.push(`${board} ${form} ${tail} mutated`);
      }
      if (decision.edit) {
        const next = applyExistingProjectEdit(spec, decision.edit);
        if (componentValue(next, 'R3') !== '1k') failures.push(`${board} ${form} ${tail} applied ${componentValue(next, 'R3')}`);
      }
    }
  }
  assert.equal(prompts.length, NEGATED_EDIT_GEONA.length * NEGATED_EDIT_TAILS.length);
  assert.deepEqual(failures, []);
});

function rangesOverlapSpan(left, right) {
  return left[0] < right[1] && right[0] < left[1];
}

test('a -거나 hedge span does not cover a negated edit verb', () => {
  const failures = [];
  for (const [, , prompt] of negatedEditGeonaPrompts()) {
    const negations = editVerbNegationSpans(prompt);
    if (negations.length === 0) failures.push(`${prompt} has no edit-verb negation`);
    for (const hedge of geonaHedgeSpans(prompt)) {
      for (const negation of negations) {
        if (rangesOverlapSpan(hedge, negation)) failures.push(`${prompt} hedge covers edit negation`);
      }
    }
  }
  // A negated state is not a hedge either. Refusal is the accepted outcome.
  const states = [
    'LED가 밝지 않거나 하면 LED 저항을 680Ω으로 바꿔줘',
    'LED가 안 켜지거나 하면 LED 저항 680Ω으로'
  ];
  const stateSpec = seriesSpec('1k');
  for (const prompt of states) {
    if (geonaHedgeSpans(prompt).length !== 0) failures.push(`${prompt} negated state still a hedge`);
    const before = structuredClone(stateSpec);
    const decision = classifyExistingProjectRequest(prompt, stateSpec);
    if (decision.mode === 'merge' || decision.edit != null) {
      failures.push(`${prompt} => ${decision.mode} ${decision.code ?? ''} ${decision.edit?.ref ?? ''}=${decision.edit?.label ?? ''}`);
    }
    if (componentValue(stateSpec, 'R3') !== '1k' || JSON.stringify(stateSpec) !== JSON.stringify(before)) {
      failures.push(`${prompt} mutated`);
    }
  }
  assert.deepEqual(failures, []);
});

// AF-1. Any negation marker before -거나 refuses the hedge. The matrix is the
// negated clause, the frame, and the board. R3 stays 1k on every cell.
const AF1_NEGATED_CLAUSES = [
  '바꾸진 않거나',
  '바꾸지않거나',
  '안바꾸거나',
  '못 바꾸거나',
  '바꿀 필요 없거나',
  '바꾸면 안 되거나',
  '바꾸지 마시거나',
  '바꾸지 않아도 되거나',
  '바꾸지 말았거나',
  '바꾸기는 싫거나',
  '교체하지 않거나',
  '고치지 않거나',
  '올리지 않거나',
  '낮추지 않거나',
  '놓지 않거나',
  '바꾸지 않지 않거나',
  '손대지 않거나'
];

// UAT pr28-r2. Full sentences, each over the same five boards. Refusal, no patch, R3 stays 1k.
const AF1_UAT_PR28_R2 = [
  ['196', 'LED 저항을 680Ω으로 못 바꾸거나 해'],
  ['197', 'LED 저항을 680Ω으로 못 바꾸거나 하면 돼요'],
  ['199', 'LED 저항을 680Ω으로 바꿔 주지 않으시거나 하면 좋겠어요'],
  ['201', 'LED 저항을 680Ω으로 바꾸지 마시거나 해 주세요']
];

function af1NegatedPrompt(clause, frame) {
  if (frame === 'tail') return `LED 저항을 680Ω으로 ${clause} 해`;
  return `LED 저항은 ${clause} 하면 680Ω으로`;
}

function af1NegatedBoards() {
  return [
    ['base', seriesSpec('1k')],
    ['d1led', probeBoard('d1led')],
    ['d2status', probeBoard('d2status')],
    ['multiled', probeBoard('multiled')],
    ['d1schottky', probeBoard('d1schottky')]
  ];
}

test('a negation marker before -거나 does not change R3', () => {
  const failures = [];
  const frames = ['tail', 'front'];
  for (const clause of AF1_NEGATED_CLAUSES) {
    for (const frame of frames) {
      const prompt = af1NegatedPrompt(clause, frame);
      for (const [board, spec] of af1NegatedBoards()) {
        const before = structuredClone(spec);
        const decision = classifyExistingProjectRequest(prompt, spec);
        const mergedR3 = decision.mode === 'merge' && decision.edit?.ref === 'R3';
        if (mergedR3 || decision.edit?.ohms === 680) {
          failures.push(`${board} ${frame} ${clause} => ${decision.mode} ${decision.code ?? ''} ${decision.edit?.ref ?? ''}=${decision.edit?.label ?? ''}`);
        }
        if (componentValue(spec, 'R3') !== '1k' || JSON.stringify(spec) !== JSON.stringify(before)) {
          failures.push(`${board} ${frame} ${clause} mutated`);
        }
        if (decision.edit) {
          const next = applyExistingProjectEdit(spec, decision.edit);
          if (componentValue(next, 'R3') !== '1k') failures.push(`${board} ${frame} ${clause} applied ${componentValue(next, 'R3')}`);
        }
      }
    }
  }
  for (const [id, prompt] of AF1_UAT_PR28_R2) {
    for (const [board, spec] of af1NegatedBoards()) {
      const before = structuredClone(spec);
      const decision = classifyExistingProjectRequest(prompt, spec);
      if (decision.mode !== 'refuse' || decision.mode === 'merge' || decision.edit != null) {
        failures.push(`${board} ${id} => ${decision.mode} ${decision.code ?? ''} ${decision.edit?.ref ?? ''}=${decision.edit?.label ?? ''}`);
      }
      if (componentValue(spec, 'R3') !== '1k' || JSON.stringify(spec) !== JSON.stringify(before)) {
        failures.push(`${board} ${id} mutated`);
      }
    }
  }
  assert.equal(AF1_NEGATED_CLAUSES.length, 17);
  assert.equal(AF1_UAT_PR28_R2.length, 4);
  assert.deepEqual(failures, []);
});

// Negation marker × verb × spacing. geonaHedgeSpans must not cover the clause.
const AF1_NEGATION_VERBS = ['바꾸', '교체하', '고치', '올리', '낮추', '두', '놓', '손대', '맞추', '편집하'];
const AF1_NEGATION_MARKERS = [
  ['않', (verb, spaced) => (spaced ? `${verb}지 않거나` : `${verb}지않거나`)],
  ['않으시', (verb, spaced) => (spaced ? `${verb}지 않으시거나` : `${verb}지않으시거나`)],
  ['말', (verb, spaced) => (spaced ? `${verb}지 말거나` : `${verb}지말거나`)],
  ['마시', (verb, spaced) => (spaced ? `${verb}지 마시거나` : `${verb}지마시거나`)],
  ['못', (verb, spaced) => (spaced ? `못 ${verb}거나` : `못${verb}거나`)],
  ['안', (verb, spaced) => (spaced ? `안 ${verb}거나` : `안${verb}거나`)],
  ['없', (verb, spaced) => (spaced ? `${verb} 필요 없거나` : `${verb}필요없거나`)],
  ['싫', (verb, spaced) => (spaced ? `${verb}기 싫거나` : `${verb}기싫거나`)],
  ['아니', (verb, spaced) => (spaced ? `${verb}는 건 아니거나` : `${verb}는건아니거나`)],
  ['안되', (verb, spaced) => (spaced ? `${verb}면 안 되거나` : `${verb}면안되거나`)]
];

// r50 AG-1. The 11 refusal shapes, as the 13 q.rows sentences. R3 stays 1k.
const LEXICAL_REFUSAL_GEONA = [
  'LED 저항을 680Ω으로 바꾸는 건 금지거나 해',
  'LED 저항을 680Ω으로 바꾸기 금지하거나 해',
  'LED 저항을 680Ω으로 바꾸길 거부하거나 해',
  'LED 저항을 680Ω으로 바꾸는 거 취소하거나 해',
  'LED 저항을 680Ω으로 바꾸는 거 보류하거나 해',
  'LED 저항을 680Ω으로 바꾸는 거 멈추거나 해',
  'LED 저항을 680Ω으로 바꾸는 건 관두거나 해',
  'LED 저항을 680Ω으로 바꾸라는 건 관두거나 해',
  'LED 저항을 680Ω으로 바꾸는 건 그만두거나 해',
  'LED 저항을 680Ω으로 바꾸는 건 그만하거나 해',
  'LED 저항 680Ω 노노 하거나 해',
  'LED 저항 680Ω으로 노노거나 해',
  'LED 저항 680Ω으로 바꾸기 ㄴㄴ거나 해'
];

test('a lexical refusal before -거나 does not change R3', () => {
  const failures = [];
  for (const prompt of LEXICAL_REFUSAL_GEONA) {
    for (const [board, spec] of af1NegatedBoards()) {
      const before = structuredClone(spec);
      const decision = classifyExistingProjectRequest(prompt, spec);
      if (decision.mode === 'merge' || decision.edit != null) {
        failures.push(`${board} ${prompt} => ${decision.mode} ${decision.code ?? ''} ${decision.edit?.ref ?? ''}=${decision.edit?.label ?? ''}`);
      }
      if (componentValue(spec, 'R3') !== '1k' || JSON.stringify(spec) !== JSON.stringify(before)) {
        failures.push(`${board} ${prompt} mutated`);
      }
    }
  }
  assert.equal(LEXICAL_REFUSAL_GEONA.length, 13);
  assert.deepEqual(failures, []);
});

// Outside the allowlist, or a negation of an allowed stem, -거나 is not a hedge.
const OUTSIDE_HEDGE_PREDICATES = [
  '금지', '금지하', '거부', '거부하', '취소', '취소하', '보류', '보류하',
  '멈추', '관두', '그만두', '그만', '그만하', '노노', 'ㄴㄴ',
  '없애', '없애주', '없애주시', '먹', '울', '걷', '빌드하'
];

// Negation that sits after an otherwise allowed -거나. The marker is not on the stem.
const POST_GEONA_NEGATION_STEMS = ['바꾸', '변경', '수정', '설정', '맞추', '밝', '어둡'];
const POST_GEONA_NEGATION_TAILS = [
  '하지 마',
  '하지는 마',
  '하지 말아',
  '하면 안 돼',
  '하면 안돼',
  '하진 않아',
  '하지마',
  '하지 마세요'
];

// A spaced 거나 whose previous word is not an edit stem or an LED-state stem.
const SPACED_GEONA_BLOCKED_WORDS = [
  '노노', '금지', '취소', 'ㄴㄴ', '거부', '보류', '멈추', '먹', '울', '걷'
];

// AJ-1. 버리/놓/두, then any particle, then a negated -거나 stem. 질 is the
// ㄹ contraction of 지를. 곤 is -고는, so it does not follow 지. The particle
// is not what decides the hedge.
const AJ1_AUXILIARIES = ['버리', '놓', '두'];
const AJ1_PARTICLE_AXIS = [
  ['를', (aux) => `${aux}지를`],
  ['ㄹ', (aux) => `${aux}질`],
  ['까지', (aux) => `${aux}지까지`],
  ['조차', (aux) => `${aux}지조차`],
  ['들', (aux) => `${aux}지들`],
  ['곤', (aux) => `${aux}곤`],
  ['도', (aux) => `${aux}지도`],
  ['는', (aux) => `${aux}지는`],
  ['만', (aux) => `${aux}지만`],
  ['요', (aux) => `${aux}지요`]
];
const AJ1_NEGATED_GEONA_STEMS = ['말거나', '않거나', '못하거나', '없거나', '마시거나', '않으시거나'];

function outsideHedgePrompts() {
  const prompts = [];
  for (const pred of OUTSIDE_HEDGE_PREDICATES) {
    prompts.push(`LED 저항을 680Ω으로 바꾸는 거 ${pred}거나 해`);
    prompts.push(`LED 저항을 680Ω으로 ${pred}거나 해`);
  }
  prompts.push('LED 저항을 680Ω으로 바꾸는 거 노노 하거나 해');
  prompts.push('LED 저항 680Ω으로 바꿔서 깜빡임 없애주시거나 하면 좋겠어요');
  for (const verb of AF1_NEGATION_VERBS) {
    for (const [, build] of AF1_NEGATION_MARKERS) {
      for (const spaced of [true, false]) prompts.push(`LED 저항을 680Ω으로 ${build(verb, spaced)} 해`);
    }
  }
  for (const stem of POST_GEONA_NEGATION_STEMS) {
    for (const tail of POST_GEONA_NEGATION_TAILS) prompts.push(`LED 저항 680Ω으로 ${stem}거나 ${tail}`);
  }
  for (const word of SPACED_GEONA_BLOCKED_WORDS) {
    prompts.push(`LED 저항 680Ω으로 ${word} 거나 해`);
    prompts.push(`LED 저항을 680Ω으로 바꾸는 거 ${word} 거나 하면`);
  }
  for (const aux of AJ1_AUXILIARIES) {
    for (const [, form] of AJ1_PARTICLE_AXIS) {
      for (const stem of AJ1_NEGATED_GEONA_STEMS) {
        prompts.push(`LED 저항을 680Ω으로 바꿔 ${form(aux)} ${stem} 해`);
      }
    }
  }
  return prompts;
}

test('property: outside the allowed hedge shapes, refuse', () => {
  const failures = [];
  const prompts = outsideHedgePrompts();
  const spec = seriesSpec('1k');
  for (const prompt of prompts) {
    if (geonaHedgeSpans(prompt).length !== 0) failures.push(`hedge ${prompt}`);
    const before = structuredClone(spec);
    const decision = classifyExistingProjectRequest(prompt, spec);
    if (decision.mode === 'merge' || (decision.edit?.ref === 'R3' && decision.edit?.ohms === 680)) {
      failures.push(`merge ${prompt} => ${decision.mode} ${decision.code ?? ''} ${decision.edit?.ref ?? ''}=${decision.edit?.label ?? ''}`);
    }
    if (componentValue(spec, 'R3') !== '1k' || JSON.stringify(spec) !== JSON.stringify(before)) {
      failures.push(`mutated ${prompt}`);
    }
    if (decision.edit) {
      const next = applyExistingProjectEdit(structuredClone(spec), decision.edit);
      if (componentValue(next, 'R3') !== '1k') failures.push(`applied ${prompt}`);
    }
  }
  const outsideCount = OUTSIDE_HEDGE_PREDICATES.length * 2
    + 2
    + AF1_NEGATION_VERBS.length * AF1_NEGATION_MARKERS.length * 2
    + POST_GEONA_NEGATION_STEMS.length * POST_GEONA_NEGATION_TAILS.length
    + SPACED_GEONA_BLOCKED_WORDS.length * 2
    + AJ1_AUXILIARIES.length * AJ1_PARTICLE_AXIS.length * AJ1_NEGATED_GEONA_STEMS.length;
  assert.equal(prompts.length, outsideCount);
  assert.deepEqual(AJ1_PARTICLE_AXIS.map(([particle]) => particle), ['를', 'ㄹ', '까지', '조차', '들', '곤', '도', '는', '만', '요']);
  assert.deepEqual(failures, []);
});

// AH-1. Negation after an allowed -거나, a negated auxiliary 버리/놓/두, and a
// spaced 거나 after 노노/금지/취소. Five boards. R3 stays 1k. Not a merge.
const AH1_GEONA_REFUSALS = [
  'LED 저항 680Ω으로 바꾸거나 하지 마',
  'LED 저항 680Ω으로 바꾸거나 하지 마.',
  'LED 저항 680Ω으로 변경하거나 하지 마',
  'LED 저항 680Ω으로 수정하거나 하지 마',
  'LED 저항 680Ω으로 바꾸거나 하지는 마',
  'LED 저항을 680Ω으로 바꿔 버리지 말거나 해',
  'LED 저항 680Ω으로 노노 거나 해',
  'LED 저항 680Ω으로 금지 거나 해',
  'LED 저항 680Ω으로 취소 거나 해'
];

test('a negation after -거나 or a spaced 거나 after a non-edit word does not change R3', () => {
  const failures = [];
  for (const prompt of AH1_GEONA_REFUSALS) {
    for (const [board, spec] of af1NegatedBoards()) {
      const before = structuredClone(spec);
      const decision = classifyExistingProjectRequest(prompt, spec);
      if (decision.mode === 'merge' || decision.edit != null) {
        failures.push(`${board} ${prompt} => ${decision.mode} ${decision.code ?? ''} ${decision.edit?.ref ?? ''}=${decision.edit?.label ?? ''}`);
      }
      if (componentValue(spec, 'R3') !== '1k' || JSON.stringify(spec) !== JSON.stringify(before)) {
        failures.push(`${board} ${prompt} mutated`);
      }
      if (decision.edit) {
        const next = applyExistingProjectEdit(spec, decision.edit);
        if (componentValue(next, 'R3') !== '1k') failures.push(`${board} ${prompt} applied ${componentValue(next, 'R3')}`);
      }
    }
  }
  assert.equal(AH1_GEONA_REFUSALS.length, 9);
  assert.deepEqual(failures, []);
});

// BT r52 AI-1. 진/지는/지도 on a negated auxiliary, including the glued form.
// Five boards. R3 stays 1k. Not a merge.
const AI1_NEGATED_AUXILIARY = [
  'LED 저항을 680Ω으로 바꿔 버리진 말거나 해',
  'LED 저항을 680Ω으로 바꿔 버리지는 말거나 해',
  'LED 저항을 680Ω으로 바꿔 버리지도 말거나 해',
  'LED 저항을 680Ω으로 바꿔버리진 말거나 해'
];

test('BT r52 AI-1: particle on a negated auxiliary does not change R3', () => {
  const failures = [];
  for (const prompt of AI1_NEGATED_AUXILIARY) {
    for (const [board, spec] of af1NegatedBoards()) {
      const before = structuredClone(spec);
      const decision = classifyExistingProjectRequest(prompt, spec);
      if (decision.mode === 'merge' || decision.edit != null) {
        failures.push(`${board} ${prompt} => ${decision.mode} ${decision.code ?? ''} ${decision.edit?.ref ?? ''}=${decision.edit?.label ?? ''}`);
      }
      if (componentValue(spec, 'R3') !== '1k' || JSON.stringify(spec) !== JSON.stringify(before)) {
        failures.push(`${board} ${prompt} mutated`);
      }
      if (decision.edit) {
        const next = applyExistingProjectEdit(spec, decision.edit);
        if (componentValue(next, 'R3') !== '1k') failures.push(`${board} ${prompt} applied ${componentValue(next, 'R3')}`);
      }
    }
  }
  assert.equal(AI1_NEGATED_AUXILIARY.length, 4);
  assert.deepEqual(failures, []);
});

// BT r53 AJ-1. Any particle before a negated -거나. The stem on -거나 is the
// negation, so the particle is not a hedge. Five boards. R3 stays 1k. Not a merge.
const AJ1_NEGATED_PARTICLE = [
  'LED 저항을 680Ω으로 바꿔 버리지를 말거나 해',
  'LED 저항을 680Ω으로 바꿔 버리질 말거나 해',
  'LED 저항을 680Ω으로 바꿔 버리지까지 말거나 해',
  'LED 저항을 680Ω으로 바꿔 버리지조차 말거나 해',
  'LED 저항을 680Ω으로 바꿔 버리지들 말거나 해',
  'LED 저항을 680Ω으로 바꿔 버리곤 말거나 해'
];

test('BT r53 AJ-1: any particle before a negated -거나 does not change R3', () => {
  const failures = [];
  for (const prompt of AJ1_NEGATED_PARTICLE) {
    for (const [board, spec] of af1NegatedBoards()) {
      const before = structuredClone(spec);
      const decision = classifyExistingProjectRequest(prompt, spec);
      if (decision.mode === 'merge' || decision.edit != null) {
        failures.push(`${board} ${prompt} => ${decision.mode} ${decision.code ?? ''} ${decision.edit?.ref ?? ''}=${decision.edit?.label ?? ''}`);
      }
      if (componentValue(spec, 'R3') !== '1k' || JSON.stringify(spec) !== JSON.stringify(before)) {
        failures.push(`${board} ${prompt} mutated`);
      }
      if (decision.edit) {
        const next = applyExistingProjectEdit(spec, decision.edit);
        if (componentValue(next, 'R3') !== '1k') failures.push(`${board} ${prompt} applied ${componentValue(next, 'R3')}`);
      }
    }
  }
  assert.equal(AJ1_NEGATED_PARTICLE.length, 6);
  assert.deepEqual(failures, []);
});

// BT r54 AK-1. A negation anywhere in the candidate hedge span (clause start
// through the -거나 하- form) is not a hedge. The auxiliary 버리 sits on -거나,
// and the marker is on an earlier word. Five boards. R3 stays 1k. Not a merge.
const AK1_NEGATED_HEDGE = [
  'LED 저항을 680Ω으로 바꾸지 말아 버리거나 해',
  'LED 저항을 680Ω으로 바꾸지 말아 버리시거나 하면',
  'LED 저항을 680Ω으로 바꾸지 말아 둬 버리거나 해',
  'LED 저항을 680Ω으로 안 바꿔 버리거나 해'
];

test('BT r54 AK-1: a negation anywhere in the hedge span does not change R3', () => {
  const failures = [];
  for (const prompt of AK1_NEGATED_HEDGE) {
    for (const [board, spec] of af1NegatedBoards()) {
      const before = structuredClone(spec);
      const decision = classifyExistingProjectRequest(prompt, spec);
      if (decision.mode === 'merge' || decision.edit != null) {
        failures.push(`${board} ${prompt} => ${decision.mode} ${decision.code ?? ''} ${decision.edit?.ref ?? ''}=${decision.edit?.label ?? ''}`);
      }
      if (componentValue(spec, 'R3') !== '1k' || JSON.stringify(spec) !== JSON.stringify(before)) {
        failures.push(`${board} ${prompt} mutated`);
      }
      if (decision.edit) {
        const next = applyExistingProjectEdit(spec, decision.edit);
        if (componentValue(next, 'R3') !== '1k') failures.push(`${board} ${prompt} applied ${componentValue(next, 'R3')}`);
      }
    }
  }
  assert.equal(AK1_NEGATED_HEDGE.length, 4);
  assert.deepEqual(failures, []);
});

// UAT 093-096/190/191 and Q1/Q3/Q4. Each one applies R3 today. A negation
// marker at a word boundary inside the hedge span must not.
const AK1_APPLYING_HEDGES = [
  'LED 저항이 너무 밝거나 해서 680Ω으로 바꿔줘',
  '밝기가 거슬리거나 하니 LED 저항 680Ω으로',
  'LED 저항 680Ω으로 바꿔주시거나 하면 좋겠어요',
  '거나한 건 아니고 LED 저항 680Ω으로 바꿔줘',
  '밝기가 약하거나 해서 LED 저항 680Ω으로 바꿔줘',
  'LED 저항 680Ω으로 바꿔 주시거나 하면 감사하겠어요',
  'LED 저항 680Ω으로 바꾸거나 한다면 좋겠어요',
  'R4는 그대로 두거나 하고 LED 저항 680Ω으로',
  '거나하게 LED 저항 680Ω으로 바꿔줘',
  'LED 저항을 거나하게 680Ω으로'
];

// The same markers clauseHasNegationMarker and the 없 stem already use.
const AK1_SPAN_MARKERS = ['말', '않', '못', '안', '없', '지 마', '싫', '아니', '안되'];

const AK1_HADA_FORMS = new Set([
  '해', '해서', '하여', '하고', '하면', '하니', '하다', '하지', '하는', '할', '한', '함',
  '해야', '해도', '해라', '했다', '했어', '했네', '했으면', '했다면', '하여서', '하니까',
  '하니깐', '하지만', '하며', '하자', '할게', '합니다', '하죠', '한다면'
]);

function ak1Bare(word) {
  let text = String(word ?? '').replace(/^[("'`]+|[)"'`.;!?。！？,]+$/gu, '');
  if (text.endsWith('요') && text.length > 1) text = text.slice(0, -1);
  return text;
}

function ak1IsHada(word) {
  const text = ak1Bare(word);
  if (AK1_HADA_FORMS.has(text)) return true;
  return text.length > 2 && /[은는도]$/u.test(text) && AK1_HADA_FORMS.has(text.slice(0, -1));
}

function ak1ClauseStart(text, index) {
  const boundary = /\s(?:and then|and|&|then)\s|바꾸고|그리고|하면서|하고|이고|이랑|면서|지만|말고|(?<=[가-힣])고(?!\s*나서)(?!거나)|[,，.;!?？！。\n•·]/giu;
  let start = 0;
  for (const match of text.matchAll(boundary)) {
    const at = match.index ?? 0;
    if (at >= index) break;
    const end = at + match[0].length;
    if (end > index) continue;
    const mark = match[0];
    if ((mark === ',' || mark === '.' || mark === '，') && /\d/u.test(text[at - 1] ?? '') && /\d/u.test(text[at + 1] ?? '')) continue;
    start = end;
  }
  return start;
}

// Clause start through the -거나 하- form, or through a word-initial 거나하다.
function ak1HedgeSpan(text) {
  const tokens = [...text.matchAll(/\S+/gu)].map((match) => ({
    raw: match[0],
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length
  }));
  for (let index = 0; index < tokens.length; index += 1) {
    const bare = ak1Bare(tokens[index].raw);
    if (/^거나(?:하게|한|해서|하면|하고|하니|하다|하지|하는|할|함|해)$/u.test(bare)) {
      return { from: ak1ClauseStart(text, tokens[index].start), to: tokens[index].end };
    }
    if (!bare.endsWith('거나')) continue;
    const next = tokens[index + 1];
    if (!next || !ak1IsHada(next.raw)) continue;
    return { from: ak1ClauseStart(text, tokens[index].start), to: next.end };
  }
  return null;
}

function ak1Insertions(text) {
  const span = ak1HedgeSpan(text);
  if (!span) return [];
  const prompts = [];
  for (const match of text.matchAll(/\S+/gu)) {
    const at = match.index ?? 0;
    if (at < span.from || at >= span.to) continue;
    for (const marker of AK1_SPAN_MARKERS) {
      const gap = at > 0 && text[at - 1] !== ' ' ? ' ' : '';
      prompts.push(`${text.slice(0, at)}${gap}${marker} ${text.slice(at)}`.replace(/ {2,}/gu, ' '));
    }
  }
  return prompts;
}

test('property: inserting a negation marker anywhere in a hedge sentence never changes R3', () => {
  const failures = [];
  const spec = seriesSpec('1k');
  let checked = 0;
  for (const base of AK1_APPLYING_HEDGES) {
    const prompts = ak1Insertions(base);
    if (prompts.length === 0) failures.push(`no span ${base}`);
    for (const prompt of prompts) {
      checked += 1;
      const before = structuredClone(spec);
      const decision = classifyExistingProjectRequest(prompt, spec);
      if (decision.mode === 'merge' && decision.edit?.ohms === 680) {
        failures.push(`merge ${prompt}`);
      }
      if (componentValue(spec, 'R3') !== '1k' || JSON.stringify(spec) !== JSON.stringify(before)) {
        failures.push(`mutated ${prompt}`);
      }
      if (decision.edit) {
        const next = applyExistingProjectEdit(structuredClone(spec), decision.edit);
        if (componentValue(next, 'R3') === '680Ω') failures.push(`applied ${prompt}`);
      }
    }
  }
  assert.equal(AK1_APPLYING_HEDGES.length, 10);
  assert.equal(AK1_SPAN_MARKERS.length, 9);
  assert.ok(checked > AK1_APPLYING_HEDGES.length * AK1_SPAN_MARKERS.length);
  assert.deepEqual(failures.slice(0, 12), [], `negation insertions ${failures.length}`);
});

// The hedge guard reads the whole sentence. A negation marker before -거나,
// after -거나, or on 버리/놓/두 means no hedge span. The 거나하다 "건 아니고"
// closer is not a marker, so that hedge stays.
function wholeSentenceNegationPrompts() {
  const prompts = [];
  const stems = ['바꾸', '변경', '수정', '밝', '어둡'];
  const tails = ['하지 마', '하지는 마', '하지 말아', '하면 안 돼', '하진 않아', '하지마', '하지 마세요'];
  for (const stem of stems) {
    for (const tail of tails) prompts.push(`LED 저항 680Ω으로 ${stem}거나 ${tail}`);
    prompts.push(`LED 저항을 680Ω으로 ${stem}지 않거나 해`);
    prompts.push(`LED 저항 680Ω으로 ${stem}거나 하면 좋지만 하지 마`);
  }
  prompts.push('LED 저항을 680Ω으로 바꿔 버리지 말거나 해');
  prompts.push('LED 저항을 680Ω으로 바꿔 놓지 말거나 해');
  prompts.push('LED 저항을 680Ω으로 바꿔 두지 말거나 해');
  prompts.push('LED 저항을 680Ω으로 바꿔 버리지 않거나 해');
  prompts.push('LED 저항을 680Ω으로 바꿔 놓지 않거나 해');
  prompts.push('LED 저항을 680Ω으로 바꿔 두지 않거나 해');
  return prompts;
}

test('a negation marker anywhere in the sentence, including after -거나, leaves no hedge span', () => {
  const failures = [];
  const prompts = wholeSentenceNegationPrompts();
  for (const prompt of prompts) {
    if (geonaHedgeSpans(prompt).length !== 0) failures.push(`hedge ${prompt}`);
  }
  const stillHedge = [
    'LED 저항 680Ω으로 바꾸거나 하면 좋겠어요',
    '거나 한 건 아니고 LED 저항 680Ω으로 바꿔줘',
    'LED 저항이 너무 밝거나 해서 680Ω으로 바꿔줘'
  ];
  for (const prompt of stillHedge) {
    if (geonaHedgeSpans(prompt).length === 0) failures.push(`missing hedge ${prompt}`);
  }
  assert.ok(prompts.length > AH1_GEONA_REFUSALS.length);
  assert.deepEqual(failures, []);
});

test('property: a choice joiner on a valued keep is RESISTOR_AMBIGUOUS and a control joiner applies R3', () => {
  const spec = seriesSpec('1k');
  const seed = propertySeed();
  const rng = mulberry32(seed);
  const orders = ['edit-first', 'keep-first'];
  const ambiguous = [];
  const applies = [];
  for (const joiner of CHOICE_KEEP_JOINERS) {
    for (const keep of VALUED_KEEP_CLAUSES) {
      for (const order of orders) ambiguous.push(valuedKeepJoinerSentence(joiner, keep, order));
    }
    for (const kind of CHOICE_KEEP_KINDS) {
      for (const order of orders) ambiguous.push(choiceKeepKindSentence(joiner, kind, order));
    }
  }
  for (const joiner of CONTROL_KEEP_JOINERS) {
    for (const keep of VALUED_KEEP_CLAUSES) {
      for (const order of orders) applies.push(valuedKeepJoinerSentence(joiner, keep, order));
    }
  }
  shuffleItems(rng, ambiguous);
  shuffleItems(rng, applies);
  const failures = [];
  const r3 = componentValue(spec, 'R3');
  for (const prompt of ambiguous) {
    const before = structuredClone(spec);
    const decision = classifyExistingProjectRequest(prompt, spec);
    if (decision.mode !== 'refuse' || decision.code !== 'RESISTOR_AMBIGUOUS' || decision.edit != null) {
      failures.push(`${prompt} => ${decision.mode} ${decision.code ?? ''} ${decision.edit?.ref ?? ''} ${decision.edit?.ohms ?? ''}`);
    }
    if (componentValue(spec, 'R3') !== r3 || JSON.stringify(spec) !== JSON.stringify(before)) {
      failures.push(`${prompt} mutated`);
    }
    if (decision.edit) {
      const next = applyExistingProjectEdit(spec, decision.edit);
      if (componentValue(next, 'R3') !== r3) failures.push(`${prompt} R3 ${componentValue(next, 'R3')}`);
    }
  }
  for (const prompt of applies) {
    const before = structuredClone(spec);
    const decision = classifyExistingProjectRequest(prompt, spec);
    if (decision.mode !== 'merge' || decision.edit?.ref !== 'R3' || decision.edit?.ohms !== 680 || decision.edit?.label !== '680Ω') {
      failures.push(`${prompt} => ${decision.mode} ${decision.code ?? ''} ${decision.edit?.ref ?? ''} ${decision.edit?.ohms ?? ''} ${decision.edit?.label ?? ''}`);
    }
    if (componentValue(spec, 'R3') !== r3 || JSON.stringify(spec) !== JSON.stringify(before)) {
      failures.push(`${prompt} mutated`);
    }
    if (decision.edit) {
      const next = applyExistingProjectEdit(spec, decision.edit);
      if (componentValue(next, 'R3') !== '680Ω') failures.push(`${prompt} applied ${componentValue(next, 'R3')}`);
      if (componentValue(next, 'R4') !== '4.7k') failures.push(`${prompt} R4 ${componentValue(next, 'R4')}`);
    }
  }
  assert.equal(ambiguous.length, CHOICE_KEEP_JOINERS.length * (VALUED_KEEP_CLAUSES.length + CHOICE_KEEP_KINDS.length) * orders.length);
  assert.equal(applies.length, CONTROL_KEEP_JOINERS.length * VALUED_KEEP_CLAUSES.length * orders.length);
  if (failures.length > 0) console.log(`choice joiner property seed ${seed}`);
  assert.deepEqual(failures.slice(0, 12), [], `choice joiner property seed ${seed}`);
});

// Keep-list nouns joined by or/또는/혹은. The edit sits in another clause.
// list target × joiner × keep cue × position. Each one applies R3=680Ω.
const KEEP_LIST_PAIRS = [
  { lang: 'en', joiner: 'or', pair: 'R4 or R5' },
  { lang: 'en', joiner: 'or', pair: 'R1 or the pull-ups' },
  { lang: 'ko', joiner: '또는', pair: 'R4 또는 R5' },
  { lang: 'ko', joiner: '혹은', pair: 'R4 혹은 R5' }
];

const KEEP_LIST_CUES = {
  en: ['keep', "don't touch"],
  ko: ['그대로 두고', '건드리지 말고']
};

function keepListSentence(pair, cue, position, link) {
  if (pair.lang === 'en') {
    const kept = `${cue} ${pair.pair}`;
    const edit = 'set the LED resistor to 680Ω';
    if (position === 'keep-first') return link === 'and' ? `${kept} and ${edit}` : `${kept} ${edit}`;
    return link === 'and' ? `${edit} and ${kept}` : `${edit} ${kept}`;
  }
  const edit = 'LED 저항 680Ω으로';
  if (position === 'keep-first') return `${pair.pair}는 ${cue} ${edit}`;
  const tail = cue.startsWith('건드리지') ? '건드리지 마' : '그대로';
  return `${edit} 바꾸고 ${pair.pair}는 ${tail}`;
}

test('property: or/또는/혹은 between keep-list targets applies R3 and a real choice stays RESISTOR_AMBIGUOUS', () => {
  const spec = seriesSpec('1k');
  const applies = [];
  for (const pair of KEEP_LIST_PAIRS) {
    const cues = KEEP_LIST_CUES[pair.lang];
    const links = pair.lang === 'en' ? ['and', 'space'] : ['고'];
    for (const cue of cues) {
      for (const position of ['keep-first', 'edit-first']) {
        for (const link of links) applies.push(keepListSentence(pair, cue, position, link));
      }
    }
  }
  const ambiguous = [
    'LED 저항 680Ω으로 바꾸든 R4는 4.7k로 유지',
    'LED 저항 680Ω으로 바꾸든 말든 R4는 4.7k로 유지',
    'LED 저항 680Ω으로 하든 R4는 4.7k 그대로',
    'LED 저항 680Ω으로 바꾸거나요 R4는 4.7k로 유지',
    'LED 저항 680Ω으로 바꾸든지요 R4는 4.7k로 유지',
    'LED 저항 680Ω으로 바꾸거나도 R4는 4.7k로 유지',
    'LED 저항 680Ω으로 바꾸든가나 R4는 4.7k로 유지',
    'LED 저항 680Ω으로 바꾸거나요, R4는 4.7k로 유지',
    'set the LED resistor to 680Ω or keep R4',
    'set the LED resistor to 680Ω or leave R4 alone',
    'LED 저항 680Ω으로 바꾸거나 R4는 그대로 둬',
    'LED 저항 680Ω으로 바꾸든 R4는 건드리지 마',
    'keep R4 or R3 and set the LED resistor to 680Ω',
    'keep R4 or the LED resistor and set the LED resistor to 680Ω',
    'set the LED resistor to 680Ω or keep the LED resistor',
    "don't touch R4 or the LED resistor and set the LED resistor to 680Ω"
  ];
  const failures = [];
  const r3 = componentValue(spec, 'R3');
  for (const prompt of applies) {
    const before = structuredClone(spec);
    const decision = classifyExistingProjectRequest(prompt, spec);
    if (decision.mode !== 'merge' || decision.edit?.ref !== 'R3' || decision.edit?.ohms !== 680 || decision.edit?.label !== '680Ω') {
      failures.push(`${prompt} => ${decision.mode} ${decision.code ?? ''} ${decision.edit?.ref ?? ''} ${decision.edit?.ohms ?? ''} ${decision.edit?.label ?? ''}`);
    }
    if (componentValue(spec, 'R3') !== r3 || JSON.stringify(spec) !== JSON.stringify(before)) failures.push(`${prompt} mutated`);
    if (decision.edit) {
      const next = applyExistingProjectEdit(spec, decision.edit);
      if (componentValue(next, 'R3') !== '680Ω') failures.push(`${prompt} applied ${componentValue(next, 'R3')}`);
      if (componentValue(next, 'R4') !== '4.7k') failures.push(`${prompt} R4 ${componentValue(next, 'R4')}`);
    }
  }
  for (const prompt of ambiguous) {
    const before = structuredClone(spec);
    const decision = classifyExistingProjectRequest(prompt, spec);
    if (decision.mode !== 'refuse' || decision.code !== 'RESISTOR_AMBIGUOUS' || decision.edit != null) {
      failures.push(`${prompt} => ${decision.mode} ${decision.code ?? ''} ${decision.edit?.ref ?? ''}`);
    }
    if (componentValue(spec, 'R3') !== r3 || JSON.stringify(spec) !== JSON.stringify(before)) failures.push(`${prompt} mutated`);
  }
  assert.equal(applies.length, 24);
  assert.deepEqual(failures.slice(0, 16), []);
});

// and / -고 / 말고 bound a keep list. They do not wall the ohms off from a
// later choice joiner, so "and rebuild or leave R4" stays a choice. A comma
// still ends that value. R4 or R5 on the joiner is a list and applies R3.
const VERB_BEFORE_CHOICE = [
  { id: 'and rebuild' },
  { id: '빌드하고' },
  { id: '-고 BOM도 고치' }
];

const VERB_CHOICE_JOINERS = [
  { id: 'or', text: 'or', place: 'word' },
  { id: '거나', text: '거나', place: 'ending' },
  { id: '든지', text: '든지', place: 'ending' },
  { id: '아니면', text: '아니면', place: 'word' }
];

const UNVALUED_CHOICE_KEEPS = [
  'leave R4 alone',
  'R4는 그대로 둬',
  'R4는 건드리지 마'
];

function verbBeforeChoiceSentence(middle, joiner, keep) {
  const ending = joiner.place === 'ending';
  if (middle.id === 'and rebuild') {
    const verb = ending ? `rebuild${joiner.text}` : `rebuild ${joiner.text}`;
    return `set the LED resistor to 680Ω and ${verb} ${keep}`;
  }
  if (middle.id === '빌드하고') {
    const verb = ending ? `빌드하${joiner.text}` : `빌드하고 ${joiner.text}`;
    return `LED 저항을 680Ω으로 바꾸고 ${verb} ${keep}`;
  }
  const verb = ending ? `고치${joiner.text}` : `고치고 ${joiner.text}`;
  return `LED 저항을 680Ω으로 바꾸고 BOM도 ${verb} ${keep}`;
}

test('property: a verb between the ohms and an unvalued choice keep is RESISTOR_AMBIGUOUS and a keep list applies R3', () => {
  const spec = seriesSpec('1k');
  const ambiguous = [];
  for (const middle of VERB_BEFORE_CHOICE) {
    for (const joiner of VERB_CHOICE_JOINERS) {
      for (const keep of UNVALUED_CHOICE_KEEPS) ambiguous.push(verbBeforeChoiceSentence(middle, joiner, keep));
    }
  }
  ambiguous.push('LED 저항을 680Ω으로 바꾸고 빌드하거나 아니면 R4는 4.7k로 유지');
  const applies = [
    'keep R4 or R5 and set the LED resistor to 680Ω',
    'R4 또는 R5는 그대로 두고 LED 저항 680Ω으로',
    'set the LED resistor to 680Ω and keep R4 or R5',
    'LED 저항을 680Ω으로 바꾸고 오든 말든 R4는 그대로 둬'
  ];
  const comma = 'set the LED resistor to 680Ω and rebuild, or leave R4 alone';
  const failures = [];
  const r3 = componentValue(spec, 'R3');
  for (const prompt of ambiguous) {
    const before = structuredClone(spec);
    const decision = classifyExistingProjectRequest(prompt, spec);
    if (decision.mode !== 'refuse' || decision.code !== 'RESISTOR_AMBIGUOUS' || decision.edit != null) {
      failures.push(`${prompt} => ${decision.mode} ${decision.code ?? ''} ${decision.edit?.ref ?? ''} ${decision.edit?.ohms ?? ''}`);
    }
    if (componentValue(spec, 'R3') !== r3 || JSON.stringify(spec) !== JSON.stringify(before)) {
      failures.push(`${prompt} mutated`);
    }
  }
  for (const prompt of applies) {
    const before = structuredClone(spec);
    const decision = classifyExistingProjectRequest(prompt, spec);
    if (decision.mode !== 'merge' || decision.edit?.ref !== 'R3' || decision.edit?.ohms !== 680 || decision.edit?.label !== '680Ω') {
      failures.push(`${prompt} => ${decision.mode} ${decision.code ?? ''} ${decision.edit?.ref ?? ''} ${decision.edit?.ohms ?? ''} ${decision.edit?.label ?? ''}`);
    }
    if (componentValue(spec, 'R3') !== r3 || JSON.stringify(spec) !== JSON.stringify(before)) failures.push(`${prompt} mutated`);
    if (decision.edit) {
      const next = applyExistingProjectEdit(spec, decision.edit);
      if (componentValue(next, 'R3') !== '680Ω') failures.push(`${prompt} applied ${componentValue(next, 'R3')}`);
      if (componentValue(next, 'R4') !== '4.7k') failures.push(`${prompt} R4 ${componentValue(next, 'R4')}`);
    }
  }
  const commaBefore = structuredClone(spec);
  const commaDecision = classifyExistingProjectRequest(comma, spec);
  if (commaDecision.code !== 'RESISTOR_TARGET_UNCLEAR' || commaDecision.edit != null) {
    failures.push(`${comma} => ${commaDecision.mode} ${commaDecision.code ?? ''} ${commaDecision.edit?.ref ?? ''}`);
  }
  if (componentValue(spec, 'R3') !== r3 || JSON.stringify(spec) !== JSON.stringify(commaBefore)) {
    failures.push(`${comma} mutated`);
  }
  assert.equal(ambiguous.length, VERB_BEFORE_CHOICE.length * VERB_CHOICE_JOINERS.length * UNVALUED_CHOICE_KEEPS.length + 1);
  assert.deepEqual(failures.slice(0, 12), []);
});

// X든/X든지/X거나 + 말든/말든지/말거나 is the idiom unless the verb is an edit
// verb, or 오다 follows an edit/do connective. A pair sitting on the resistor
// value is a choice for any verb; the next test pins that. Bare 하든 without
// 말든 stays a choice.
test('든-말든 is an idiom unless the verb is an edit verb or 오다 follows an edit connective', () => {
  const spec = seriesSpec('1k');
  const applies = [
    'LED 저항을 680Ω으로 바꾸고 오든 말든 R1은 그대로 둬',
    'LED 저항을 680Ω으로 바꾸고 오든말든 R1은 그대로 둬',
    'LED 저항을 680Ω으로 바꾸고 오든지 말든지 R1은 그대로 둬',
    'LED 저항을 680Ω으로 바꾸고 하든 말든 R1은 그대로 둠',
    'LED 저항을 680Ω으로 바꾸고 하든 말든 R1은 그대로 둬',
    'LED 저항을 680Ω으로 바꾸고 하든지 말든지 R1은 그대로 둬',
    'LED 저항을 680Ω으로 바꾸고 가든 말든 R1은 그대로 둬',
    'LED 저항을 680Ω으로 바꾸고 오거나 말거나 R1은 그대로 둬',
    'LED 저항을 680Ω으로 바꾸고 누가 오든 말든 R1은 그대로 둬',
    'LED 저항을 680Ω으로 바꾸고 오든 말든 R4는 그대로 둬',
    'LED 저항을 680Ω으로 바꾸고 오던 말던 R4는 그대로 둬'
  ];
  const ambiguous = [
    'LED 저항 680Ω으로 바꿔 오든 말든 R4는 그대로 둬',
    'LED 저항을 680Ω으로 바꿔 오든 말든 R1은 그대로 둬',
    'LED 저항 680Ω으로 해 오든 말든 R4는 그대로',
    'LED 저항을 680Ω으로 해 오든 말든 R1은 그대로 둬',
    'LED 저항 680Ω으로 맞춰 오든 말든 R4는 그대로 둬',
    'LED 저항을 680Ω으로 맞춰 오든 말든 R1은 그대로 둬',
    'LED 저항 680Ω으로 바꿔 오든 말든 R4는 4.7k로 유지',
    'LED 저항을 680Ω으로 바꾸든 말든 R1은 그대로 둬',
    'LED 저항 680Ω으로 바꾸든 말든 R4는 4.7k로 유지',
    'LED 저항 680Ω으로 바꾸든지 말든지 R4는 그대로 둬',
    'LED 저항 680Ω으로 바꾸거나 말거나 R4는 그대로 둬',
    'LED 저항 680Ω으로 변경하든 말든 R4는 그대로 둬',
    'LED 저항 680Ω으로 수정하든 말든 R4는 그대로 둬',
    'LED 저항 680Ω으로 설정하든 말든 R4는 그대로 둬',
    'LED 저항 680Ω으로 바꾸든 R4는 그대로 둬',
    'LED 저항 680Ω으로 하든 R4는 4.7k 그대로',
    'LED 저항 680Ω으로 하든 R4는 그대로 둬',
    'LED 저항 680Ω으로 오든말든 R4는 4.7k로 유지',
    'LED 저항을 680Ω으로 바꾸고 누가 오든 말든 R4는 4.7k로 유지'
  ];
  const failures = [];
  const r3 = componentValue(spec, 'R3');
  for (const prompt of applies) {
    const before = structuredClone(spec);
    const decision = classifyExistingProjectRequest(prompt, spec);
    if (decision.mode !== 'merge' || decision.edit?.ref !== 'R3' || decision.edit?.ohms !== 680 || decision.edit?.label !== '680Ω') {
      failures.push(`${prompt} => ${decision.mode} ${decision.code ?? ''} ${decision.edit?.ref ?? ''} ${decision.edit?.ohms ?? ''} ${decision.edit?.label ?? ''}`);
    }
    if (componentValue(spec, 'R3') !== r3 || JSON.stringify(spec) !== JSON.stringify(before)) failures.push(`${prompt} mutated`);
    if (decision.edit) {
      const next = applyExistingProjectEdit(spec, decision.edit);
      if (componentValue(next, 'R3') !== '680Ω') failures.push(`${prompt} applied ${componentValue(next, 'R3')}`);
      if (componentValue(next, 'R4') !== '4.7k') failures.push(`${prompt} R4 ${componentValue(next, 'R4')}`);
      if (componentValue(next, 'R1') !== '5.1k') failures.push(`${prompt} R1 ${componentValue(next, 'R1')}`);
    }
  }
  for (const prompt of ambiguous) {
    const before = structuredClone(spec);
    const decision = classifyExistingProjectRequest(prompt, spec);
    if (decision.mode !== 'refuse' || decision.code !== 'RESISTOR_AMBIGUOUS' || decision.edit != null) {
      failures.push(`${prompt} => ${decision.mode} ${decision.code ?? ''} ${decision.edit?.ref ?? ''}`);
    }
    if (componentValue(spec, 'R3') !== r3 || JSON.stringify(spec) !== JSON.stringify(before)) failures.push(`${prompt} mutated`);
  }
  for (const [id, partner] of [['deun', '말든'], ['deunji', '말든지'], ['geona', '말거나']]) {
    const row = CHOICE_JOINERS.find((item) => item.id === id);
    if (row?.idiomWith !== partner) failures.push(`${id} idiomWith ${row?.idiomWith ?? 'missing'}`);
  }
  assert.deepEqual(failures, []);
});

// 든/든지/거나 + 말든/말든지/말거나 right after value+(으)로, or earlier in the
// same clause as a target and a value, is a choice for any verb. A keep on
// either side is RESISTOR_AMBIGUOUS. After a clause break the pair stays the
// idiom and still applies R3. With no keep the sentence stays TARGET_UNCLEAR.
test('든-말든 after a resistor value is a choice and a keep on either side is RESISTOR_AMBIGUOUS', () => {
  const spec = seriesSpec('1k');
  const ambiguous = [
    'LED 저항을 680Ω으로 하든 말든 R4는 그대로 둬',
    'LED 저항 680Ω으로 하든 말든 R4는 그대로 둬',
    'LED 저항을 680Ω으로 하든지 말든지 R4는 그대로 둬',
    'LED 저항을 680Ω으로 하거나 말거나 R4는 그대로 둬',
    'LED 저항을 680Ω으로 해든 말든 R4는 그대로 둬',
    'LED 저항 680Ω 하든 말든 R4는 그대로 둬',
    'LED 저항을 680Ω으로 하든 말든 R4는 건드리지 마',
    'LED 저항을 680Ω으로 하든 말든 풀업은 그대로',
    'LED 저항을 680Ω으로 하든말든 R4는 그대로 둬',
    'LED 저항을 680Ω으로 하든요 말든요 R4는 그대로 둬',
    'LED 저항을 680Ω으로 변경하든 말든 R4는 그대로 둬',
    'LED 저항을 680Ω으로 해 가든 말든 R4는 그대로 둬',
    'LED 저항을 680Ω으로 오든 말든 R4는 그대로 둬',
    'LED 저항을 680Ω으로 가든 말든 R4는 그대로 둬',
    'R3를 680Ω으로 하든 말든 R4는 그대로 둬',
    'LED 저항을 680Ω으로 하든 말든 R4는 4.7k 그대로',
    'LED 저항을 680Ω으로 하든 말든 R4는 4.7k로 유지',
    'R4는 그대로 두고 LED 저항을 680Ω으로 하든 말든',
    'R1은 그대로 두고 LED 저항을 680Ω으로 하든 말든',
    'R1은 그대로 두고 LED 저항을 680Ω으로 바꾸든 말든',
    'R1은 그대로 두고 LED 저항을 680Ω으로 변경하든 말든',
    'R1은 그대로 두고 LED 저항을 680Ω으로 해 오든 말든',
    'R1은 그대로 두고 LED 저항을 680Ω으로 바꿔 오든 말든',
    'LED 저항을 680Ω으로 하든 말든 R1은 그대로 둠',
    'LED 저항을 680Ω으로 하든지 말든지 R1은 그대로 둠',
    'LED 저항을 680Ω으로 해든 말든 R1은 그대로 둠',
    'LED 저항을 680Ω으로 하거나 말거나 R1은 그대로 둠',
    'LED 저항 680Ω 하든 말든 R1은 그대로 둠',
    'LED 저항 680Ω으로 하든 말든 R1은 그대로 둬',
    'LED 저항을 680Ω으로 하든 말든 R1은 건드리지 마',
    'LED 저항을 680Ω으로 하든말든 R1은 그대로 둬',
    'LED 저항을 680Ω으로 하든요 말든요 R1은 그대로 둬',
    'LED 저항을 680Ω으로 변경하든 말든 R1은 그대로 둬',
    'R3를 680Ω으로 하든 말든 R1은 그대로 둬',
    'LED 저항을 680Ω으로 하든 말든 R1은 4.7k 그대로',
    'LED 저항을 680Ω으로 하든 말든 R1은 4.7k로 유지',
    'LED 저항을 680Ω으로 해 가든 말든 R1은 그대로 둬',
    'LED 저항을 680Ω으로 오든 말든 R1은 그대로 둠',
    'LED 저항을 680Ω으로 가든 말든 R1은 그대로 둠'
  ];
  const applies = [
    'LED 저항을 680Ω으로 바꾸고 하든 말든 R1은 그대로 둠',
    'LED 저항을 680Ω으로 바꾸고 오든말든 R1은 그대로 둬',
    'LED 저항을 680Ω으로 바꾸고 오든 말든 R1은 그대로 둬',
    'LED 저항을 680Ω으로 바꾸고 가든 말든 R1은 그대로 둬',
    'LED 저항을 680Ω으로 바꾸고 오거나 말거나 R1은 그대로 둬',
    'LED 저항을 680Ω으로 바꾸고 누가 오든 말든 R1은 그대로 둬',
    'LED 저항을 680Ω으로 바꾸고 오든 말든 R4는 그대로 둬'
  ];
  const failures = [];
  const r3 = componentValue(spec, 'R3');
  for (const prompt of ambiguous) {
    const before = structuredClone(spec);
    const decision = classifyExistingProjectRequest(prompt, spec);
    if (decision.mode !== 'refuse' || decision.code !== 'RESISTOR_AMBIGUOUS' || decision.edit != null) {
      failures.push(`${prompt} => ${decision.mode} ${decision.code ?? ''} ${decision.edit?.ref ?? ''}`);
    }
    if (componentValue(spec, 'R3') !== r3 || JSON.stringify(spec) !== JSON.stringify(before)) failures.push(`${prompt} mutated`);
  }
  for (const prompt of applies) {
    const before = structuredClone(spec);
    const decision = classifyExistingProjectRequest(prompt, spec);
    if (decision.mode !== 'merge' || decision.edit?.ref !== 'R3' || decision.edit?.ohms !== 680 || decision.edit?.label !== '680Ω') {
      failures.push(`${prompt} => ${decision.mode} ${decision.code ?? ''} ${decision.edit?.ref ?? ''} ${decision.edit?.ohms ?? ''} ${decision.edit?.label ?? ''}`);
    }
    if (componentValue(spec, 'R3') !== r3 || JSON.stringify(spec) !== JSON.stringify(before)) failures.push(`${prompt} mutated`);
    if (decision.edit) {
      const next = applyExistingProjectEdit(spec, decision.edit);
      if (componentValue(next, 'R3') !== '680Ω') failures.push(`${prompt} applied ${componentValue(next, 'R3')}`);
      if (componentValue(next, 'R4') !== '4.7k') failures.push(`${prompt} R4 ${componentValue(next, 'R4')}`);
      if (componentValue(next, 'R1') !== '5.1k') failures.push(`${prompt} R1 ${componentValue(next, 'R1')}`);
    }
  }
  const unclear = 'LED 저항을 680Ω으로 하든 말든 해줘';
  const unclearDecision = classifyExistingProjectRequest(unclear, spec);
  if (unclearDecision.code !== 'RESISTOR_TARGET_UNCLEAR' || unclearDecision.edit != null) {
    failures.push(`${unclear} => ${unclearDecision.mode} ${unclearDecision.code ?? ''} ${unclearDecision.edit?.ref ?? ''}`);
  }
  const afterValue = 'R4는 그대로 두고 오든 말든 LED 저항 680Ω';
  const afterValueDecision = classifyExistingProjectRequest(afterValue, spec);
  if (afterValueDecision.code !== 'RESISTOR_REF_UNSUPPORTED' || afterValueDecision.edit != null) {
    failures.push(`${afterValue} => ${afterValueDecision.mode} ${afterValueDecision.code ?? ''} ${afterValueDecision.edit?.ref ?? ''}`);
  }
  assert.deepEqual(failures, []);
});

// 바꾸고's -고 puts 680Ω in the previous clause, so the value-position rule
// does not see it. 바꾸 and 변경 are edit verbs, so the pair is still a choice
// and the R1 keep is RESISTOR_AMBIGUOUS. A non-edit verb after the same break
// stays the idiom and applies R3.
test('바꾸든 or 변경하든 after 바꾸고 plus an R1 keep is RESISTOR_AMBIGUOUS', () => {
  const spec = seriesSpec('1k');
  const prompts = [
    'LED 저항을 680Ω으로 바꾸고 바꾸든 말든 R1은 그대로 둘',
    'LED 저항을 680Ω으로 바꾸고 변경하든 말든 R1은 그대로 둘'
  ];
  const failures = [];
  const r3 = componentValue(spec, 'R3');
  for (const prompt of prompts) {
    const before = structuredClone(spec);
    const decision = classifyExistingProjectRequest(prompt, spec);
    if (decision.mode !== 'refuse' || decision.code !== 'RESISTOR_AMBIGUOUS' || decision.edit != null) {
      failures.push(`${prompt} => ${decision.mode} ${decision.code ?? ''} ${decision.edit?.ref ?? ''} ${decision.edit?.ohms ?? ''}`);
    }
    if (componentValue(spec, 'R3') !== r3 || JSON.stringify(spec) !== JSON.stringify(before)) failures.push(`${prompt} mutated`);
  }
  assert.deepEqual(failures, []);
});

// The target sits before 든/든지/거나 + 말든/말든지/말거나 and the value sits
// after that pair, in the same clause. That is the same choice as a value
// earlier in the clause, so a keep is RESISTOR_AMBIGUOUS. A standalone idiom
// after -고 still applies R3: its value is in the previous clause. No keep
// leaves the sentence on its current decision.
test('a value after 든-말든 in the same target clause is RESISTOR_AMBIGUOUS with a keep', () => {
  const spec = seriesSpec('1k');
  const ambiguous = [
    'LED 저항은 바꾸든 말든 680Ω으로 하고 R1은 그대로 둘',
    'LED 저항은 하든 말든 680Ω으로 하고 R1은 그대로 둘'
  ];
  const applies = [
    'LED 저항을 680Ω으로 바꾸고 하든 말든 R1은 그대로 둠',
    'LED 저항을 680Ω으로 바꾸고 오든 말든 R1은 그대로 둠',
    'LED 저항을 680Ω으로 바꾸고 가든 말든 R1은 그대로 둠'
  ];
  const failures = [];
  const r3 = componentValue(spec, 'R3');
  for (const prompt of ambiguous) {
    const before = structuredClone(spec);
    const decision = classifyExistingProjectRequest(prompt, spec);
    if (decision.mode !== 'refuse' || decision.code !== 'RESISTOR_AMBIGUOUS' || decision.edit != null) {
      failures.push(`${prompt} => ${decision.mode} ${decision.code ?? ''} ${decision.edit?.ref ?? ''} ${decision.edit?.ohms ?? ''}`);
    }
    if (componentValue(spec, 'R3') !== r3 || JSON.stringify(spec) !== JSON.stringify(before)) failures.push(`${prompt} mutated`);
  }
  for (const prompt of applies) {
    const before = structuredClone(spec);
    const decision = classifyExistingProjectRequest(prompt, spec);
    if (decision.mode !== 'merge' || decision.edit?.ref !== 'R3' || decision.edit?.ohms !== 680 || decision.edit?.label !== '680Ω') {
      failures.push(`${prompt} => ${decision.mode} ${decision.code ?? ''} ${decision.edit?.ref ?? ''} ${decision.edit?.ohms ?? ''} ${decision.edit?.label ?? ''}`);
    }
    if (componentValue(spec, 'R3') !== r3 || JSON.stringify(spec) !== JSON.stringify(before)) failures.push(`${prompt} mutated`);
    if (decision.edit) {
      const next = applyExistingProjectEdit(spec, decision.edit);
      if (componentValue(next, 'R3') !== '680Ω') failures.push(`${prompt} applied ${componentValue(next, 'R3')}`);
      if (componentValue(next, 'R4') !== '4.7k') failures.push(`${prompt} R4 ${componentValue(next, 'R4')}`);
      if (componentValue(next, 'R1') !== '5.1k') failures.push(`${prompt} R1 ${componentValue(next, 'R1')}`);
    }
  }
  const noKeep = 'LED 저항은 바꾸든 말든 680Ω으로 해줘';
  const noKeepBefore = structuredClone(spec);
  const noKeepDecision = classifyExistingProjectRequest(noKeep, spec);
  if (noKeepDecision.code !== 'RESISTOR_TARGET_UNCLEAR' || noKeepDecision.edit != null) {
    failures.push(`${noKeep} => ${noKeepDecision.mode} ${noKeepDecision.code ?? ''} ${noKeepDecision.edit?.ref ?? ''}`);
  }
  if (componentValue(spec, 'R3') !== r3 || JSON.stringify(spec) !== JSON.stringify(noKeepBefore)) failures.push(`${noKeep} mutated`);
  assert.deepEqual(failures, []);
});

test('contrast: lexical 든 is not a choice ending and verb-stem 든 still is', () => {
  const spec = seriesSpec('1k');
  const failures = [];
  const r3 = componentValue(spec, 'R3');
  const applies = ['어쨌든', '어쨨든', '어떻든', '얼마든', '골든'].map((word) => (
    `LED 저항 680Ω으로 바꾸고 ${word} R4는 그대로 둠`
  ));
  applies.push('LED 저항을 680Ω으로 바꾸고 언제든 R4는 그대로 둬');
  for (const prompt of applies) {
    const before = structuredClone(spec);
    const decision = classifyExistingProjectRequest(prompt, spec);
    if (decision.mode !== 'merge' || decision.edit?.ref !== 'R3' || decision.edit?.ohms !== 680) {
      failures.push(`${prompt} => ${decision.mode} ${decision.code ?? ''} ${decision.edit?.ref ?? ''} ${decision.edit?.ohms ?? ''}`);
    }
    if (componentValue(spec, 'R3') !== r3 || JSON.stringify(spec) !== JSON.stringify(before)) failures.push(`${prompt} mutated`);
    if (decision.edit) {
      const next = applyExistingProjectEdit(spec, decision.edit);
      if (componentValue(next, 'R3') !== '680Ω') failures.push(`${prompt} applied ${componentValue(next, 'R3')}`);
    }
  }
  const provider = [
    'LED 저항을 680Ω으로 바꾸고 무엇이든 R4는 그대로 둬',
    'LED 저항을 680Ω으로 바꾸고 뭐든 R4는 그대로',
    '뭐든 LED 저항 680Ω으로'
  ];
  for (const prompt of provider) {
    const before = structuredClone(spec);
    const decision = classifyExistingProjectRequest(prompt, spec);
    if (decision.mode !== 'refuse' || decision.code != null || decision.edit != null || blocksBeforeProvider(prompt, decision)) {
      failures.push(`${prompt} => ${decision.mode} ${decision.code ?? 'nocode'} block ${blocksBeforeProvider(prompt, decision)}`);
    }
    if (componentValue(spec, 'R3') !== r3 || JSON.stringify(spec) !== JSON.stringify(before)) failures.push(`${prompt} mutated`);
  }
  const when = '언제든 LED 저항 680Ω으로 바꿔줘';
  const whenDecision = classifyExistingProjectRequest(when, spec);
  if (whenDecision.code !== 'RESISTOR_REF_UNSUPPORTED') failures.push(`${when} => ${whenDecision.code ?? whenDecision.mode}`);
  const ambiguous = [
    'LED 저항 680Ω으로 바꾸든 R4는 4.7k로 유지',
    'LED 저항 680Ω으로 하든 R4는 4.7k 그대로',
    'LED 저항 680Ω으로 바꾸든 말든 R4는 4.7k로 유지',
    'LED 저항 680Ω으로 두든 R4는 그대로 둬',
    'LED 저항 680Ω으로 쓰든 R4는 그대로 둬'
  ];
  for (const prompt of ambiguous) {
    const decision = classifyExistingProjectRequest(prompt, spec);
    if (decision.code !== 'RESISTOR_AMBIGUOUS' || decision.edit != null) {
      failures.push(`${prompt} => ${decision.mode} ${decision.code ?? ''} ${decision.edit?.ohms ?? ''}`);
    }
  }
  assert.deepEqual(failures, []);
});

// The old deun lookbehind (?<!뭐|언제|어디|누구)든 treated these words as choice
// endings. A -고 in 바꾸고 splits the value into another clause, so that
// reading never reached the keep. These rows leave the value, the lexical 든,
// and the keep in one clause: reverting the stem check refuses them.
test('contrast: lexical 든 in the same clause as a keep still applies R3', () => {
  const spec = seriesSpec('1k');
  const failures = [];
  const r3 = componentValue(spec, 'R3');
  const lexical = ['어쨌든', '어쨨든', '어떻든', '얼마든', '골든'];
  const applies = [];
  for (const word of lexical) {
    applies.push(`LED 저항 680Ω으로 ${word} R4는 그대로 둬`);
    applies.push(`LED 저항을 680Ω으로 ${word} R4는 그대로 둬`);
    applies.push(`LED 저항을 680Ω으로 바꾸고 ${word} R4는 그대로 둬`);
  }
  for (const prompt of applies) {
    const before = structuredClone(spec);
    const decision = classifyExistingProjectRequest(prompt, spec);
    if (decision.mode !== 'merge' || decision.edit?.ref !== 'R3' || decision.edit?.ohms !== 680 || decision.edit?.label !== '680Ω') {
      failures.push(`${prompt} => ${decision.mode} ${decision.code ?? ''} ${decision.edit?.ref ?? ''} ${decision.edit?.ohms ?? ''} ${decision.edit?.label ?? ''}`);
    }
    if (componentValue(spec, 'R3') !== r3 || JSON.stringify(spec) !== JSON.stringify(before)) failures.push(`${prompt} mutated`);
    if (decision.edit) {
      const next = applyExistingProjectEdit(spec, decision.edit);
      if (componentValue(next, 'R3') !== '680Ω') failures.push(`${prompt} applied ${componentValue(next, 'R3')}`);
      if (componentValue(next, 'R4') !== '4.7k') failures.push(`${prompt} R4 ${componentValue(next, 'R4')}`);
    }
  }
  const provider = [
    'LED 저항 680Ω으로 무엇이든 R4는 그대로 둬',
    'LED 저항을 680Ω으로 무엇이든 R4는 그대로 둬',
    'LED 저항 680Ω으로 뭐든 R4는 그대로 둬'
  ];
  for (const prompt of provider) {
    const before = structuredClone(spec);
    const decision = classifyExistingProjectRequest(prompt, spec);
    if (decision.mode !== 'refuse' || decision.code != null || decision.edit != null || blocksBeforeProvider(prompt, decision)) {
      failures.push(`${prompt} => ${decision.mode} ${decision.code ?? 'nocode'} block ${blocksBeforeProvider(prompt, decision)}`);
    }
    if (componentValue(spec, 'R3') !== r3 || JSON.stringify(spec) !== JSON.stringify(before)) failures.push(`${prompt} mutated`);
  }
  const ambiguous = [
    'LED 저항 680Ω으로 바꾸든 R4는 그대로 둬',
    'LED 저항 680Ω으로 하든 R4는 그대로 둬',
    'LED 저항 680Ω으로 두든 R4는 그대로 둬',
    'LED 저항 680Ω으로 쓰든 R4는 그대로 둬'
  ];
  for (const prompt of ambiguous) {
    const decision = classifyExistingProjectRequest(prompt, spec);
    if (decision.code !== 'RESISTOR_AMBIGUOUS' || decision.edit != null) {
      failures.push(`${prompt} => ${decision.mode} ${decision.code ?? ''} ${decision.edit?.ohms ?? ''}`);
    }
  }
  assert.deepEqual(failures, []);
});

test('a discourse or golden-sample aside still sets the LED resistor to 680Ω', () => {
  const spec = seriesSpec('1k');
  const applies = [
    '어쨌든 LED 저항 680Ω으로 바꿔줘',
    'LED 저항은 어쨌든 680Ω으로',
    '어떻든 LED 저항 680Ω으로 바꿔줘',
    '골든 샘플처럼 LED 저항 680Ω으로',
    '골든 보드 기준으로 LED 저항 680Ω으로 바꿔줘',
    'LED 저항 680Ω으로, 골든 샘플과 같게',
    '샘플처럼 LED 저항 680Ω으로'
  ];
  for (const prompt of applies) {
    const before = structuredClone(spec);
    const decision = classifyExistingProjectRequest(prompt, spec);
    assert.equal(decision.mode, 'merge', `${prompt} ${decision.code ?? ''}`);
    assert.equal(decision.code, undefined, prompt);
    assert.equal(decision.edit?.ref, 'R3', prompt);
    assert.equal(decision.edit?.ohms, 680, prompt);
    assert.equal(decision.edit?.label, '680Ω', prompt);
    assert.equal(appliesBeforeProvider(prompt, decision, spec), true, prompt);
    assert.equal(blocksBeforeProvider(prompt, decision), false, prompt);
    const next = applyExistingProjectEdit(spec, decision.edit);
    assert.equal(componentValue(next, 'R3'), '680Ω', prompt);
    assert.equal(componentValue(next, 'R4'), '4.7k', prompt);
    assert.equal(componentValue(next, 'R1'), '5.1k', prompt);
    assert.deepEqual(spec, before, prompt);
  }

  const ledBoard = seriesLedBoard();
  for (const prompt of [
    'LED 저항 680Ω으로 바꾸든 R4는 4.7k로 유지',
    'LED 저항 680Ω으로 바꾸든 말든 R4는 4.7k로 유지',
    'LED 저항 680Ω으로 하든 R4는 4.7k 그대로',
    'LED 저항 680Ω으로 바꾸거나요 R4는 4.7k로 유지',
    'LED 저항 680Ω으로 바꾸든지요 R4는 4.7k로 유지',
    'LED 저항 680Ω으로 바꾸거나도 R4는 4.7k로 유지',
    'LED 저항 680Ω으로 바꾸든가나 R4는 4.7k로 유지',
    'LED 저항 680Ω으로 바꾸거나요, R4는 4.7k로 유지',
    'keep the LED circuit, set the LED resistor to 680Ω',
    'keep the LED, set it to 680Ω'
  ]) {
    assertAmbiguousKeep(ledBoard, prompt);
  }

  const unclear = resistorTargetUnclearMessage('680');
  for (const prompt of [
    'set the LED resistor to 680Ω with current limit 10mA',
    'set the LED resistor to 680Ω, current limit 10mA',
    'set the LED resistor to 680Ω for a 10mA current limit',
    'LED 저항 680Ω, 전류 제한 10mA'
  ]) {
    const decision = classifyExistingProjectRequest(prompt, spec);
    assert.equal(decision.mode, 'refuse', `${prompt} ${decision.code ?? ''}`);
    assert.equal(decision.code, 'RESISTOR_TARGET_UNCLEAR', prompt);
    assert.equal(decision.message, unclear, prompt);
    assert.equal(decision.edit, undefined, prompt);
    assert.equal(blocksBeforeProvider(prompt, decision), true, prompt);
  }

  const unsupported = resistorRefUnsupportedMessage('R3');
  for (const prompt of ['R4 저항 680Ω으로', '파란 저항 10k', '큰 저항 10k로', '기준 저항 680Ω으로', '골든 저항 680Ω으로']) {
    const decision = classifyExistingProjectRequest(prompt, spec);
    assert.equal(decision.mode, 'refuse', `${prompt} ${decision.code ?? ''}`);
    assert.equal(decision.code, 'RESISTOR_REF_UNSUPPORTED', prompt);
    assert.equal(decision.message, unsupported, prompt);
    assert.equal(decision.edit, undefined, prompt);
  }
  const missing = classifyExistingProjectRequest('R7 저항 680Ω으로', spec);
  assert.equal(missing.mode, 'refuse');
  assert.equal(missing.code, 'RESISTOR_REF_NOT_FOUND');
  assert.equal(missing.edit, undefined);
  const whenever = classifyExistingProjectRequest('언제든 LED 저항 680Ω으로 바꿔줘', spec);
  assert.equal(whenever.code, 'RESISTOR_REF_UNSUPPORTED');
  const whatever = classifyExistingProjectRequest('뭐든 LED 저항 680Ω으로', spec);
  assert.equal(whatever.mode, 'refuse');
  assert.equal(whatever.code, undefined);
  assert.equal(blocksBeforeProvider('뭐든 LED 저항 680Ω으로', whatever), false);
  const voltageBasis = classifyExistingProjectRequest('LED 저항 3.3V 기준으로', spec);
  assert.notEqual(voltageBasis.mode, 'merge');
  assert.equal(voltageBasis.edit, undefined);
});

// 어쨌든 / 어떻든 are aside filler only beside an LED-resistor synonym.
// needsLed: false on either row turns that word into filler here and edits R3.
test('contrast: 어쨌든 and 어떻든 without an LED synonym leave the target unclear', () => {
  const spec = seriesSpec('1k');
  const prompts = [
    '어쨌든 680Ω으로',
    '어쨌든 R3을 680Ω으로',
    '어떻든 680Ω으로',
    '어떻든 R3을 680Ω으로'
  ];
  for (const prompt of prompts) {
    const before = structuredClone(spec);
    const decision = classifyExistingProjectRequest(prompt, spec);
    assert.equal(decision.mode, 'refuse', `${prompt} ${decision.code ?? ''} ${decision.message ?? ''}`);
    assert.equal(decision.code, 'RESISTOR_TARGET_UNCLEAR', prompt);
    assert.equal(decision.edit, undefined, prompt);
    assert.deepEqual(spec, before, prompt);
  }
});

// Part (c) outcome for each r35 probe. A valued keep is dropped. One remaining
// LED resistor and one value apply on R3. A keep with nothing left stays
// ambiguous. The map is the sentence list and the expected outcome.
const R35_PROBE_OUTCOME = new Map([
  ['keep R4 at 680Ω, set the LED resistor to 680Ω', 'merge'],
  ['keep R4 at 680Ω', 'RESISTOR_AMBIGUOUS'],
  ['keep R4 at 680 ohms', 'RESISTOR_AMBIGUOUS'],
  ['keep R4 at 680 Ω', 'RESISTOR_AMBIGUOUS'],
  ['keep R4 at 680 ohm', 'RESISTOR_AMBIGUOUS'],
  ['keep R4 at 4.7kohm', 'RESISTOR_AMBIGUOUS'],
  ['keep R4 at 4.7 kΩ', 'RESISTOR_AMBIGUOUS'],
  ['keep R4 at 4.7k ohms', 'RESISTOR_AMBIGUOUS'],
  ['keep R4 at 680Ω.', 'RESISTOR_AMBIGUOUS'],
  ['keep the pull-up at 2.2 k', 'RESISTOR_AMBIGUOUS'],
  ['keep the pull-up at 2.2k', 'RESISTOR_AMBIGUOUS'],
  ['keep the I2C pullup at 4700 ohms', 'RESISTOR_AMBIGUOUS'],
  ['R4는 680Ω으로 유지', 'RESISTOR_AMBIGUOUS'],
  ['R4는 680 옴으로 유지', 'RESISTOR_AMBIGUOUS'],
  ['R4는 680옴으로 유지해줘', 'RESISTOR_AMBIGUOUS'],
  ['R4 680 Ω 그대로 두고', 'RESISTOR_AMBIGUOUS'],
  ['hold R4 at 680Ω', 'RESISTOR_AMBIGUOUS'],
  ['hold R4 at 680 ohms', 'RESISTOR_AMBIGUOUS'],
  ['leave the pull-up at 2.2k', 'RESISTOR_AMBIGUOUS'],
  ['leave the pull-up at 2.2 kΩ', 'RESISTOR_AMBIGUOUS'],
  ['leave R4 at 680 ohms', 'RESISTOR_AMBIGUOUS'],
  ["don't touch R4 at 680 ohms", 'RESISTOR_AMBIGUOUS'],
  ['set the LED resistor to 680Ω but keep R4 at 4.7k', 'merge'],
  ['set the LED resistor to 680Ω and keep R4 at 4.7k', 'merge'],
  ['change the LED resistor to 680Ω, keep R4 at 4.7kΩ', 'merge'],
  ['LED 저항은 680Ω으로 바꾸고 R4는 4.7k로 유지', 'merge'],
  ['keep the LED, set the LED resistor to 680Ω', 'merge'],
  ['LED는 그대로 두고 LED 저항만 680Ω으로', 'merge'],
  ['keep everything else, set the LED resistor to 680Ω', 'merge'],
  ['set the LED resistor to 680Ω, keep the rest', 'merge'],
  ['hold on, set the LED resistor to 680Ω', 'merge'],
  ['set the LED resistor to 680Ω and hold', 'merge'],
  ['hold the LED resistor at 680Ω', 'RESISTOR_AMBIGUOUS'],
  ['keep the LED resistor at 1k', 'RESISTOR_AMBIGUOUS'],
  ['keep 3 LEDs, set the LED resistor to 680Ω', 'merge'],
  ['keep the 100nF capacitor, set the LED resistor to 680Ω', 'RESISTOR_TARGET_UNCLEAR'],
  ['keep C1 at 100nF, set the LED resistor to 680Ω', 'RESISTOR_TARGET_UNCLEAR'],
  ['keep the 10k pull-up, set the LED resistor to 680Ω', 'merge'],
  ['keep the 4k7 pullups and set the LED resistor to 680Ω', 'merge'],
  ['keep R4, LED resistor 680Ω', 'merge'],
  ['R4, keep it at 4.7k, LED resistor 680Ω', 'RESISTOR_AMBIGUOUS'],
  ['keep R4 at 4.7k; LED resistor to 680Ω', 'merge'],
  ['keep R4 at 4.7k. LED resistor to 680Ω', 'merge'],
  ['set LED resistor to 680Ω. keep R4 at 4.7k', 'merge'],
  ['keep R4 as 680Ω', 'RESISTOR_AMBIGUOUS'],
  ['keep R4 = 680Ω', 'RESISTOR_AMBIGUOUS'],
  ['keep R4 @ 680Ω', 'RESISTOR_AMBIGUOUS'],
  ['keep R4 (680Ω)', 'RESISTOR_AMBIGUOUS'],
  ['keep R4 at 680Ω please', 'RESISTOR_AMBIGUOUS'],
  ['keep R4 at 680Ω!', 'RESISTOR_AMBIGUOUS'],
  ['keep R4 at 0.68k', 'RESISTOR_AMBIGUOUS'],
  ['keep R4 at 1M', 'RESISTOR_AMBIGUOUS'],
  ['keep R4 at 1 meg', 'RESISTOR_AMBIGUOUS'],
  ['keep R4 at 680Ω and R1 at 5.1k', 'RESISTOR_AMBIGUOUS']
]);

test('every r35 probe sentence has its valued-keep outcome', () => {
  const spec = seriesSpec('1k');
  const ambiguous = resistorAmbiguousMessage();
  assert.ok(R35_PROBE_OUTCOME.size > 0);
  for (const [prompt, want] of R35_PROBE_OUTCOME) {
    assert.equal(typeof want, 'string', prompt);
    const before = structuredClone(spec);
    const decision = classifyExistingProjectRequest(prompt, spec);
    if (want === 'merge') {
      assert.equal(decision.mode, 'merge', `${prompt} ${decision.code ?? ''}`);
      assert.equal(decision.edit?.ohms, 680, prompt);
      assert.equal(decision.edit?.label, '680Ω', prompt);
      assert.equal(decision.edit?.ref, 'R3', prompt);
      assert.equal(appliesBeforeProvider(prompt, decision), true, prompt);
      assert.equal(blocksBeforeProvider(prompt, decision), false, prompt);
      const next = applyExistingProjectEdit(spec, decision.edit);
      assert.equal(componentValue(next, 'R3'), '680Ω', prompt);
      assert.equal(componentValue(next, 'R4'), '4.7k', prompt);
    } else {
      assert.equal(decision.mode, 'refuse', `${prompt} ${decision.code ?? ''}`);
      assert.equal(decision.code, want, prompt);
      assert.equal(decision.edit, undefined, prompt);
      assert.equal(appliesBeforeProvider(prompt, decision), false, prompt);
      if (want === 'RESISTOR_AMBIGUOUS') {
        assert.equal(decision.message, ambiguous, prompt);
        assert.equal(blocksBeforeProvider(prompt, decision), true, prompt);
      }
    }
    assert.equal(componentValue(spec, 'R3'), '1k', prompt);
    assert.equal(componentValue(spec, 'R4'), '4.7k', prompt);
    assert.deepEqual(spec, before, prompt);
  }
});

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function propertySeed() {
  const raw = process.env.CHATPCB_PROP_SEED;
  if (raw != null && String(raw).trim() !== '' && Number.isFinite(Number(raw))) return Number(raw) >>> 0;
  return randomInt(0, 0x100000000);
}

function shuffleItems(rng, list) {
  for (let index = list.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rng() * (index + 1));
    const held = list[index];
    list[index] = list[swap];
    list[swap] = held;
  }
  return list;
}

function keepOnlySentence(cue, ref, value) {
  if (cue.slot === 'before') return `${ref} at ${value} ${cue.text}`;
  if (cue.slot === 'leave') return `leave ${ref} at ${value} ${cue.text}`;
  return `${cue.text} ${ref} at ${value}`;
}

test('property: a keep-only cue, ref, and value never changes R3', () => {
  const spec = seriesSpec('1k');
  const seed = propertySeed();
  const rng = mulberry32(seed);
  console.log(`keep-only value property seed ${seed}`);
  const cues = KEEP_CUES.filter((cue) => cue.slot !== 'filler');
  const refs = ['R1', 'R4', 'the pull-up'];
  const values = ['680 ohms', '680 Ω', '4.7 kΩ', '1 meg', '680옴'];
  const cases = [];
  for (const cue of cues) {
    for (const ref of refs) {
      for (const value of values) {
        cases.push(keepOnlySentence(cue, ref, value));
      }
    }
  }
  shuffleItems(rng, cases);
  const failures = [];
  const r3 = componentValue(spec, 'R3');
  for (const prompt of cases) {
    const before = structuredClone(spec);
    const decision = classifyExistingProjectRequest(prompt, spec);
    if (decision.mode === 'merge' && decision.edit?.ref === 'R3') {
      failures.push(`${prompt} => merge ${decision.edit.ohms}`);
    }
    if (componentValue(spec, 'R3') !== r3) failures.push(`${prompt} mutated`);
    if (JSON.stringify(spec) !== JSON.stringify(before)) failures.push(`${prompt} spec`);
    if (decision.mode === 'merge' && decision.edit) {
      const next = applyExistingProjectEdit(spec, decision.edit);
      if (componentValue(next, 'R3') !== r3) failures.push(`${prompt} R3 ${componentValue(next, 'R3')}`);
    }
  }
  assert.equal(cases.length, cues.length * refs.length * values.length);
  assert.equal(cases.length > 0, true);
  assert.deepEqual(failures.slice(0, 12), []);
});

const SELF_VALUED_KEEP_PROMPTS = [
  'set the LED resistor to 680Ω but keep R3 at 1k',
  'keep R3 at 1k, set the LED resistor to 680Ω',
  'set the LED resistor to 680Ω but keep the LED resistor at 1k',
  'keep the LED resistor at 1k, set the LED resistor to 680Ω',
  'keep the current-limiting resistor at 1k, LED resistor 680Ω',
  'set the LED resistor to 680Ω but keep the series resistor at 1k',
  'R3는 1k로 유지하고 LED 저항은 680Ω으로',
  'LED 저항은 680Ω으로 바꾸고 LED 저항은 1k로 유지',
  'keep the status LED resistor at 1k and set the LED resistor to 680Ω'
];

test('a valued keep of R3 or an LED-resistor synonym is RESISTOR_AMBIGUOUS', () => {
  const spec = seriesSpec('1k');
  const message = resistorAmbiguousMessage();
  for (const prompt of SELF_VALUED_KEEP_PROMPTS) {
    const before = structuredClone(spec);
    const decision = classifyExistingProjectRequest(prompt, spec);
    assert.equal(decision.mode, 'refuse', `${prompt} ${decision.code ?? ''} ${decision.message ?? ''}`);
    assert.equal(decision.code, 'RESISTOR_AMBIGUOUS', prompt);
    assert.equal(decision.message, message, prompt);
    assert.equal(decision.edit, undefined, prompt);
    assert.equal(blocksBeforeProvider(prompt, decision), true, prompt);
    assert.equal(appliesBeforeProvider(prompt, decision), false, prompt);
    assert.equal(componentValue(spec, 'R3'), '1k', prompt);
    assert.equal(componentValue(spec, 'R4'), '4.7k', prompt);
    assert.deepEqual(spec, before, prompt);
  }
});

test('a unitless integer after an R ref, at, or a Korean particle keeps R3 unchanged', () => {
  const spec = seriesSpec('1k');
  const message = resistorAmbiguousMessage();
  const prompts = [
    'R3 1000 그대로, LED 저항 680Ω',
    'R3는 1000으로 유지하고 LED 저항은 680Ω으로',
    'R3 at 1000 unchanged, LED resistor to 680Ω'
  ];
  for (const prompt of prompts) {
    const before = structuredClone(spec);
    const decision = classifyExistingProjectRequest(prompt, spec);
    assert.equal(decision.mode, 'refuse', `${prompt} ${decision.code ?? ''} ${decision.message ?? ''}`);
    assert.equal(decision.code, 'RESISTOR_AMBIGUOUS', prompt);
    assert.equal(decision.message, message, prompt);
    assert.equal(decision.edit, undefined, prompt);
    assert.equal(blocksBeforeProvider(prompt, decision), true, prompt);
    assert.equal(appliesBeforeProvider(prompt, decision), false, prompt);
    assert.equal(componentValue(spec, 'R3'), '1k', prompt);
    assert.equal(componentValue(spec, 'R4'), '4.7k', prompt);
    assert.deepEqual(spec, before, prompt);
  }

  const apply = 'set the LED resistor to 680Ω but keep R4 at 4.7k';
  const before = structuredClone(spec);
  const decision = classifyExistingProjectRequest(apply, spec);
  assert.equal(decision.mode, 'merge', `${apply} ${decision.code ?? ''} ${decision.message ?? ''}`);
  assert.equal(decision.edit?.ohms, 680, apply);
  assert.equal(decision.edit?.ref, 'R3', apply);
  assert.equal(appliesBeforeProvider(apply, decision), true, apply);
  const next = applyExistingProjectEdit(spec, decision.edit);
  assert.equal(componentValue(next, 'R3'), '680Ω', apply);
  assert.equal(componentValue(next, 'R4'), '4.7k', apply);
  assert.equal(componentValue(spec, 'R3'), '1k', apply);
  assert.deepEqual(spec, before, apply);
});

const SELF_KEEP_TARGETS = ['R3', 'r3', 'the LED resistor', 'the current-limiting resistor', 'LED 저항'];
const SELF_KEEP_VALUES = ['1k', '470 ohms', '2.2kΩ'];
const SELF_KEEP_EDITS = ['680Ω', '330 ohms'];

function selfValuedKeepClause(cue, target, value, lang) {
  if (lang === 'ko') {
    if (cue.slot === 'before') return `${target}는 ${value}로 ${cue.text}`;
    if (cue.slot === 'leave') return `leave ${target}는 ${value}로 ${cue.text}`;
    return `${cue.text} ${target}는 ${value}로`;
  }
  if (cue.slot === 'before') return `${target} at ${value} ${cue.text}`;
  if (cue.slot === 'leave') return `leave ${target} at ${value} ${cue.text}`;
  return `${cue.text} ${target} at ${value}`;
}

function selfValuedKeepEdit(value, lang) {
  return lang === 'ko' ? `LED 저항은 ${value}으로` : `set the LED resistor to ${value}`;
}

function placeSelfValuedKeep(keep, edit, order, lang) {
  if (order === 'first') return lang === 'ko' ? `${keep} ${edit}` : `${keep}, ${edit}`;
  return lang === 'ko' ? `${edit} 바꾸고 ${keep}` : `${edit} but ${keep}`;
}

test('property: a valued keep of R3 or an LED-resistor synonym never changes R3', () => {
  const spec = seriesSpec('1k');
  const seed = propertySeed();
  const rng = mulberry32(seed);
  console.log(`self valued-keep property seed ${seed}`);
  const cues = KEEP_CUES.filter((cue) => cue.slot !== 'filler');
  const cases = [];
  for (const cue of cues) {
    for (const target of SELF_KEEP_TARGETS) {
      for (const value of SELF_KEEP_VALUES) {
        for (const editValue of SELF_KEEP_EDITS) {
          for (const order of ['first', 'last']) {
            for (const lang of ['en', 'ko']) {
              const keep = selfValuedKeepClause(cue, target, value, lang);
              const edit = selfValuedKeepEdit(editValue, lang);
              cases.push(placeSelfValuedKeep(keep, edit, order, lang));
            }
          }
        }
      }
    }
  }
  shuffleItems(rng, cases);
  const failures = [];
  const r3 = componentValue(spec, 'R3');
  for (const prompt of cases) {
    const before = structuredClone(spec);
    const decision = classifyExistingProjectRequest(prompt, spec);
    if (decision.mode === 'merge' && decision.edit?.ref === 'R3') {
      failures.push(`${prompt} => merge ${decision.edit.ohms}`);
    }
    if (componentValue(spec, 'R3') !== r3) failures.push(`${prompt} mutated`);
    if (JSON.stringify(spec) !== JSON.stringify(before)) failures.push(`${prompt} spec`);
    if (decision.edit) {
      const next = applyExistingProjectEdit(spec, decision.edit);
      if (componentValue(next, 'R3') !== r3) failures.push(`${prompt} R3 ${componentValue(next, 'R3')}`);
    }
  }
  assert.equal(
    cases.length,
    cues.length * SELF_KEEP_TARGETS.length * SELF_KEEP_VALUES.length * SELF_KEEP_EDITS.length * 2 * 2
  );
  assert.equal(cases.length > 0, true);
  assert.deepEqual(failures.slice(0, 12), []);
});

test('a pronoun edit after a kept other resistor role is RESISTOR_AMBIGUOUS', () => {
  const spec = seriesSpec('1k');
  const message = resistorAmbiguousMessage();
  const ambiguous = [
    "don't touch the pull-ups, set them to 2.2k",
    "don't touch the I2C pull-ups, change them to 10k",
    "don't touch the CC resistor, set it to 680Ω",
    'keep the pull-ups, set them to 2.2k',
    'leave the pull-ups alone, set them to 2.2k',
    'I2C 풀업은 건드리지 말고 그것을 2.2k로',
    "don't touch the pull-ups, set that to 2.2k",
    "don't touch the pull-ups, set those to 2.2k",
    'I2C 풀업은 건드리지 말고 그거를 2.2k로',
    'I2C 풀업은 건드리지 말고 이것을 2.2k로'
  ];
  for (const prompt of ambiguous) {
    const before = structuredClone(spec);
    const decision = classifyExistingProjectRequest(prompt, spec);
    assert.equal(decision.mode, 'refuse', `${prompt} ${decision.code ?? ''} ${decision.message ?? ''}`);
    assert.equal(decision.code, 'RESISTOR_AMBIGUOUS', prompt);
    assert.equal(decision.message, message, prompt);
    assert.equal(decision.edit, undefined, prompt);
    assert.equal(blocksBeforeProvider(prompt, decision), true, prompt);
    assert.equal(appliesBeforeProvider(prompt, decision), false, prompt);
    assert.equal(componentValue(spec, 'R3'), '1k', prompt);
    assert.equal(componentValue(spec, 'R1'), '5.1k', prompt);
    assert.equal(componentValue(spec, 'R4'), '4.7k', prompt);
    assert.deepEqual(spec, before, prompt);
  }

  const applies = [
    ["don't touch the pull-ups, set the LED resistor to 680Ω", 680, '680Ω'],
    ['keep the pull-ups, set the LED resistor to 680Ω', 680, '680Ω']
  ];
  for (const [prompt, ohms, label] of applies) {
    const before = structuredClone(spec);
    const decision = classifyExistingProjectRequest(prompt, spec);
    assert.equal(decision.mode, 'merge', `${prompt} ${decision.code ?? ''} ${decision.message ?? ''}`);
    assert.equal(decision.code, undefined, prompt);
    assert.equal(decision.edit?.kind, 'resistor', prompt);
    assert.equal(decision.edit?.ohms, ohms, prompt);
    assert.equal(decision.edit?.label, label, prompt);
    assert.equal(decision.edit?.ref, 'R3', prompt);
    assert.equal(appliesBeforeProvider(prompt, decision), true, prompt);
    assert.equal(blocksBeforeProvider(prompt, decision), false, prompt);
    const next = applyExistingProjectEdit(spec, decision.edit);
    assert.equal(componentValue(next, 'R3'), label, prompt);
    assert.equal(componentValue(next, 'R1'), '5.1k', prompt);
    assert.equal(componentValue(next, 'R4'), '4.7k', prompt);
    assert.equal(componentValue(spec, 'R3'), '1k', prompt);
    assert.deepEqual(spec, before, prompt);
  }
});

const OTHER_ROLE_KEEP_TARGETS = ['the pull-ups', 'the I2C pull-ups', 'the CC resistor', 'R4'];
const PRONOUN_EDIT_VALUES = ['2.2k', '680Ω'];
const PRONOUN_ONLY_EDITS = [
  (value) => `set it to ${value}`,
  (value) => `set them to ${value}`,
  (value) => `set those to ${value}`,
  (value) => `change it to ${value}`,
  (value) => `그것을 ${value}로`
];
const LED_RESISTOR_EDITS = [
  (value) => `set the LED resistor to ${value}`,
  (value) => `set the LED resistor to ${value}`,
  (value) => `set the LED resistor to ${value}`,
  (value) => `change the LED resistor to ${value}`,
  (value) => `the LED resistor를 ${value}로`
];

function otherRoleKeepClause(cue, role) {
  if (cue.slot === 'before') return `${role} ${cue.text}`;
  if (cue.slot === 'leave') return `leave ${role} ${cue.text}`;
  return `${cue.text} ${role}`;
}

function placeKeepAndEdit(keep, edit, order) {
  if (order === 'keep-first') return `${keep}, ${edit}`;
  return `${edit}, ${keep}`;
}

function ohmsForToken(token) {
  if (token === '2.2k') return { ohms: 2200, label: '2.2k' };
  return { ohms: 680, label: '680Ω' };
}

test('property: a kept other role plus a pronoun edit is RESISTOR_AMBIGUOUS and an LED target still applies', { timeout: 30000 }, () => {
  const spec = seriesSpec('1k');
  const seed = propertySeed();
  const rng = mulberry32(seed);
  console.log(`pronoun-after-other-role-keep property seed ${seed}`);
  const cues = KEEP_CUES.filter((cue) => cue.slot !== 'filler');
  const orders = ['keep-first', 'edit-first'];
  const ambiguous = [];
  const applies = [];
  for (const cue of cues) {
    for (const role of OTHER_ROLE_KEEP_TARGETS) {
      for (const value of PRONOUN_EDIT_VALUES) {
        for (const order of orders) {
          const keep = otherRoleKeepClause(cue, role);
          for (const editOf of PRONOUN_ONLY_EDITS) {
            ambiguous.push(placeKeepAndEdit(keep, editOf(value), order));
          }
          for (const editOf of LED_RESISTOR_EDITS) {
            applies.push([placeKeepAndEdit(keep, editOf(value), order), value]);
          }
        }
      }
    }
  }
  shuffleItems(rng, ambiguous);
  shuffleItems(rng, applies);
  const failures = [];
  const r3 = componentValue(spec, 'R3');
  for (const prompt of ambiguous) {
    const before = structuredClone(spec);
    const decision = classifyExistingProjectRequest(prompt, spec);
    if (decision.code !== 'RESISTOR_AMBIGUOUS' || decision.mode !== 'refuse' || decision.edit != null) {
      failures.push(`${prompt} => ${decision.mode} ${decision.code ?? ''} ${decision.edit?.ref ?? ''} ${decision.edit?.ohms ?? ''}`);
    }
    if (componentValue(spec, 'R3') !== r3 || JSON.stringify(spec) !== JSON.stringify(before)) {
      failures.push(`${prompt} mutated`);
    }
    if (decision.edit) {
      const next = applyExistingProjectEdit(spec, decision.edit);
      if (componentValue(next, 'R3') !== r3) failures.push(`${prompt} R3 ${componentValue(next, 'R3')}`);
    }
  }
  for (const [prompt, value] of applies) {
    const before = structuredClone(spec);
    const decision = classifyExistingProjectRequest(prompt, spec);
    const want = ohmsForToken(value);
    if (decision.mode !== 'merge' || decision.edit?.ref !== 'R3' || decision.edit?.ohms !== want.ohms || decision.edit?.label !== want.label) {
      failures.push(`${prompt} => ${decision.mode} ${decision.code ?? ''} ${decision.edit?.ref ?? ''} ${decision.edit?.ohms ?? ''} ${decision.edit?.label ?? ''}`);
    }
    if (componentValue(spec, 'R3') !== r3 || JSON.stringify(spec) !== JSON.stringify(before)) {
      failures.push(`${prompt} mutated`);
    }
    if (decision.edit) {
      const next = applyExistingProjectEdit(spec, decision.edit);
      if (componentValue(next, 'R3') !== want.label) failures.push(`${prompt} applied ${componentValue(next, 'R3')}`);
      if (componentValue(next, 'R1') !== '5.1k' || componentValue(next, 'R4') !== '4.7k') {
        failures.push(`${prompt} other ref`);
      }
    }
  }
  const width = cues.length * OTHER_ROLE_KEEP_TARGETS.length * PRONOUN_EDIT_VALUES.length * orders.length * PRONOUN_ONLY_EDITS.length;
  assert.equal(ambiguous.length, width);
  assert.equal(applies.length, width);
  assert.equal(width > 0, true);
  assert.deepEqual(failures.slice(0, 12), []);
});

const NUMBERED_KEEP_PROMPTS = [
  'R3: 1000 그대로, LED 저항 680Ω',
  'R3 = 1000 그대로, LED 저항 680Ω',
  'R3 값 1000 그대로, LED 저항 680Ω',
  'R3 값은 1000 그대로, LED 저항 680Ω',
  'R3 is 1000, unchanged; LED resistor to 680Ω'
];

test('a numbered keep of R3 or an LED resistor is RESISTOR_AMBIGUOUS and R4 still applies', () => {
  const spec = seriesSpec('1k');
  const message = resistorAmbiguousMessage();
  for (const prompt of NUMBERED_KEEP_PROMPTS) {
    const before = structuredClone(spec);
    const decision = classifyExistingProjectRequest(prompt, spec);
    assert.equal(decision.mode, 'refuse', `${prompt} ${decision.code ?? ''} ${decision.message ?? ''}`);
    assert.equal(decision.code, 'RESISTOR_AMBIGUOUS', prompt);
    assert.equal(decision.message, message, prompt);
    assert.equal(decision.edit, undefined, prompt);
    assert.equal(blocksBeforeProvider(prompt, decision), true, prompt);
    assert.equal(appliesBeforeProvider(prompt, decision), false, prompt);
    assert.equal(componentValue(spec, 'R3'), '1k', prompt);
    assert.equal(componentValue(spec, 'R4'), '4.7k', prompt);
    assert.deepEqual(spec, before, prompt);
  }

  const apply = 'set the LED resistor to 680Ω but keep R4 at 4.7k';
  const before = structuredClone(spec);
  const decision = classifyExistingProjectRequest(apply, spec);
  assert.equal(decision.mode, 'merge', `${apply} ${decision.code ?? ''} ${decision.message ?? ''}`);
  assert.equal(decision.edit?.ohms, 680, apply);
  assert.equal(decision.edit?.ref, 'R3', apply);
  assert.equal(decision.edit?.label, '680Ω', apply);
  assert.equal(appliesBeforeProvider(apply, decision), true, apply);
  const next = applyExistingProjectEdit(spec, decision.edit);
  assert.equal(componentValue(next, 'R3'), '680Ω', apply);
  assert.equal(componentValue(next, 'R4'), '4.7k', apply);
  assert.equal(componentValue(spec, 'R3'), '1k', apply);
  assert.deepEqual(spec, before, apply);
});

const NUMBERED_KEEP_TARGETS = [
  'R3',
  'r3',
  'the LED resistor',
  'the current-limiting resistor',
  'the series resistor',
  'LED 저항',
  '전류제한 저항'
];
const NUMBERED_KEEP_JOINERS = [' ', ': ', ' = ', ' is ', ' 값 ', ' 값은 ', ' at '];
const NUMBERED_KEEP_NUMBERS = ['1000', '1k', '470', '2.2kΩ'];
const NUMBERED_KEEP_EDITS = [
  ['en', 'LED resistor to 680Ω'],
  ['ko', 'LED 저항 680Ω']
];
const NUMBERED_KEEP_POSITIONS = ['before', 'after'];

function numberedKeepClause(cue, target, joiner, number) {
  const named = `${target}${joiner}${number}`;
  if (cue.slot === 'before') return `${named} ${cue.text}`;
  if (cue.slot === 'leave') return `leave ${named} ${cue.text}`;
  return `${cue.text} ${named}`;
}

function placeNumberedKeep(keep, edit, position) {
  if (position === 'before') return `${keep}, ${edit}`;
  return `${edit}, ${keep}`;
}

test('property: a numbered keep cue names R3 or an LED resistor with a number and R4 still applies', { timeout: 120000 }, () => {
  const spec = seriesSpec('1k');
  const seed = propertySeed();
  const rng = mulberry32(seed);
  console.log(`numbered keep property seed ${seed}`);
  const cues = KEEP_CUES.filter((cue) => cue.slot !== 'filler');
  const ambiguous = [];
  const applies = [];
  for (const cue of cues) {
    for (const joiner of NUMBERED_KEEP_JOINERS) {
      for (const number of NUMBERED_KEEP_NUMBERS) {
        for (const position of NUMBERED_KEEP_POSITIONS) {
          for (const [, edit] of NUMBERED_KEEP_EDITS) {
            for (const target of NUMBERED_KEEP_TARGETS) {
              const keep = numberedKeepClause(cue, target, joiner, number);
              ambiguous.push(placeNumberedKeep(keep, edit, position));
            }
            const kept = numberedKeepClause(cue, 'R4', joiner, number);
            applies.push(placeNumberedKeep(kept, edit, position));
          }
        }
      }
    }
  }
  shuffleItems(rng, ambiguous);
  shuffleItems(rng, applies);
  const failures = [];
  const r3 = componentValue(spec, 'R3');
  for (const prompt of ambiguous) {
    const before = structuredClone(spec);
    const decision = classifyExistingProjectRequest(prompt, spec);
    if (decision.mode !== 'refuse' || decision.code !== 'RESISTOR_AMBIGUOUS' || decision.edit != null) {
      failures.push(`${prompt} => ${decision.mode} ${decision.code ?? ''} ${decision.edit?.ref ?? ''} ${decision.edit?.ohms ?? ''}`);
    }
    if (componentValue(spec, 'R3') !== r3 || JSON.stringify(spec) !== JSON.stringify(before)) {
      failures.push(`${prompt} mutated`);
    }
    if (decision.edit) {
      const next = applyExistingProjectEdit(spec, decision.edit);
      if (componentValue(next, 'R3') !== r3) failures.push(`${prompt} R3 ${componentValue(next, 'R3')}`);
    }
  }
  for (const prompt of applies) {
    const before = structuredClone(spec);
    const decision = classifyExistingProjectRequest(prompt, spec);
    if (decision.mode !== 'merge' || decision.edit?.ref !== 'R3' || decision.edit?.ohms !== 680 || decision.edit?.label !== '680Ω') {
      failures.push(`${prompt} => ${decision.mode} ${decision.code ?? ''} ${decision.edit?.ref ?? ''} ${decision.edit?.ohms ?? ''} ${decision.edit?.label ?? ''}`);
    }
    if (componentValue(spec, 'R3') !== r3 || JSON.stringify(spec) !== JSON.stringify(before)) {
      failures.push(`${prompt} mutated`);
    }
    if (decision.edit) {
      const next = applyExistingProjectEdit(spec, decision.edit);
      if (componentValue(next, 'R3') !== '680Ω') failures.push(`${prompt} applied ${componentValue(next, 'R3')}`);
      if (componentValue(next, 'R4') !== '4.7k') failures.push(`${prompt} R4 ${componentValue(next, 'R4')}`);
    }
  }
  const ambiguousWidth = cues.length * NUMBERED_KEEP_TARGETS.length * NUMBERED_KEEP_JOINERS.length * NUMBERED_KEEP_NUMBERS.length * NUMBERED_KEEP_POSITIONS.length * NUMBERED_KEEP_EDITS.length;
  const applyWidth = cues.length * NUMBERED_KEEP_JOINERS.length * NUMBERED_KEEP_NUMBERS.length * NUMBERED_KEEP_POSITIONS.length * NUMBERED_KEEP_EDITS.length;
  assert.equal(ambiguous.length, ambiguousWidth);
  assert.equal(applies.length, applyWidth);
  assert.equal(ambiguousWidth > 0, true);
  assert.deepEqual(failures.slice(0, 12), []);
});

// The status LED's own D ref. D1 on seriesLedBoard; another diode is not this part.
function statusLedRef(spec) {
  const rows = [
    ...(spec?.schematic?.components ?? []),
    ...(spec?.boardProfile?.productionParts ?? [])
  ];
  for (const row of rows) {
    const ref = String(row?.ref ?? '');
    if (!/^D\d+$/iu.test(ref)) continue;
    const role = String(row?.role ?? '');
    const libId = String(row?.libId ?? '');
    const value = String(row?.value ?? '');
    if (role === 'status-led' || libId === 'ChatPCB:STATUS_LED' || value === 'STATUS_LED') return ref.toUpperCase();
  }
  return null;
}

function boardWithStatusLedRef(ref) {
  const spec = seriesLedBoard('1k');
  for (const row of [...spec.schematic.components, ...spec.boardProfile.productionParts]) {
    if (String(row.ref).toUpperCase() === 'D1') row.ref = ref;
  }
  return spec;
}

// Phrases that name the LED series resistor. The D ref comes from the spec.
function ledResistorAliasPhrases(ledRef) {
  return [
    'the current limiter',
    `${ledRef}'s resistor`,
    `the ${ledRef} resistor`,
    'the indicator resistor',
    'the series one',
    `${ledRef} 저항`
  ];
}

function aliasKeepSentences(phrase) {
  return [
    `keep ${phrase} and set R3 to 680Ω`,
    `keep ${phrase}, set the LED resistor to 680Ω`,
    `keep R4 or ${phrase} and set the LED resistor to 680Ω`,
    `R4 또는 ${phrase}은 그대로 두고 R3 680Ω으로`
  ];
}

test('property: an LED-resistor alias keep is RESISTOR_AMBIGUOUS and a direct edit applies R3', () => {
  const boards = [seriesLedBoard('1k'), boardWithStatusLedRef('D7')];
  const failures = [];
  for (const spec of boards) {
    const ledRef = statusLedRef(spec);
    const phrases = ledResistorAliasPhrases(ledRef);
    const ambiguous = phrases.flatMap((phrase) => aliasKeepSentences(phrase));
    const applies = [
      'keep R4 or R5 and set the LED resistor to 680Ω',
      'keep the LED, set the LED resistor to 680Ω',
      `keep ${ledRef}, set the LED resistor to 680Ω`,
      `keep ${ledRef} and change the LED resistor to 680Ω`,
      'set the current limiter to 680Ω',
      `${ledRef} 저항 680Ω으로`,
      'set the indicator resistor to 680Ω',
      'set the series one to 680Ω'
    ];
    const r3 = componentValue(spec, 'R3');
    for (const prompt of ambiguous) {
      const before = structuredClone(spec);
      const decision = classifyExistingProjectRequest(prompt, spec);
      if (decision.mode !== 'refuse' || decision.code !== 'RESISTOR_AMBIGUOUS' || decision.edit != null) {
        failures.push(`${ledRef} ${prompt} => ${decision.mode} ${decision.code ?? ''} ${decision.edit?.ref ?? ''} ${decision.edit?.ohms ?? ''}`);
      }
      if (componentValue(spec, 'R3') !== r3 || JSON.stringify(spec) !== JSON.stringify(before)) failures.push(`${prompt} mutated`);
    }
    for (const prompt of applies) {
      const before = structuredClone(spec);
      const decision = classifyExistingProjectRequest(prompt, spec);
      if (decision.mode !== 'merge' || decision.edit?.ref !== 'R3' || decision.edit?.ohms !== 680 || decision.edit?.label !== '680Ω') {
        failures.push(`${ledRef} ${prompt} => ${decision.mode} ${decision.code ?? ''} ${decision.edit?.ref ?? ''} ${decision.edit?.ohms ?? ''} ${decision.edit?.label ?? ''}`);
      }
      if (componentValue(spec, 'R3') !== r3 || JSON.stringify(spec) !== JSON.stringify(before)) failures.push(`${prompt} mutated`);
      if (decision.edit) {
        const next = applyExistingProjectEdit(spec, decision.edit);
        if (componentValue(next, 'R3') !== '680Ω') failures.push(`${prompt} applied ${componentValue(next, 'R3')}`);
        if (componentValue(next, 'R4') !== '4.7k') failures.push(`${prompt} R4 ${componentValue(next, 'R4')}`);
      }
    }
    const otherRef = ledRef === 'D1' ? 'D7' : 'D1';
    const otherEdit = `${otherRef} 저항 680Ω으로`;
    const otherDecision = classifyExistingProjectRequest(otherEdit, spec);
    if (otherDecision.mode === 'merge' && otherDecision.edit?.ref === 'R3') {
      failures.push(`${otherEdit} on ${ledRef} applied R3`);
    }
    // "current limit" / "current-limit" are modifiers. They are not the
    // "current limiter" alias, so a keep or an edit of them stays unclear
    // unless a resistor noun is present.
    for (const prompt of [
      'set the current limit to 680Ω',
      'set the current-limit to 680Ω',
      'keep the current-limit and set R3 to 680Ω',
      'set the indicator to 680Ω'
    ]) {
      const decision = classifyExistingProjectRequest(prompt, spec);
      if (decision.mode !== 'refuse' || decision.code !== 'RESISTOR_TARGET_UNCLEAR') {
        failures.push(`${ledRef} ${prompt} => ${decision.mode} ${decision.code ?? ''} ${decision.edit?.ref ?? ''}`);
      }
    }
    assert.equal(phrases.length, 6);
    assert.equal(ambiguous.length, phrases.length * 4);
  }
  assert.deepEqual(failures.slice(0, 16), []);
});

// UAT 121 joins the alias keep with a comma and no "and set". 120/122 use "and set".
// "전류 제한기" names the same part as "current limiter", so that keep contradicts the edit.
// A ref list with no alias still edits R3.
test('a comma-joined LED-resistor alias keep is RESISTOR_AMBIGUOUS', () => {
  const spec = seriesLedBoard();
  for (const prompt of [
    'keep R4 or the current limiter, LED resistor 680Ω',
    'keep the current limiter, LED resistor 680Ω',
    'R4 또는 전류 제한기는 그대로 두고, LED 저항 680Ω'
  ]) assertAmbiguousKeep(spec, prompt);
  assertLedKeepApplies(spec, 'keep R4 or R5, LED resistor 680Ω');
});

// "전류 제한" / "전류 제한 저항" stay modifiers. "전류 제한기" is the part.
// Bare "리미터" must not match inside "밀리미터" or "프리미터".
test('Korean current-limiter names are RESISTOR_AMBIGUOUS on keep and apply R3 on edit', () => {
  const spec = seriesLedBoard();
  for (const synonym of ['current limiters', '전류 제한기', '전류제한기', '표시등 저항', '리미터']) {
    assert.equal(LED_RESISTOR_SYNONYMS.includes(synonym), true, synonym);
  }
  for (const prompt of [
    'R4 또는 전류 제한기는 그대로 두고, LED 저항 680Ω',
    'R4 또는 전류 제한기는 그대로 두고 LED 저항 680Ω',
    '전류 제한기는 그대로 두고, LED 저항 680Ω',
    '전류 제한기는 그대로 두고 LED 저항 680Ω',
    '전류 제한기는 그대로 두고 LED 저항을 680Ω으로',
    'R4 또는 전류제한기는 그대로 두고, LED 저항 680Ω',
    '전류제한기는 그대로 두고 LED 저항 680Ω',
    '전류 제한기는 건드리지 말고 R3 680Ω',
    'R4 또는 전류 제한기는 건드리지 말고 R3 680Ω으로',
    'keep the current limiters and set R3 to 680Ω',
    'keep the current limiters, set the LED resistor to 680Ω'
  ]) assertAmbiguousKeep(spec, prompt);
  for (const prompt of [
    '전류 제한기를 680Ω으로',
    '전류제한기 680Ω으로 바꿔줘',
    '표시등 저항 680Ω으로',
    '리미터 680Ω으로',
    'set the current limiters to 680Ω'
  ]) assertLedKeepApplies(spec, prompt);
  assertAmbiguousKeep(spec, '전류 제한 저항은 그대로 두고 LED 저항 680Ω');
  for (const prompt of [
    '전류 제한 저항 680Ω',
    'LED 전류 제한용 저항 680Ω',
    '전류 제한 680Ω으로',
    '전류 제한을 680Ω으로',
    '전류제한 680Ω으로',
    '전류 제한용 680Ω으로',
    '리미터 저항 680Ω으로'
  ]) {
    const decision = classifyExistingProjectRequest(prompt, spec);
    assert.equal(decision.mode, 'merge', `${prompt} ${decision.code ?? ''} ${decision.message ?? ''}`);
    assert.equal(decision.edit?.ref, 'R3', prompt);
    assert.equal(decision.edit?.ohms, 680, prompt);
    assert.equal(decision.edit?.label, '680Ω', prompt);
    const next = applyExistingProjectEdit(spec, decision.edit);
    assert.equal(componentValue(next, 'R3'), '680Ω', prompt);
    assert.equal(componentValue(spec, 'R3'), '1k', prompt);
  }
  for (const prompt of ['전류제한용 680Ω으로', 'set the current limit to 680Ω', '프리미터 680Ω으로', '전압 리미터 680Ω으로']) {
    const decision = classifyExistingProjectRequest(prompt, spec);
    assert.equal(decision.mode, 'refuse', `${prompt} ${decision.code ?? ''}`);
    assert.equal(decision.code, 'RESISTOR_TARGET_UNCLEAR', prompt);
    assert.equal(decision.edit, undefined, prompt);
  }
  const milliResistor = classifyExistingProjectRequest('밀리미터 저항 680Ω으로', spec);
  assert.equal(milliResistor.mode, 'refuse', milliResistor.code ?? '');
  assert.equal(milliResistor.code, 'RESISTOR_REF_UNSUPPORTED');
  assert.equal(milliResistor.edit, undefined);
  for (const prompt of [
    '밀리미터는 그대로 두고 LED 저항 680Ω',
    '프리미터는 그대로 두고 LED 저항 680Ω'
  ]) assertLedKeepApplies(spec, prompt);
});

// A Korean LED alias is the part only at a word boundary. Hangul glued on
// ("과전류 제한기"), a noun continuation ("전류 제한 기능"), or a
// preceding qualifier ("전압 리미터", "USB 전류 제한기") is a different part.
// The LED 저항 edit still applies. A real "전류 제한기" keep stays ambiguous.
test('a qualified or extended Korean LED alias keep still applies the LED resistor edit', () => {
  const spec = seriesLedBoard();
  for (const prompt of [
    '전류 제한 기능은 그대로 두고 LED 저항을 680Ω으로 바꿔',
    '과전류 제한기는 그대로 두고 LED 저항을 680Ω으로 바꿔',
    'USB 전류 제한기는 그대로 두고 LED 저항을 680Ω으로 바꿔',
    '전압 리미터는 그대로 두고 LED 저항을 680Ω으로 바꿔',
    '과전류 제한 기능은 그대로 두고 LED 저항을 680Ω으로 바꿔',
    '5밀리미터 간격은 그대로 두고 LED 저항을 680Ω으로 바꿔',
    '프리미터 레이어는 그대로 두고 LED 저항을 680Ω으로 바꿔'
  ]) assertLedKeepApplies(spec, prompt);
  for (const prompt of [
    '과전류 제한기를 680Ω으로 바꿔',
    '과전류제한기를 680Ω으로 바꿔',
    '전압 리미터를 680Ω으로 바꿔'
  ]) {
    const decision = classifyExistingProjectRequest(prompt, spec);
    assert.equal(decision.mode, 'refuse', `${prompt} ${decision.code ?? ''}`);
    assert.equal(decision.code, 'RESISTOR_TARGET_UNCLEAR', prompt);
    assert.equal(decision.edit, undefined, prompt);
  }
  const usbLimiter = classifyExistingProjectRequest('USB 리미터를 680Ω으로 바꿔', spec);
  assert.equal(usbLimiter.mode, 'refuse', usbLimiter.code ?? '');
  assert.equal(usbLimiter.code, 'RESISTOR_REF_UNSUPPORTED');
  assert.equal(usbLimiter.edit, undefined);
  const compactFunction = classifyExistingProjectRequest('전류제한기능은 유지하고 LED 저항을 680Ω으로 바꿔', spec);
  assert.equal(compactFunction.mode, 'refuse', compactFunction.code ?? '');
  assert.equal(compactFunction.code, 'RESISTOR_TARGET_UNCLEAR', '전류제한기능은 유지하고 LED 저항을 680Ω으로 바꿔');
  assert.equal(compactFunction.edit, undefined);
});

// Particles and postpositions do not lengthen the alias into another noun.
// A designator, adverb, or separator in front does not qualify a different part.
test('Korean alias particles, separators, and adverbs stay RESISTOR_AMBIGUOUS', () => {
  const spec = seriesLedBoard();
  for (const prompt of [
    '전류 제한기하고 R4는 그대로 두고, LED 저항 680Ω',
    '전류 제한기나 R4는 그대로 두고, LED 저항 680Ω',
    '전류 제한기까지 그대로 두고, LED 저항 680Ω',
    '전류 제한기에는 손대지 말고, LED 저항 680Ω',
    'R4(전류 제한기)는 그대로 두고, LED 저항 680Ω',
    'R4·전류 제한기는 그대로 두고, LED 저항 680Ω',
    '지금 전류 제한기는 그대로 두고, LED 저항 680Ω',
    'R4나 리미터는 그대로 두고, LED 저항 680Ω',
    'R4/전류 제한기는 그대로 두고, LED 저항 680Ω'
  ]) assertAmbiguousKeep(spec, prompt);
});

// Each Korean noun alias plus a particle is still that alias. The particle is
// glued on, and the keep cue stays "그대로 두고". A modifier row is not that
// part unless 저항 follows it.
const KOREAN_ALIAS_PARTICLES = Object.freeze([
  '는', '은', '을', '를', '도', '만', '하고', '나', '이나', '까지', '부터', '에는', '에도', '처럼'
]);

function koreanLedResistorAliases() {
  return LED_RESISTOR_SYNONYMS.filter((alias) => /[가-힣]/u.test(alias) && !alias.includes('{led}'));
}

test('Korean noun alias particle keeps are RESISTOR_AMBIGUOUS and a modifier names that part only with 저항', () => {
  const spec = seriesLedBoard();
  const failures = [];
  const aliases = koreanLedResistorAliases();
  const nouns = aliases.filter((alias) => ledResistorSynonymIsNoun(alias));
  for (const alias of nouns) {
    for (const particle of KOREAN_ALIAS_PARTICLES) {
      const prompt = `${alias}${particle} 그대로 두고, LED 저항 680Ω`;
      const decision = classifyExistingProjectRequest(prompt, spec);
      if (decision.code !== 'RESISTOR_AMBIGUOUS' || decision.edit != null) {
        failures.push(`noun ${prompt} => ${decision.code ?? decision.mode} ${decision.edit?.ref ?? ''} ${decision.edit?.ohms ?? ''}`);
      }
    }
  }
  assert.equal(aliases.length > nouns.length, true);
  assert.equal(nouns.length > 0, true);
  assert.equal(ledResistorSynonymIsNoun('직렬'), false);
  assert.equal(ledResistorSynonymIsNoun('LED 직렬'), false);
  assert.equal(ledResistorSynonymIsNoun('전류 제한'), false);
  assert.equal(ledResistorSynonymIsNoun('전류제한'), false);
  assert.equal(ledResistorSynonymIsNoun('전류 제한용'), false);
  assert.equal(ledResistorSynonymIsNoun('전류제한용'), false);
  assert.equal(ledResistorSynonymIsNoun('엘이디'), false);
  assert.equal(ledResistorSynonymIsNoun('엘예디'), false);
  assert.equal(ledResistorSynonymIsNoun('상태'), false);
  assert.equal(ledResistorSynonymIsNoun('발광다이오드'), false);
  assert.equal(ledResistorSynonymIsNoun('전류 제한기'), true);
  assert.equal(ledResistorSynonymIsNoun('전류제한기'), true);
  assert.equal(ledResistorSynonymIsNoun('리미터'), true);
  assert.equal(ledResistorSynonymIsNoun('표시등 저항'), true);
  assert.equal(ledResistorSynonymIsNoun('상태 LED 저항'), true);
  assert.equal(failures.length, 0, failures.slice(0, 24).join('\n'));
  // A modifier plus some other noun keeps that object. The LED resistor edit applies.
  for (const prompt of [
    '직렬 연결은 그대로 두고, LED 저항 680Ω',
    '직렬 다이오드는 그대로 두고, LED 저항 680Ω',
    '전류 제한 설정은 그대로 두고, LED 저항 680Ω',
    '전류 제한 퓨즈는 그대로 두고, LED 저항 680Ω',
    '전류 제한 값은 그대로 두고, LED 저항 680Ω',
    '전류 제한기판은 그대로 두고, LED 저항 680Ω'
  ]) assertLedKeepApplies(spec, prompt);
  assertLedKeepApplies(spec, '전류 제한기 기능은 그대로 두고 LED 저항을 680Ω으로 바꿔');
  assertAmbiguousKeep(spec, '직렬 저항은 그대로 두고, LED 저항 680Ω');
  assertAmbiguousKeep(spec, '전류 제한 저항은 그대로 두고, LED 저항 680Ω');
  const seriesCap = classifyExistingProjectRequest('직렬 커패시터는 그대로 두고, LED 저항 680Ω', spec);
  assert.equal(seriesCap.mode, 'refuse', seriesCap.code ?? '');
  assert.equal(seriesCap.code, 'RESISTOR_TARGET_UNCLEAR');
  assert.equal(seriesCap.edit, undefined);
});

// The resistor noun may sit later in the same noun phrase, after the modifier
// and before the 은/는/을/를 that ends the keep. Another noun in that slot
// still names a different object, so the LED resistor edit applies.
test('a resistor noun later in the modifier phrase is RESISTOR_AMBIGUOUS and another noun still applies R3', () => {
  const spec = seriesLedBoard();
  const rows = [
    ['직렬로 연결된 저항은 그대로 두고, LED 저항을 680Ω으로 바꿔', 'ambiguous'],
    ['직렬 연결된 저항은 그대로 두고, LED 저항을 680Ω으로 바꿔', 'ambiguous'],
    ['직렬 연결 저항은 그대로 두고, LED 저항을 680Ω으로 바꿔', 'ambiguous'],
    ['전류 제한하는 저항은 그대로 두고, LED 저항을 680Ω으로 바꿔', 'ambiguous'],
    ['직렬 쪽 저항은 그대로 두고, LED 저항을 680Ω으로 바꿔', 'ambiguous'],
    ['전류 제한 쪽 저항은 그대로 두고, LED 저항을 680Ω으로 바꿔', 'ambiguous'],
    ['직렬로 달린 저항은 그대로 두고, LED 저항을 680Ω으로 바꿔', 'ambiguous'],
    ['직렬 R은 그대로 두고, LED 저항을 680Ω으로 바꿔', 'ambiguous'],
    ['직렬 연결은 그대로 두고, LED 저항을 680Ω으로 바꿔', 'merge'],
    ['전류 제한 설정은 그대로 두고, LED 저항을 680Ω으로 바꿔', 'merge'],
    ['직렬 다이오드는 그대로 두고, LED 저항 680Ω', 'merge'],
    ['전류 제한 퓨즈는 그대로 두고, LED 저항 680Ω', 'merge'],
    ['전류 제한 값은 그대로 두고, LED 저항 680Ω', 'merge'],
    ['전류 제한기판은 그대로 두고, LED 저항 680Ω', 'merge']
  ];
  for (const [prompt, kind] of rows) {
    if (kind === 'ambiguous') assertAmbiguousKeep(spec, prompt);
    else assertLedKeepApplies(spec, prompt);
  }
});

// English alias -> Korean row in LED_RESISTOR_SYNONYMS. A new English row
// fails until this map names it and that Korean alias is in the table.
// "the" and "one" are glue, so the series-one rows pair with 직렬. There is
// no separate Korean bare-name row for that idiom.
const LED_RESISTOR_ENGLISH_TO_KOREAN = Object.freeze({
  'current-limiting': '전류제한',
  'current limiting': '전류 제한',
  'current-limit': '전류 제한',
  'current limiter': '전류 제한기',
  'current limiters': '전류 제한기',
  'indicator resistor': '표시등 저항',
  'series': '직렬',
  'series one': '직렬',
  'the series one': '직렬',
  'LED series': 'LED 직렬',
  'status LED resistor': '상태 LED 저항',
  'led': '엘이디',
  'leds': '엘이디',
  'status': '상태',
  "{led}'s resistor": '{led} 저항',
  'the {led} resistor': '{led} 저항',
  '{led} resistor': '{led} 저항'
});

function isEnglishLedResistorAlias(alias) {
  return /[A-Za-z]/.test(alias) && !/[가-힣]/.test(alias);
}

test('every English LED-resistor alias has a Korean counterpart row', () => {
  const table = new Set(LED_RESISTOR_SYNONYMS);
  const english = LED_RESISTOR_SYNONYMS.filter((alias) => isEnglishLedResistorAlias(alias));
  const missingMap = [];
  const missingKorean = [];
  for (const alias of english) {
    if (!Object.hasOwn(LED_RESISTOR_ENGLISH_TO_KOREAN, alias)) {
      missingMap.push(alias);
      continue;
    }
    const korean = LED_RESISTOR_ENGLISH_TO_KOREAN[alias];
    if (isEnglishLedResistorAlias(korean) || !table.has(korean)) missingKorean.push(`${alias} -> ${korean}`);
  }
  const stale = Object.keys(LED_RESISTOR_ENGLISH_TO_KOREAN).filter((alias) => (
    !table.has(alias) || !isEnglishLedResistorAlias(alias)
  ));
  assert.equal(LED_RESISTOR_ENGLISH_TO_KOREAN['current limiter'], '전류 제한기');
  assert.equal(LED_RESISTOR_ENGLISH_TO_KOREAN['current limiters'], '전류 제한기');
  assert.equal(LED_RESISTOR_ENGLISH_TO_KOREAN['indicator resistor'], '표시등 저항');
  assert.deepEqual(missingMap, []);
  assert.deepEqual(missingKorean, []);
  assert.deepEqual(stale, []);
  assert.equal(english.length, Object.keys(LED_RESISTOR_ENGLISH_TO_KOREAN).length);
});

// 'LED 직렬' and '상태 LED 저항' are the Korean rows for 'LED series' and
// 'status LED resistor'. A keep of either contradicts an LED-resistor edit.
test('Korean LED-series and status-LED-resistor rows are RESISTOR_AMBIGUOUS on keep and apply R3 on edit', () => {
  const spec = seriesLedBoard();
  for (const synonym of ['LED 직렬', '상태 LED 저항']) {
    assert.equal(LED_RESISTOR_SYNONYMS.includes(synonym), true, synonym);
  }
  for (const prompt of [
    'LED 직렬 저항은 그대로 두고 LED 저항 680Ω',
    'LED 직렬 저항은 그대로 두고, LED 저항 680Ω',
    'R4 또는 LED 직렬 저항은 그대로 두고 LED 저항 680Ω',
    '상태 LED 저항은 그대로 두고 LED 저항 680Ω',
    '상태 LED 저항은 그대로 두고, LED 저항 680Ω',
    'R4 또는 상태 LED 저항은 그대로 두고 LED 저항 680Ω',
    '상태 LED 저항은 그대로 두고, LED 저항을 680Ω으로'
  ]) assertAmbiguousKeep(spec, prompt);
  for (const prompt of [
    'LED 직렬 저항 680Ω',
    'LED 직렬 저항을 680Ω으로',
    'LED 직렬 680Ω으로',
    '상태 LED 저항 680Ω으로',
    '상태 LED 저항을 680Ω으로'
  ]) assertLedKeepApplies(spec, prompt);
});

// "the" and "one" are articles and a pronoun in the synonym table. A current
// or voltage on the LED resistor phrase is still the edit, with or without "the".
test('property: a measured LED resistor phrase merges R3 with or without the article', () => {
  const articles = ['the', ''];
  const phrases = ['LED resistor', 'status LED resistor', 'current limiting resistor'];
  const tails = ['for 20mA', 'at 3.3V', '(20mA)'];
  const spec = seriesLedBoard('1k');
  const prompts = [];
  for (const article of articles) {
    for (const phrase of phrases) {
      for (const tail of tails) {
        const head = article === '' ? phrase : `${article} ${phrase}`;
        prompts.push(`set ${head} to 680Ω ${tail}`);
      }
    }
  }
  const failures = [];
  const r3 = componentValue(spec, 'R3');
  for (const prompt of prompts) {
    const before = structuredClone(spec);
    const decision = classifyExistingProjectRequest(prompt, spec);
    if (decision.mode !== 'merge' || decision.edit?.ref !== 'R3' || decision.edit?.ohms !== 680 || decision.edit?.label !== '680Ω') {
      failures.push(`${prompt} => ${decision.mode} ${decision.code ?? ''} ${decision.edit?.ref ?? ''} ${decision.edit?.ohms ?? ''} ${decision.edit?.label ?? ''}`);
    }
    if (componentValue(spec, 'R3') !== r3 || JSON.stringify(spec) !== JSON.stringify(before)) {
      failures.push(`${prompt} mutated`);
    }
    if (decision.edit) {
      const next = applyExistingProjectEdit(spec, decision.edit);
      if (componentValue(next, 'R3') !== '680Ω') failures.push(`${prompt} applied ${componentValue(next, 'R3')}`);
      if (componentValue(next, 'R4') !== '4.7k') failures.push(`${prompt} R4 ${componentValue(next, 'R4')}`);
    }
  }
  const keep = classifyExistingProjectRequest('keep the series one and set R3 to 680Ω', spec);
  if (keep.mode !== 'refuse' || keep.code !== 'RESISTOR_AMBIGUOUS' || keep.edit != null) {
    failures.push(`keep the series one and set R3 to 680Ω => ${keep.mode} ${keep.code ?? ''} ${keep.edit?.ref ?? ''}`);
  }
  const series = classifyExistingProjectRequest('set the series one to 680Ω', spec);
  if (series.mode !== 'merge' || series.edit?.ref !== 'R3' || series.edit?.ohms !== 680 || series.edit?.label !== '680Ω') {
    failures.push(`set the series one to 680Ω => ${series.mode} ${series.code ?? ''} ${series.edit?.ref ?? ''} ${series.edit?.ohms ?? ''}`);
  }
  assert.equal(prompts.length, articles.length * phrases.length * tails.length);
  assert.deepEqual(failures, []);
});

// Specs match probe40.mjs. D1 stands in for the status LED only when the spec
// has no D-designator part. A Schottky or power LED already on D1 is not that part.
function probeBoard(kind) {
  const comps = [
    { ref: 'R1', libId: 'Device:R', value: '5.1k' },
    { ref: 'R3', libId: 'ChatPCB:LED_RESISTOR', value: '1k' },
    { ref: 'R4', libId: 'ChatPCB:I2C_PULLUP', value: '4.7k' }
  ];
  const parts = [
    { ref: 'R1', role: 'usb-c-cc1-pulldown', value: '5.1k' },
    { ref: 'R3', role: 'status-led-resistor', value: '1k' },
    { ref: 'R4', role: 'i2c-scl-pullup', value: '4.7k' }
  ];
  const per = [{ kind: 'status-led' }, { kind: 'status-led-resistor', value: '1k' }];
  if (kind === 'noled') {
    return {
      mcu: { family: 'STM32' },
      schematic: { components: [comps[0], comps[2]] },
      peripherals: [{ kind: 'status-led' }],
      boardProfile: { productionParts: [parts[0], parts[2]] }
    };
  }
  if (kind === 'd1led') {
    comps.push({ ref: 'D1', libId: 'ChatPCB:STATUS_LED', value: 'STATUS_LED' });
    parts.push({ ref: 'D1', role: 'status-led' });
  }
  if (kind === 'd2status') {
    comps.push(
      { ref: 'D1', libId: 'Device:LED', value: 'PWR_LED' },
      { ref: 'D2', libId: 'ChatPCB:STATUS_LED', value: 'STATUS_LED' },
      { ref: 'R5', libId: 'Device:R', value: '2.2k' }
    );
    parts.push(
      { ref: 'D1', role: 'power-led' },
      { ref: 'D2', role: 'status-led' },
      { ref: 'R5', role: 'power-led-resistor', value: '2.2k' }
    );
  }
  if (kind === 'd1schottky') {
    comps.push({ ref: 'D1', libId: 'Device:D_Schottky', value: 'SS14' });
    parts.push({ ref: 'D1', role: 'reverse-polarity-diode' });
  }
  if (kind === 'multiled') {
    comps.push(
      { ref: 'D1', libId: 'ChatPCB:STATUS_LED', value: 'STATUS_LED' },
      { ref: 'D2', libId: 'Device:LED', value: 'PWR_LED' },
      { ref: 'R5', libId: 'Device:R', value: '2.2k' }
    );
    parts.push(
      { ref: 'D1', role: 'status-led' },
      { ref: 'D2', role: 'power-led' },
      { ref: 'R5', role: 'power-led-resistor', value: '2.2k' }
    );
  }
  return {
    mcu: { family: 'STM32' },
    schematic: { components: comps },
    peripherals: per,
    boardProfile: { productionParts: parts }
  };
}

test('D1 aliases the LED resistor only when the spec has no D-designator part', () => {
  const d1Edits = [
    'D1 저항 680Ω으로',
    "set D1's resistor to 680Ω",
    'D1저항 680Ω'
  ];
  const rows = [
    // No D-designator at all: D1 is still the status-LED substitute.
    ['base', 'D1 저항 680Ω으로', 'R3'],
    ['base', "set D1's resistor to 680Ω", 'R3'],
    ['base', "keep D1's resistor and set R3 to 680Ω", 'RESISTOR_AMBIGUOUS'],
    ['base', 'D1저항 680Ω', 'R3'],
    ['base', 'D2 저항 680Ω으로', 'RESISTOR_REF_NOT_FOUND'],
    ['base', 'set the current limiter to 680Ω', 'R3'],
    ['base', 'set the indicator resistor to 680Ω', 'R3'],
    // D1 is the status LED.
    ['d1led', 'D1 저항 680Ω으로', 'R3'],
    ['d1led', "set D1's resistor to 680Ω", 'R3'],
    ['d1led', 'set D1 resistor to 680Ω', 'R3'],
    ['d1led', 'D1저항 680Ω', 'R3'],
    ['d1led', 'D2 저항 680Ω으로', 'RESISTOR_REF_NOT_FOUND'],
    ['d1led', 'set the current limiter to 680Ω', 'R3'],
    ['d1led', 'set the indicator resistor to 680Ω', 'R3'],
    // D2 is the status LED. D1 is a power LED, so it is not the alias.
    ['d2status', 'D1 저항 680Ω으로', 'RESISTOR_REF_UNSUPPORTED'],
    ['d2status', "set D1's resistor to 680Ω", 'RESISTOR_REF_UNSUPPORTED'],
    ['d2status', 'D1저항 680Ω', 'RESISTOR_REF_UNSUPPORTED'],
    ['d2status', 'D2 저항 680Ω으로', 'R3'],
    ['d2status', "set D2's resistor to 680Ω", 'R3'],
    ['d2status', 'set the current limiter to 680Ω', 'R3'],
    ['d2status', 'set the indicator resistor to 680Ω', 'R3'],
    // D1 is a Schottky diode. Naming it must not edit R3.
    ['d1schottky', 'D1 저항 680Ω으로', 'RESISTOR_REF_UNSUPPORTED'],
    ['d1schottky', "set D1's resistor to 680Ω", 'RESISTOR_REF_UNSUPPORTED'],
    ['d1schottky', 'D1저항 680Ω', 'RESISTOR_REF_UNSUPPORTED'],
    ['d1schottky', 'D2 저항 680Ω으로', 'RESISTOR_REF_NOT_FOUND'],
    ['d1schottky', 'set the current limiter to 680Ω', 'R3'],
    ['d1schottky', 'set the indicator resistor to 680Ω', 'R3'],
    // D1 is the status LED. D2 is a power LED.
    ['multiled', 'D1 저항 680Ω으로', 'R3'],
    ['multiled', "set D1's resistor to 680Ω", 'R3'],
    ['multiled', 'D1저항 680Ω', 'R3'],
    ['multiled', 'D2 저항 680Ω으로', 'RESISTOR_REF_UNSUPPORTED'],
    ['multiled', "set D2's resistor to 680Ω", 'RESISTOR_REF_UNSUPPORTED'],
    ['multiled', 'set the current limiter to 680Ω', 'R3'],
    ['multiled', 'set the indicator resistor to 680Ω', 'R3'],
    // No LED parts and no series resistor. The alias must not add one.
    ['noled', 'D1 저항 680Ω으로', 'RESISTOR_REF_NOT_FOUND'],
    ['noled', "set D1's resistor to 680Ω", 'RESISTOR_REF_UNSUPPORTED'],
    ['noled', 'D1저항 680Ω', 'RESISTOR_REF_NOT_FOUND'],
    ['noled', 'D2 저항 680Ω으로', 'RESISTOR_REF_NOT_FOUND'],
    ['noled', 'set the current limiter to 680Ω', 'RESISTOR_TARGET_UNCLEAR'],
    ['noled', 'set the indicator resistor to 680Ω', 'RESISTOR_TARGET_UNCLEAR']
  ];
  const failures = [];
  for (const [kind, prompt, expectCode] of rows) {
    const spec = probeBoard(kind);
    const before = structuredClone(spec);
    const r3 = componentValue(spec, 'R3');
    const decision = classifyExistingProjectRequest(prompt, spec);
    const got = decision.mode === 'merge' ? decision.edit?.ref : decision.code;
    if (got !== expectCode || (expectCode === 'R3' && (decision.edit?.ohms !== 680 || decision.edit?.label !== '680Ω'))) {
      failures.push(`${kind} ${prompt} => ${decision.mode} ${decision.code ?? ''} ${decision.edit?.ref ?? ''} ${decision.edit?.label ?? ''}`);
    }
    if (JSON.stringify(spec) !== JSON.stringify(before)) failures.push(`${kind} ${prompt} mutated`);
    if (componentValue(spec, 'R3') !== r3) failures.push(`${kind} ${prompt} R3 changed before apply`);
    if (decision.mode === 'refuse') {
      if (decision.edit != null) failures.push(`${kind} ${prompt} edit set`);
      if (!blocksBeforeProvider(prompt, decision)) failures.push(`${kind} ${prompt} reached provider`);
    }
    if (decision.mode === 'merge' && decision.edit) {
      const next = applyExistingProjectEdit(spec, decision.edit);
      if (componentValue(next, 'R3') !== '680Ω') failures.push(`${kind} ${prompt} applied ${componentValue(next, 'R3')}`);
      if (componentValue(next, 'R4') !== '4.7k') failures.push(`${kind} ${prompt} R4 ${componentValue(next, 'R4')}`);
      if (componentValue(spec, 'R5') !== undefined && componentValue(next, 'R5') !== '2.2k') {
        failures.push(`${kind} ${prompt} R5 ${componentValue(next, 'R5')}`);
      }
    }
    if (kind === 'd1schottky' && d1Edits.includes(prompt)) {
      if (decision.code !== 'RESISTOR_REF_UNSUPPORTED' || componentValue(spec, 'R3') !== '1k') {
        failures.push(`${kind} ${prompt} must stay RESISTOR_REF_UNSUPPORTED with R3 unchanged`);
      }
      if (componentValue(spec, 'D1') !== 'SS14') failures.push(`${kind} ${prompt} D1 changed`);
    }
    if (kind === 'noled' && componentValue(spec, 'R3') !== undefined) {
      failures.push(`${kind} ${prompt} added R3`);
    }
  }
  assert.deepEqual(failures, []);
});
