import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { renderSpiceFixture, spiceResistorOhms } from '../src/kicad/project-generator.js';
import { normalizeCircuitSpec, parseDiscreteLedRequest } from '../src/runtime/circuit-spec.js';
import { generateMcuPeripheralProject, writeGeneratedProject } from '../src/workflow/generate-mcu-project.js';

test('spiceResistorOhms parses RKM and SPICE suffixes into ohms', () => {
  const cases = [
    ['4k7', '4700'],
    ['4K7', '4700'],
    ['4.7k', '4700'],
    ['4.7kΩ', '4700'],
    ['1M', '1000000'],
    ['1meg', '1000000'],
    ['1MEG', '1000000'],
    ['1Meg', '1000000'],
    ['1 Meg', '1000000'],
    ['4M7', '4700000'],
    ['1.5 ohm', '1.5'],
    ['4.75k', '4750'],
    ['1.05M', '1050000'],
    ['330', '330'],
    ['1', '1'],
    ['1R', '1'],
    ['1Ω', '1'],
    ['10M', '10000000'],
    ['10MΩ', '10000000'],
    ['4.99k', '4990'],
    ['330R', '330'],
    ['330Ω', '330'],
    ['330 ohm', '330'],
    ['1R5', '1.5'],
    ['2M2', '2200000'],
    ['10', '10'],
    ['680Ω', '680'],
    ['4700 ohm', '4700'],
    ['10ohms', '10'],
    ['1k', '1000']
  ];

  for (const [input, ohms] of cases) {
    assert.equal(spiceResistorOhms(input), ohms, input);
  }
});

test('spiceResistorOhms rejects unparseable and non-positive values', () => {
  for (const input of [
    '330Ω±5%', '1/4W 330', '-10', '10kk', 'abc', '1,000', '0', '',
    '1m', '10m', '2m2', '4m7', '4.7m', '1000m',
    '1.000', '1.000 ohm', '4.700 ohm', '1.000Ω', '1.000k', '1.000옴',
    'R47', '1p', '100f', '1u', '10n', '1G', '1T', '0R', '1e3'
  ]) {
    assert.equal(spiceResistorOhms(input), null, input);
  }
});

function statusLedSpec(value) {
  return {
    title: 'invalid resistor',
    peripherals: [
      { kind: 'status-led' },
      { kind: 'status-led-resistor', value }
    ]
  };
}

test('renderSpiceFixture fails the SPICE netlist when the status LED resistor is invalid', () => {
  for (const value of ['330Ω±5%', '1/4W 330', '-10', '10kk', 'abc', '1,000', '0']) {
    assert.throws(() => renderSpiceFixture(statusLedSpec(value)), (error) => {
      assert.equal(error.code, 'SPICE_RESISTOR_INVALID');
      assert.match(error.message, /SPICE/);
      assert.match(error.message, /positive resistance/);
      assert.equal(error.message.includes('led 1000'), false, value);
      return true;
    }, value);
  }
});

test('renderSpiceFixture writes the parsed status LED resistance', () => {
  assert.match(renderSpiceFixture(statusLedSpec('4k7')), /^RLED v3v3 led 4700$/m);
  assert.match(renderSpiceFixture(statusLedSpec('4.99k')), /^RLED v3v3 led 4990$/m);
  assert.match(renderSpiceFixture(statusLedSpec('330')), /^RLED v3v3 led 330$/m);
  assert.match(renderSpiceFixture(statusLedSpec('1')), /^RLED v3v3 led 1$/m);
  assert.match(renderSpiceFixture(statusLedSpec('10M')), /^RLED v3v3 led 10000000$/m);
});

test('renderSpiceFixture rejects status LED resistance outside 1Ω to 10MΩ', () => {
  for (const value of ['10m', '2m2', '4m7', '4.7m', '1000m', 'R47', '1p', '100f', '1u', '10n', '1G', '1T']) {
    assert.throws(() => renderSpiceFixture(statusLedSpec(value)), (error) => {
      assert.equal(error.code, 'SPICE_RESISTOR_INVALID', value);
      assert.equal(error.message.includes('led 0'), false, value);
      return true;
    }, value);
  }
});

function projectSpec(value) {
  const spec = normalizeCircuitSpec('STM32 board with a status LED');
  spec.peripherals.push({ kind: 'status-led-resistor', value });
  return spec;
}

test('SPICE_RESISTOR_INVALID leaves project files uncreated and unchanged', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'chatpcb-spice-invalid-'));
  const fresh = path.join(parent, 'fresh');
  const existing = path.join(parent, 'existing');
  await mkdir(existing);
  await writeFile(path.join(existing, 'sentinel.txt'), 'keep-me');
  try {
    for (const projectDir of [fresh, existing]) {
      await assert.rejects(
        () => writeGeneratedProject({ projectDir, spec: projectSpec('abc'), projectName: 'bad_spice' }),
        (error) => {
          assert.equal(error.code, 'SPICE_RESISTOR_INVALID');
          return true;
        }
      );
    }
    assert.equal(existsSync(fresh), false);
    assert.deepEqual(await readdir(existing), ['sentinel.txt']);
    assert.equal(await readFile(path.join(existing, 'sentinel.txt'), 'utf8'), 'keep-me');
  } finally {
    await rm(parent, { force: true, recursive: true });
  }
});

