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
  resistorValueOutOfRangeMessage,
  resistorValueUnchangedMessage
} from '../src/workflow/existing-project-edit.js';
import { assessRequestCoverage, KEEP_CUES, LED_RESISTOR_SYNONYMS, vocabularyAllowLists } from '../src/workflow/resistor-vocabulary.js';

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
    '전류 제한용'
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
  ['LED 저항은 680Ω으로 바꾸고 R4는 4.7k로 유지', 'RESISTOR_REF_UNSUPPORTED'],
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
