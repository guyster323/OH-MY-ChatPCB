import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { generateMcuPeripheralProject } from '../src/workflow/generate-mcu-project.js';
import { applySchematicPatch } from '../src/workflow/schematic-patch.js';

test('schematic patch preview returns a diff without modifying existing project files', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-patch-preview-'));

  try {
    const initial = await generateMcuPeripheralProject({
      projectDir: root,
      prompt: 'RP2040 board with USB-C power, I2C connector, reset button, and LED.'
    });
    const before = await readFile(initial.files.spec, 'utf8');

    const preview = await applySchematicPatch({
      projectDir: root,
      prompt: 'STM32 board with USB-C power, 3.3V regulator, I2C connector, UART header, reset button, boot button, and LED.',
      approved: false
    });

    assert.equal(preview.requiresApproval, true);
    assert.equal(preview.applied, false);
    assert.ok(preview.diff.includes('--- chatpcb_mcu_peripheral.chatpcb.json'));
    assert.ok(preview.diff.includes('+++ chatpcb_mcu_peripheral.chatpcb.json'));
    assert.ok(preview.changedFiles.includes('chatpcb_mcu_peripheral.chatpcb.json'));
    assert.equal(await readFile(initial.files.spec, 'utf8'), before);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('approved schematic patch writes generated files and returns validation result', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-patch-approve-'));

  try {
    await generateMcuPeripheralProject({
      projectDir: root,
      prompt: 'RP2040 board with USB-C power, I2C connector, reset button, and LED.'
    });

    const result = await applySchematicPatch({
      projectDir: root,
      prompt: 'STM32 board with USB-C power, 3.3V regulator, I2C connector, UART header, reset button, boot button, and LED.',
      approved: true,
      validateProjectImpl: async () => ({ ok: true, skipped: false, erc: { errorCount: 0, warningCount: 0, byType: {} } })
    });

    const metadata = JSON.parse(await readFile(result.files.spec, 'utf8'));
    assert.equal(result.applied, true);
    assert.equal(result.validation.ok, true);
    assert.equal(metadata.mcu.family, 'STM32');
    assert.ok(metadata.interfaces.some((iface) => iface.kind === 'uart'));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('canceled schematic patch leaves the project unchanged without building a diff', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-patch-cancel-'));

  try {
    const initial = await generateMcuPeripheralProject({
      projectDir: root,
      prompt: 'RP2040 board with USB-C power, I2C connector, reset button, and LED.'
    });
    const before = await readFile(initial.files.spec, 'utf8');

    const result = await applySchematicPatch({
      projectDir: root,
      cancel: true
    });

    assert.equal(result.canceled, true);
    assert.equal(result.applied, false);
    assert.equal(result.diff, '');
    assert.deepEqual(result.changedFiles, []);
    assert.equal(await readFile(initial.files.spec, 'utf8'), before);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('approved schematic patch rolls back files when validation fails', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-patch-rollback-'));

  try {
    const initial = await generateMcuPeripheralProject({
      projectDir: root,
      prompt: 'RP2040 board with USB-C power, I2C connector, reset button, and LED.'
    });
    const before = await readFile(initial.files.spec, 'utf8');

    const result = await applySchematicPatch({
      projectDir: root,
      prompt: 'STM32 board with USB-C power, 3.3V regulator, I2C connector, UART header, reset button, boot button, and LED.',
      approved: true,
      validateProjectImpl: async () => ({ ok: false, skipped: false, erc: { errorCount: 1, warningCount: 0, byType: { test: 1 } } })
    });

    assert.equal(result.applied, false);
    assert.equal(result.rolledBack, true);
    assert.equal(result.validation.ok, false);
    assert.equal(await readFile(initial.files.spec, 'utf8'), before);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
