import assert from 'node:assert/strict';
import test from 'node:test';

import { renderSpiceFixture, spiceResistorOhms } from '../src/kicad/project-generator.js';

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
