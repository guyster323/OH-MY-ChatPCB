import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('chatpcb CLI generates an MCU peripheral project', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-cli-'));

  try {
    const result = spawnSync(
      process.execPath,
      [
        path.resolve('bin/chatpcb-cli.js'),
        'generate',
        '--project',
        root,
        '--prompt',
        'STM32 board with USB-C power, 3.3V regulator, UART, I2C, reset button, and LED.'
      ],
      { cwd: process.cwd(), encoding: 'utf8' }
    );

    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.result.spec.mcu.family, 'STM32');

    const schematic = await readFile(payload.result.files.schematic, 'utf8');
    assert.match(schematic, /ChatPCB generated MCU peripheral draft/);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
