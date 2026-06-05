import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { generateMcuPeripheralProject } from '../src/workflow/generate-mcu-project.js';

test('generates a reviewable KiCad project and SPICE fixture for an MCU peripheral prompt', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-project-'));

  try {
    const result = await generateMcuPeripheralProject({
      projectDir: root,
      prompt:
        'RP2040 board with USB-C power, 3.3V regulator, I2C connector, UART debug header, reset switch, boot button, and LED.'
    });

    assert.equal(result.files.project.endsWith('.kicad_pro'), true);
    assert.equal(result.files.schematic.endsWith('.kicad_sch'), true);
    assert.equal(result.files.spice.endsWith('.cir'), true);

    const schematic = await readFile(result.files.schematic, 'utf8');
    assert.match(schematic, /\(kicad_sch/);
    assert.match(schematic, /\(generator "eeschema"\)/);
    assert.match(schematic, /\(generator_version "9\.0"\)/);
    assert.match(schematic, /\(title_block/);
    assert.match(schematic, /\(lib_symbols/);
    assert.match(schematic, /\(text "ChatPCB generated MCU peripheral draft/);
    assert.doesNotMatch(schematic, /^\s*\(chatpcb_/m);

    const spice = await readFile(result.files.spice, 'utf8');
    assert.match(spice, /\.op/);
    assert.match(spice, /\.tran 1m 20m/);
    assert.match(spice, /VVBUS vbus 0 DC 5/);

    assert.ok(result.nextActions.includes('Review generated schematic text notes before applying to a production board.'));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
