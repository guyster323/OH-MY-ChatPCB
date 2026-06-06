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
    assert.equal(result.files.symbolLibrary.endsWith('chatpcb.kicad_sym'), true);
    assert.equal(result.files.symbolTable.endsWith('sym-lib-table'), true);

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

test('packages a project-local ChatPCB symbol library for KiCad GUI loading', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-symbol-library-'));

  try {
    const result = await generateMcuPeripheralProject({
      projectDir: root,
      prompt:
        'STM32 board with USB-C power, 3.3V regulator, I2C sensor connector, UART debug header, reset button, boot button, and status LED.'
    });

    const symbolTable = await readFile(result.files.symbolTable, 'utf8');
    assert.match(symbolTable, /\(sym_lib_table/);
    assert.match(symbolTable, /\(name "ChatPCB"\)/);
    assert.match(symbolTable, /\(uri "\$\{KIPRJMOD\}\/chatpcb\.kicad_sym"\)/);

    const symbolLibrary = await readFile(result.files.symbolLibrary, 'utf8');
    assert.match(symbolLibrary, /\(kicad_symbol_lib/);
    assert.match(symbolLibrary, /\(symbol "MCU_PLACEHOLDER"/);
    assert.match(symbolLibrary, /\(symbol "REGULATOR_3V3"/);
    assert.match(symbolLibrary, /\(symbol "I2C_CONNECTOR"/);
    assert.doesNotMatch(symbolLibrary, /\(symbol "ChatPCB:/);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('writes real schematic symbols, net labels, and metadata explanations for MCU drafts', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-real-symbols-'));

  try {
    const result = await generateMcuPeripheralProject({
      projectDir: root,
      prompt:
        'STM32 board with USB-C power, 3.3V regulator, I2C sensor connector, UART debug header, reset button, boot button, and status LED.'
    });

    const schematic = await readFile(result.files.schematic, 'utf8');
    assert.match(schematic, /\(symbol\s+\(lib_id "ChatPCB:MCU_PLACEHOLDER"\)/);
    assert.match(schematic, /\(symbol\s+\(lib_id "ChatPCB:REGULATOR_3V3"\)/);
    assert.match(schematic, /\(symbol\s+\(lib_id "ChatPCB:STATUS_LED"\)/);
    assert.match(schematic, /\(label "\+3V3"/);
    assert.match(schematic, /\(label "GND"/);
    assert.match(schematic, /\(label "SCL"/);
    assert.match(schematic, /\(label "SDA"/);
    assert.match(schematic, /\(label "TX"/);
    assert.match(schematic, /\(label "RX"/);
    assert.match(schematic, /\(wire\s+\(pts\s+\(xy 101\.60 86\.36\)\s+\(xy 96\.52 86\.36\)\)/);
    assert.match(schematic, /\(label "SCL"\s+\(at 96\.52 86\.36 0\)/);
    assert.match(schematic, /\(wire\s+\(pts\s+\(xy 101\.60 116\.84\)\s+\(xy 96\.52 116\.84\)\)/);
    assert.match(schematic, /\(label "SCL"\s+\(at 96\.52 116\.84 0\)/);
    assert.match(schematic, /\(effects \(font \(size 1\.27 1\.27\)\)/);
    assert.doesNotMatch(schematic, /\(at 3810\.00 8890\.00 0\)/);

    const metadata = JSON.parse(await readFile(result.files.spec, 'utf8'));
    assert.deepEqual(
      metadata.schematic.components.map((component) => component.ref),
      ['J1', 'U1', 'U2', 'SW1', 'SW2', 'D1', 'J2', 'J3']
    );
    assert.deepEqual(
      metadata.schematic.nets.map((net) => net.name),
      ['VBUS', '+3V3', 'GND', 'SCL', 'SDA', 'TX', 'RX', 'RESET', 'BOOT']
    );
    assert.ok(
      metadata.schematic.components.every((component) => component.explanation),
      'every generated symbol should explain why it exists'
    );
    assert.ok(
      metadata.schematic.nets.every((net) => net.explanation),
      'every generated net should explain what it connects'
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('omits optional MCU interface labels when that interface is not requested', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-optional-nets-'));

  try {
    const result = await generateMcuPeripheralProject({
      projectDir: root,
      prompt: 'RP2040 board with USB-C power, I2C connector, reset button, and status LED.'
    });

    const schematic = await readFile(result.files.schematic, 'utf8');
    assert.match(schematic, /\(label "SCL"/);
    assert.match(schematic, /\(label "SDA"/);
    assert.doesNotMatch(schematic, /\(label "TX"/);
    assert.doesNotMatch(schematic, /\(label "RX"/);
    assert.match(schematic, /\(no_connect\s+\(at 101\.60 88\.90\)/);
    assert.match(schematic, /\(no_connect\s+\(at 127\.00 88\.90\)/);

    const metadata = JSON.parse(await readFile(result.files.spec, 'utf8'));
    assert.deepEqual(
      metadata.schematic.nets.map((net) => net.name),
      ['VBUS', '+3V3', 'GND', 'SCL', 'SDA', 'RESET', 'BOOT']
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
