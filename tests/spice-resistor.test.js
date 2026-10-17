import assert from 'node:assert/strict';
import test from 'node:test';

import { spiceResistorOhms } from '../src/kicad/project-generator.js';

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
    ['2m2', '0.0022'],
    ['330R', '330'],
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
