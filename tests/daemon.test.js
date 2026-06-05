import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { dispatchToolCall, startDaemon } from '../src/runtime/agent-daemon.js';

test('daemon dispatches schematic.generate tool calls to the project generator', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-daemon-'));

  try {
    const result = await dispatchToolCall({
      name: 'schematic.generate',
      args: {
        projectDir: root,
        prompt: 'RP2040 board with USB-C power, I2C connector, reset button, and LED.'
      }
    });

    assert.equal(result.ok, true);
    assert.equal(result.result.spec.mcu.family, 'RP2040');
    assert.match(result.result.files.schematic, /\.kicad_sch$/);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('daemon rejects unknown tool calls with a typed failure', async () => {
  const result = await dispatchToolCall({
    name: 'board.autoroute',
    args: {}
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'UNKNOWN_TOOL');
});

test('daemon exposes health and websocket status endpoints for the WebView panel', async () => {
  const daemon = await startDaemon({ port: 0 });

  try {
    const health = await fetch(`${daemon.url}/health`).then((response) => response.json());
    assert.equal(health.ok, true);
    assert.equal(health.websocket, '/ws');

    const status = await new Promise((resolve, reject) => {
      const socket = new WebSocket(`${daemon.url.replace('http:', 'ws:')}/ws`);
      socket.addEventListener('message', (event) => {
        socket.close();
        resolve(JSON.parse(event.data));
      });
      socket.addEventListener('error', reject);
      setTimeout(() => reject(new Error('websocket status timed out')), 1000);
    });

    assert.equal(status.type, 'system.status');
    assert.equal(status.payload.service, 'chatpcb-agentd');
  } finally {
    await daemon.close();
  }
});
