import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
    assert.match(schematic, /\(version 20260306\)/);
    assert.match(schematic, /\(generator "eeschema"\)/);
    assert.match(schematic, /\(generator_version "10\.0"\)/);
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
    assert.match(schematic, /\(wire\s+\(pts\s+\(xy 63\.50 129\.54\)\s+\(xy 58\.42 129\.54\)\)/);
    assert.match(schematic, /\(label "SCL"\s+\(at 58\.42 129\.54 0\)/);
    assert.match(schematic, /\(effects \(font \(size 1\.27 1\.27\)\)/);
    assert.doesNotMatch(schematic, /\(at 3810\.00 8890\.00 0\)/);

    const metadata = JSON.parse(await readFile(result.files.spec, 'utf8'));
    assert.deepEqual(
      metadata.schematic.components.map((component) => component.ref),
      ['J1', 'U1', 'U2', 'SW1', 'SW2', 'D1', 'J2', 'J3', 'J4']
    );
    assert.deepEqual(
      metadata.schematic.nets.map((net) => net.name),
      ['VBUS', '+3V3', 'GND', 'SCL', 'SDA', 'TX', 'RX', 'USB_DP', 'USB_DN', 'CC1', 'CC2', 'RESET', 'BOOT']
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
      ['VBUS', '+3V3', 'GND', 'SCL', 'SDA', 'USB_DP', 'USB_DN', 'CC1', 'CC2', 'RESET', 'BOOT']
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('reports release blockers and proposed review-loop fixes for incomplete manufacturing prompts', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-release-review-'));

  try {
    const result = await generateMcuPeripheralProject({
      projectDir: root,
      prompt:
        'USB-C powered ESP32-S3 sensor board with 3.3V 500mA regulator, I2C sensor connector, UART debug header, SWD, reset button, status LED, USB, SPI, GPIO header, JLCPCB order ready.'
    });

    assert.equal(result.review.status, 'blocked');
    assert.ok(result.review.findings.blockers.some((finding) => /exact ESP32-S3 part or module/i.test(finding.message)));
    assert.ok(!result.review.findings.blockers.some((finding) => finding.code === 'missing-spi'));
    assert.ok(!result.review.findings.blockers.some((finding) => finding.code === 'missing-usb'));
    assert.ok(!result.review.findings.blockers.some((finding) => finding.code === 'missing-gpio'));
    assert.ok(result.review.findings.blockers.some((finding) => finding.code === 'missing-swd'));
    assert.ok(result.review.findings.warnings.some((finding) => /fixture symbols/i.test(finding.message)));
    assert.ok(result.review.proposedFixes.every((fix) => fix.approvalRequired === true));
    assert.ok(result.nextActions.some((action) => /review findings/i.test(action)));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('review blocker names the requested MCU family instead of a hard-coded part', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-family-review-'));

  try {
    const result = await generateMcuPeripheralProject({
      projectDir: root,
      prompt: 'STM32 sensor board with 3.3V regulator and UART debug header.'
    });

    assert.ok(result.review.findings.blockers.some((finding) => /exact STM32 part or module/i.test(finding.message)));
    assert.ok(!result.review.findings.blockers.some((finding) => /ESP32-S3/i.test(finding.message)));
    assert.ok(result.review.proposedFixes.some((fix) => /exact STM32 module\/chip/i.test(fix.summary)));
    assert.ok(!result.review.proposedFixes.some((fix) => /ESP32-S3/i.test(fix.summary)));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('supported release profiles generate a PCB draft and manufacturing metadata', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-profile-pcb-'));

  try {
    const result = await generateMcuPeripheralProject({
      projectDir: root,
      prompt:
        'Release profile STM32 USB-C 5V sensor board with 3.3V 500mA regulator, I2C sensor connector, UART debug header, SWD, USB, SPI, GPIO header, reset button, and status LED.'
    });

    assert.equal(result.files.board.endsWith('.kicad_pcb'), true);

    const board = await readFile(result.files.board, 'utf8');
    assert.match(board, /\(kicad_pcb/);
    assert.match(board, /\(generator "pcbnew"\)/);
    assert.match(board, /\(gr_rect[\s\S]*\(layer "Edge\.Cuts"\)/);
    assert.match(board, /\(end 160 120\)/);
    assert.match(board, /\(footprint "Package_SON:WSON-10-1EP_2x3mm_P0\.5mm_EP0\.84x2\.4mm_ThermalVias"/);
    assert.match(board, /\(property "Reference" "U1"/);
    assert.match(board, /\(footprint "Inductor_SMD:L_0805_2012Metric"/);
    assert.match(board, /\(property "Reference" "L1"/);
    assert.match(board, /\(footprint "Connector_USB:USB_C_Receptacle_HRO_TYPE-C-31-M-12"/);
    assert.match(board, /\(property "Reference" "J4"/);

    const project = JSON.parse(await readFile(result.files.project, 'utf8'));
    assert.equal(project.board.design_settings.rules.min_through_hole_diameter, 0.2);
    assert.equal(project.board.design_settings.rules.min_hole_clearance, 0.15);

    const metadata = JSON.parse(await readFile(result.files.spec, 'utf8'));
    assert.equal(metadata.boardProfile.manufacturing.boardDraft.status, 'generated');
    assert.equal(metadata.boardProfile.manufacturing.boardDraft.file, 'chatpcb_mcu_peripheral.kicad_pcb');
    assert.equal(metadata.boardProfile.manufacturing.drc.status, 'pending');
    assert.equal(metadata.boardProfile.manufacturing.exports.gerber.status, 'pending');
    assert.equal(metadata.boardProfile.manufacturing.exports.drill.status, 'pending');
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('supported release profiles embed resolved KiCad footprint bodies in PCB drafts', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-profile-footprints-'));
  const footprintRoot = path.join(root, 'footprints');
  const resistorLibrary = path.join(footprintRoot, 'Resistor_SMD.pretty');
  const previousFootprintDir = process.env.KICAD_FOOTPRINT_DIR;

  try {
    await mkdir(resistorLibrary, { recursive: true });
    await writeFile(
      path.join(resistorLibrary, 'R_0603_1608Metric.kicad_mod'),
      `(footprint "R_0603_1608Metric"
  (version 20260206)
  (generator "test")
  (layer "F.Cu")
  (property "Reference" "REF**"
    (at 0 -1.43 0)
    (layer "F.SilkS")
    (effects (font (size 1 1) (thickness 0.15)))
  )
  (property "Value" "R_0603_1608Metric"
    (at 0 1.43 0)
    (layer "F.Fab")
    (effects (font (size 1 1) (thickness 0.15)))
  )
  (pad "1" smd rect
    (at -0.8 0)
    (size 0.8 0.9)
    (layers "F.Cu" "F.Paste" "F.Mask")
  )
  (pad "2" smd rect
    (at 0.8 0)
    (size 0.8 0.9)
    (layers "F.Cu" "F.Paste" "F.Mask")
  )
)
`,
      'utf8'
    );
    process.env.KICAD_FOOTPRINT_DIR = footprintRoot;

    for (const [profile, prompt] of [
      [
        'esp32',
        'Release profile ESP32-S3 USB-C 5V sensor board with 3.3V 500mA regulator, I2C sensor connector, UART debug header, SWD, USB, SPI, GPIO header, reset button, and status LED.'
      ],
      [
        'stm32',
        'Release profile STM32 USB-C 5V sensor board with 3.3V 500mA regulator, I2C sensor connector, UART debug header, SWD, USB, SPI, GPIO header, reset button, and status LED.'
      ]
    ]) {
      const result = await generateMcuPeripheralProject({
        projectDir: path.join(root, profile),
        prompt
      });

      const board = await readFile(result.files.board, 'utf8');
      assert.match(board, /\(net \d+ "CC1"\)/);
      assert.match(board, /\(net \d+ "GND"\)/);
      assert.match(board, /\(footprint "Resistor_SMD:R_0603_1608Metric"/);
      assert.match(board, /\(property "Reference" "R1"/);
      assert.match(board, /\(property "Value" "5\.1k"/);
      assert.match(board, /\(pad "1" smd rect/);
      assert.match(board, /\(pad "2" smd rect/);
      assert.match(board, /\(pad "1" smd rect[\s\S]*\(net \d+ "CC1"\)/);
      assert.match(board, /\(pad "2" smd rect[\s\S]*\(net \d+ "GND"\)/);
      assert.doesNotMatch(board, /\(property "Reference" "REF\*\*"/);
    }
  } finally {
    if (previousFootprintDir === undefined) {
      delete process.env.KICAD_FOOTPRINT_DIR;
    } else {
      process.env.KICAD_FOOTPRINT_DIR = previousFootprintDir;
    }
    await rm(root, { force: true, recursive: true });
  }
});
