import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { dispatchToolCall } from '../src/runtime/agent-daemon.js';
import { createPatchApprovalRegistry } from '../src/runtime/patch-approval-registry.js';
import { createProjectMutexRegistry } from '../src/runtime/project-mutex-registry.js';
import { createTransactionJournal } from '../src/runtime/transaction-journal.js';
import { generateMcuPeripheralProject } from '../src/workflow/generate-mcu-project.js';
import {
  applyExistingProjectEdit,
  appliesBeforeProvider,
  blocksBeforeProvider,
  classifyExistingProjectRequest
} from '../src/workflow/existing-project-edit.js';

const STM32_USER_PROMPT = 'Prototype STM32 USB-C 5V sensor board with 3.3V 500mA regulator, I2C sensor connector, UART debug header, SWD, reset button, and status LED.';

function seriesSpec(value = '1k') {
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

function providerCalled(prompt, decision) {
  return appliesBeforeProvider(prompt, decision) === false && blocksBeforeProvider(prompt, decision) === false;
}

const POLITE = [
  ['LED 저항을 470옴으로 변경해 주세요', 470],
  ['LED 저항 10k로 바꿔 주세요', 10000],
  ['LED 저항 680Ω으로 설정해줘', 680],
  ['LED 저항 680Ω으로 설정해 주세요', 680],
  ['LED 저항 680Ω으로 부탁해', 680],
  ['LED 저항 680Ω으로 부탁해요', 680],
  ['set LED resistor = 680Ω', 680],
  ['LED resistor = 680Ω', 680],
  ['LED resistor to 680Ω if possible', 680],
  ['if you can, set the LED resistor to 680Ω', 680],
  ['change the LED resistor to 680Ω instead of 1k', 680],
  ['make the LED resistor 680Ω instead of 1k', 680]
];

// Real requests and the refusals next to them. outcome is the code the
// classifier must return. apply rows also name the ohm value that lands on R3.
// provider is whether the daemon may call the model.
const CORPUS = [
  ...POLITE.map(([prompt, ohms]) => ({ prompt, outcome: 'apply', ohms, provider: false })),
  { prompt: 'LED 저항 680Ω으로 바꿔줘', outcome: 'apply', ohms: 680, provider: false },
  { prompt: '변경해줘 LED 저항 680Ω', outcome: 'apply', ohms: 680, provider: false },
  { prompt: 'please set the LED resistor to 470Ω', outcome: 'apply', ohms: 470, provider: false },
  { prompt: 'change the LED resistor from 1k to 680Ω', outcome: 'apply', ohms: 680, provider: false },
  { prompt: 'LED 저항을 1k에서 680Ω으로', outcome: 'apply', ohms: 680, provider: false },
  { prompt: 'keep the I2C pull-up resistors, set the LED resistor to 680Ω', outcome: 'apply', ohms: 680, provider: false },
  { prompt: 'keep the I2C pull-up resistors and set the LED resistor to 680Ω', outcome: 'apply', ohms: 680, provider: false },
  { prompt: 'I2C 풀업 저항은 그대로 두고 LED 저항 680Ω으로', outcome: 'apply', ohms: 680, provider: false },
  { prompt: 'R4는 건드리지 말고 LED 저항 680Ω으로', outcome: 'apply', ohms: 680, provider: false },
  { prompt: '풀업은 그대로 두고 LED 저항 680Ω으로 바꿔줘', outcome: 'apply', ohms: 680, provider: false },
  { prompt: 'keep the pull-ups, change the LED resistor to 680Ω', outcome: 'apply', ohms: 680, provider: false },
  { prompt: 'LED 저항 680옴으로. I2C 저항은 그대로', outcome: 'apply', ohms: 680, provider: false },
  { prompt: '가능하면 LED 저항 680Ω으로 바꿔줘', outcome: 'apply', ohms: 680, provider: false },
  { prompt: 'the LED resistor should be 680Ω', outcome: 'apply', ohms: 680, provider: false },
  { prompt: 'LED resistor to 2.2k', outcome: 'apply', ohms: 2200, provider: false },
  { prompt: 'without removing the I2C pull-up resistors, set the LED resistor to 680Ω', outcome: 'apply', ohms: 680, provider: false },
  { prompt: 'LED resistor to 2.2k, cable to 1m', outcome: 'unclear', provider: false },
  { prompt: 'change R3 to 680Ω and set the cable to 1m', outcome: 'unclear', provider: false },
  { prompt: 'keep I2C, set LED resistor 680 ohm', outcome: 'unclear', provider: false },
  { prompt: 'without removing I2C, set the LED resistor to 680Ω', outcome: 'unclear', provider: false },
  { prompt: 'set the LED resistor to 680Ω without removing I2C', outcome: 'unclear', provider: false },
  { prompt: 'leave I2C alone and set the LED resistor to 680Ω', outcome: 'unclear', provider: false },
  { prompt: "don't touch I2C, LED resistor to 680Ω", outcome: 'unclear', provider: false },
  { prompt: 'I2C 지우지 말고 LED 저항 680Ω', outcome: 'unclear', provider: false },
  { prompt: 'I2C 지우지 말고 LED 저항 680Ω으로', outcome: 'unclear', provider: false },
  { prompt: 'I2C는 삭제하지 마 LED 저항 680Ω으로', outcome: 'unclear', provider: false },
  { prompt: 'I2C는 그대로 두고 LED 저항 680옴으로', outcome: 'unclear', provider: false },
  { prompt: 'I2C는 놔두고 LED 저항 680Ω으로', outcome: 'unclear', provider: false },
  { prompt: 'LED 저항 680옴으로. I2C는 그대로', outcome: 'unclear', provider: false },
  { prompt: 'change LED resistor to 680 ohm without removing I2C', outcome: 'unclear', provider: false },
  { prompt: 'do not remove I2C and set LED resistor to 680Ω', outcome: 'unclear', provider: false },
  { prompt: 'LED 저항 삭제하지 말고 680Ω으로', outcome: 'unclear', provider: false },
  { prompt: 'LED 저항은 그대로 두고 680Ω으로', outcome: 'negated', provider: false },
  { prompt: 'change the pull-up to 2.2k', outcome: 'unsupported', provider: false },
  { prompt: "don't touch R4, set the LED resistor to 680Ω", outcome: 'apply', ohms: 680, provider: false },
  { prompt: '풀업을 그대로 두지 말고 2.2k로', outcome: 'unsupported', provider: false },
  { prompt: 'do not change the LED resistor to 680Ω', outcome: 'negated', provider: false },
  { prompt: 'LED resistor to 680Ω or 1k', outcome: 'ambiguous', provider: false },
  { prompt: 'LED 저항을 680Ω으로 바꾸지 말고', outcome: 'negated', provider: false },
  { prompt: 'why not change the LED resistor to 680Ω?', outcome: 'provider', provider: true },
  { prompt: 'should I change the LED resistor to 680Ω?', outcome: 'provider', provider: true },
  { prompt: 'LED 저항 680Ω으로 바꿔야 할까?', outcome: 'provider', provider: true }
];

const OUTCOME_CODE = {
  unclear: 'RESISTOR_TARGET_UNCLEAR',
  unsupported: 'RESISTOR_REF_UNSUPPORTED',
  ambiguous: 'RESISTOR_VALUE_AMBIGUOUS',
  negated: 'RESISTOR_AMBIGUOUS'
};

function assertCorpusRow(spec, row) {
  const decision = classifyExistingProjectRequest(row.prompt, spec);
  assert.equal(providerCalled(row.prompt, decision), row.provider, `${row.prompt} provider`);
  if (row.outcome === 'apply') {
    assert.equal(decision.mode, 'merge', `${row.prompt} ${decision.code ?? ''} ${decision.message ?? ''}`);
    assert.equal(decision.code, undefined, row.prompt);
    assert.equal(decision.edit?.kind, 'resistor', row.prompt);
    assert.equal(decision.edit?.ohms, row.ohms, row.prompt);
    assert.equal(decision.edit?.ref, 'R3', row.prompt);
    assert.equal(appliesBeforeProvider(row.prompt, decision), true, row.prompt);
    assert.equal(blocksBeforeProvider(row.prompt, decision), false, row.prompt);
    const next = applyExistingProjectEdit(spec, decision.edit);
    assert.equal(componentValue(next, 'R3'), decision.edit.label, row.prompt);
    assert.equal(componentValue(next, 'R1'), '5.1k', row.prompt);
    assert.equal(componentValue(next, 'R4'), '4.7k', row.prompt);
    assert.equal(componentValue(spec, 'R3'), '1k', row.prompt);
    return;
  }
  assert.equal(decision.mode, 'refuse', `${row.prompt} ${decision.mode}`);
  assert.equal(decision.edit, undefined, row.prompt);
  assert.equal(appliesBeforeProvider(row.prompt, decision), false, row.prompt);
  assert.equal(componentValue(spec, 'R3'), '1k', row.prompt);
  assert.equal(componentValue(spec, 'R4'), '4.7k', row.prompt);
  if (row.outcome === 'provider') {
    assert.equal(decision.code, undefined, `${row.prompt} ${decision.code ?? ''}`);
    assert.equal(blocksBeforeProvider(row.prompt, decision), false, row.prompt);
    return;
  }
  assert.equal(decision.code, OUTCOME_CODE[row.outcome], `${row.prompt} ${decision.code ?? ''}`);
  assert.equal(blocksBeforeProvider(row.prompt, decision), true, row.prompt);
}

test("common polite edit forms ('변경해 주세요', '바꿔 주세요', '설정해줘', '= 680Ω', 'instead of 1k', 'if possible') apply R3 only", () => {
  const spec = seriesSpec('1k');
  for (const [prompt, ohms] of POLITE) {
    assertCorpusRow(spec, { prompt, outcome: 'apply', ohms, provider: false });
  }
});

test('real usage corpus classifies Korean and English resistor edits', () => {
  assert.ok(CORPUS.length >= 40, `corpus has ${CORPUS.length} rows`);
  const korean = CORPUS.filter((row) => /[가-힣]/.test(row.prompt));
  const english = CORPUS.filter((row) => !/[가-힣]/.test(row.prompt));
  assert.ok(korean.length >= 10, `korean rows ${korean.length}`);
  assert.ok(english.length >= 10, `english rows ${english.length}`);
  assert.ok(CORPUS.some((row) => row.outcome === 'apply'));
  assert.ok(CORPUS.some((row) => row.outcome !== 'apply'));
  const spec = seriesSpec('1k');
  for (const row of CORPUS) assertCorpusRow(spec, row);
});

function referenceValues(schematic) {
  const values = {};
  for (const match of schematic.matchAll(/\(property "Reference" "([A-Za-z]{1,3}\d+)"[\s\S]*?\(property "Value" "([^"]*)"/g)) {
    values[match[1]] = match[2];
  }
  return values;
}

function spiceWithoutLed(spice) {
  return spice.split('\n').filter((line) => !/^RLED\b/.test(line)).join('\n');
}

async function transactionServices() {
  const stateRoot = await mkdtemp(path.join(tmpdir(), 'chatpcb-corpus-journal-'));
  return {
    stateRoot,
    patchApprovalRegistry: createPatchApprovalRegistry(),
    projectMutexRegistry: createProjectMutexRegistry(),
    transactionJournal: createTransactionJournal({ stateRoot }),
    verifyAppliedProjectImpl: async () => ({
      erc: { ok: true, skipped: false, executed: true, erc: { errorCount: 0, warningCount: 0 } },
      drc: { ok: true, skipped: true }
    }),
    validateProjectImpl: async () => ({ ok: true, skipped: false, erc: { errorCount: 0, warningCount: 0, byType: {} } }),
    validateBoardImpl: async () => ({ ok: true, skipped: false, executed: true, violations: [], unconnectedItems: [] })
  };
}

function codexNoPatch() {
  return {
    checkProviderAvailabilityImpl: async ({ provider }) => ({
      provider,
      command: 'codex',
      available: true,
      status: 'available'
    }),
    runProviderProcessImpl: async () => ({ exitCode: 0, stderr: '', events: [] })
  };
}

test('real usage corpus end to end applies or blocks without calling the provider', async () => {
  const services = await transactionServices();
  const projectDir = await mkdtemp(path.join(tmpdir(), 'chatpcb-corpus-'));
  const generated = await generateMcuPeripheralProject({
    projectDir,
    prompt: STM32_USER_PROMPT,
    projectName: 'stm32_i2c'
  });
  let calls = 0;
  const counting = {
    checkProviderAvailabilityImpl: async ({ provider }) => ({
      provider,
      command: 'codex',
      available: true,
      status: 'available'
    }),
    runProviderProcessImpl: async () => {
      calls += 1;
      return { exitCode: 0, stderr: '', events: [] };
    }
  };
  try {
    const seeded = await dispatchToolCall({
      id: 'call_corpus_seed',
      name: 'project.request',
      args: { provider: 'codex', projectDir, prompt: 'set the LED resistor to 1kΩ' }
    }, { ...services, ...codexNoPatch() });
    assert.equal(seeded.ok, true, seeded.error?.message ?? '');
    const seededOk = await dispatchToolCall({
      name: 'schematic.patch',
      args: { projectDir, approved: true, patchId: seeded.result.patchId }
    }, services);
    assert.equal(seededOk.result?.applied, true, JSON.stringify(seededOk.result?.reason ?? seededOk.error));
    const before = {
      schematic: await readFile(generated.files.schematic, 'utf8'),
      spice: await readFile(generated.files.spice, 'utf8'),
      spec: await readFile(generated.files.spec, 'utf8'),
      board: generated.files.board ? await readFile(generated.files.board, 'utf8') : null
    };
    assert.equal(referenceValues(before.schematic).R3, '1k');
    const restore = async () => {
      await writeFile(generated.files.schematic, before.schematic);
      await writeFile(generated.files.spice, before.spice);
      await writeFile(generated.files.spec, before.spec);
      if (generated.files.board && before.board != null) await writeFile(generated.files.board, before.board);
    };

    const applies = [
      ['LED 저항 680Ω으로 설정해줘', '680Ω', '680'],
      ['make the LED resistor 680Ω instead of 1k', '680Ω', '680']
    ];
    for (const [index, [prompt, label, ohms]] of applies.entries()) {
      calls = 0;
      await restore();
      const preview = await dispatchToolCall({
        id: `call_corpus_apply_${index}`,
        name: 'project.request',
        args: { provider: 'codex', projectDir, prompt }
      }, { ...services, ...counting });
      assert.equal(calls, 0, prompt);
      assert.equal(preview.ok, true, `${prompt} ${preview.error?.code ?? ''} ${preview.error?.message ?? ''}`);
      const approved = await dispatchToolCall({
        name: 'schematic.patch',
        args: { projectDir, approved: true, patchId: preview.result.patchId }
      }, services);
      assert.equal(approved.result?.applied, true, `${prompt} ${JSON.stringify(approved.result?.reason)}`);
      const schematic = await readFile(generated.files.schematic, 'utf8');
      const spice = await readFile(generated.files.spice, 'utf8');
      const next = referenceValues(schematic);
      const prev = referenceValues(before.schematic);
      assert.equal(next.R3, label, prompt);
      for (const ref of Object.keys(prev)) {
        if (ref === 'R3') continue;
        assert.equal(next[ref], prev[ref], `${prompt} ${ref}`);
      }
      assert.match(spice, new RegExp(`^RLED\\s+\\S+\\s+\\S+\\s+${ohms}$`, 'm'), prompt);
      assert.equal(spiceWithoutLed(spice), spiceWithoutLed(before.spice), prompt);
    }

    const blocked = [
      ['keep I2C, set LED resistor 680 ohm', 'RESISTOR_TARGET_UNCLEAR'],
      ['LED resistor to 2.2k, cable to 1m', 'RESISTOR_TARGET_UNCLEAR']
    ];
    for (const [prompt, code] of blocked) {
      calls = 0;
      await restore();
      const preview = await dispatchToolCall({
        id: `call_corpus_block_${prompt.length}`,
        name: 'project.request',
        args: { provider: 'codex', projectDir, prompt }
      }, { ...services, ...counting });
      assert.equal(calls, 0, prompt);
      assert.equal(preview.ok, false, prompt);
      assert.equal(preview.error?.code, code, `${prompt} ${preview.error?.code ?? ''} ${preview.error?.message ?? ''}`);
      assert.equal(await readFile(generated.files.schematic, 'utf8'), before.schematic, prompt);
      assert.equal(await readFile(generated.files.spice, 'utf8'), before.spice, prompt);
    }
  } finally {
    services.patchApprovalRegistry.disposeAll();
    await rm(projectDir, { force: true, recursive: true });
    await rm(services.stateRoot, { force: true, recursive: true });
  }
});
