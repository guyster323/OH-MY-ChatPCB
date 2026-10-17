import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { renderSpiceFixture, spiceResistorOhms } from '../src/kicad/project-generator.js';
import { normalizeCircuitSpec } from '../src/runtime/circuit-spec.js';
import { writeGeneratedProject } from '../src/workflow/generate-mcu-project.js';

test('spiceResistorOhms parses RKM and SPICE suffixes into ohms', () => {
  const cases = [
    ['4k7', '4700'],
    ['4K7', '4700'],
    ['4.7k', '4700'],
    ['4.7kΩ', '4700'],
    ['1M', '1000000'],
    ['1meg', '1000000'],
    ['1MEG', '1000000'],
    ['1 Meg', '1000000'],
    ['1m', '0.001'],
    ['10m', '0.01'],
    ['2m2', '0.0022'],
    ['330', '330'],
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
  for (const input of ['330Ω±5%', '1/4W 330', '-10', '10kk', 'abc', '1,000', '0', '']) {
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
  assert.match(renderSpiceFixture(statusLedSpec('10m')), /^RLED v3v3 led 0\.01$/m);
  assert.match(renderSpiceFixture(statusLedSpec('330')), /^RLED v3v3 led 330$/m);
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