test('a length or a time next to a status LED is not the series resistor', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'chatpcb-spice-length-'));
  const prompts = [
    'RP2040 board with status LED and a 1 m cable',
    'RP2040 board with status LED blinking every 5m',
    'RP2040 board with status LED and a 2m long wire',
    'RP2040 board with status LED, blink every 500ms',
    'RP2040 board with status LED mounted 2 m high',
    'RP2040 board with status LED, 상태 LED는 5m마다 깜빡임'
  ];
  try {
    const plain = await generateMcuPeripheralProject({
      projectDir: path.join(parent, 'plain'),
      prompt: 'RP2040 board with status LED',
      projectName: 'plain'
    });
    const plainValue = plain.spec.peripherals.find((item) => item.kind === 'status-led-resistor')?.value;
    for (const [index, prompt] of prompts.entries()) {
      const generated = await generateMcuPeripheralProject({
        projectDir: path.join(parent, `p${index}`),
        prompt,
        projectName: `p${index}`
      });
      const value = generated.spec.peripherals.find((item) => item.kind === 'status-led-resistor')?.value;
      assert.equal(value, plainValue, prompt);
    }
    await assert.rejects(
      () => generateMcuPeripheralProject({
        projectDir: path.join(parent, 'bad'),
        prompt: 'RP2040 board with status LED and a 4m7 resistor',
        projectName: 'bad'
      }),
      (error) => {
        assert.equal(error.code, 'SPICE_RESISTOR_INVALID');
        return true;
      }
    );
  } finally {
    await rm(parent, { force: true, recursive: true });
  }
});

test('a cable length edit target still generates the 1k LED resistor', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'chatpcb-spice-len-object-'));
  const prompts = [
    'RP2040 board with status LED, LED resistor 1kΩ, cable length to 1m',
    'RP2040 보드, 상태 LED 저항 1kΩ, 케이블 길이 1m로',
    'RP2040 board with status LED (1kΩ resistor), wire -> 2m',
    'RP2040 보드, 상태 LED 저항 1kΩ으로 하고 전선은 2m로'
  ];
  try {
    for (const [index, prompt] of prompts.entries()) {
      const generated = await generateMcuPeripheralProject({
        projectDir: path.join(parent, `p${index}`),
        prompt,
        projectName: `p${index}`
      });
      const spice = await readFile(generated.files.spice, 'utf8');
      const led = (spice.match(/^RLED\s+\S+\s+\S+\s+(\S+)/m) ?? [])[1];
      assert.equal(led, '1000', prompt);
    }
  } finally {
    await rm(parent, { force: true, recursive: true });
  }
});

test('a milli value outside the LED resistor is not the series resistor', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'chatpcb-spice-shunt-'));
  try {
    const plain = await generateMcuPeripheralProject({
      projectDir: path.join(parent, 'plain'),
      prompt: 'RP2040 board with status LED',
      projectName: 'plain'
    });
    const plainSpice = await readFile(plain.files.spice, 'utf8');
    const plainLed = (plainSpice.match(/^RLED\s+\S+\s+\S+\s+(\S+)/m) ?? [])[1];
    const prompts = [
      '4.7mΩ shunt',
      '10mΩ sense resistor',
      'RP2040 board with status LED and a 4.7mΩ shunt',
      'STM32 board with status LED and a 10mΩ sense resistor',
      'RP2040 board with status LED, LED resistor 470Ω, 2 m cable',
      'RP2040 보드, 상태 LED 저항 1kΩ, 케이블 1m'
    ];
    for (const [index, prompt] of prompts.entries()) {
      const generated = await generateMcuPeripheralProject({
        projectDir: path.join(parent, `p${index}`),
        prompt,
        projectName: `p${index}`
      });
      const spice = await readFile(generated.files.spice, 'utf8');
      if (/status LED|상태 LED/.test(prompt)) {
        const led = (spice.match(/^RLED\s+\S+\s+\S+\s+(\S+)/m) ?? [])[1];
        assert.equal(led, plainLed, prompt);
      } else {
        assert.equal(/SPICE_RESISTOR_INVALID/.test(spice), false, prompt);
      }
    }
    await assert.rejects(
      () => generateMcuPeripheralProject({
        projectDir: path.join(parent, 'bad'),
        prompt: 'STM32 board with a status LED and a 4m7 resistor',
        projectName: 'bad'
      }),
      (error) => error.code === 'SPICE_RESISTOR_INVALID'
    );
    for (const prompt of ['LED 4.7mΩ', 'LED resistor 4.7mΩ']) {
      const led = parseDiscreteLedRequest(prompt);
      assert.equal(led.refused, true, prompt);
    }
    const shunt = parseDiscreteLedRequest('LED 4.7mΩ shunt');
    assert.equal(shunt.refused, false);
    assert.equal(shunt.resistanceOhms > 0, true);
  } finally {
    await rm(parent, { force: true, recursive: true });
  }
});

test('generateMcuPeripheralProject creates the directory only after SPICE validation', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'chatpcb-spice-mkdir-'));
  const fresh = path.join(parent, 'fresh');
  const existing = path.join(parent, 'existing');
  await mkdir(existing);
  await writeFile(path.join(existing, 'sentinel.txt'), 'keep-me');
  const prompt = 'STM32 board with a status LED and a 4m7 resistor';
  try {
    for (const projectDir of [fresh, existing]) {
      await assert.rejects(
        () => generateMcuPeripheralProject({ projectDir, prompt, projectName: 'bad_spice' }),
        (error) => {
          assert.equal(error.code, 'SPICE_RESISTOR_INVALID');
          return true;
        }
      );
    }
    assert.equal(existsSync(fresh), false);
    assert.deepEqual(await readdir(existing), ['sentinel.txt']);
    assert.equal(await readFile(path.join(existing, 'sentinel.txt'), 'utf8'), 'keep-me');
  } finally {
    await rm(parent, { force: true, recursive: true });
  }
});
