import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { dispatchToolCall, startDaemon } from '../src/runtime/agent-daemon.js';

function assertProjectExists(result) {
  assert.equal(result.ok, false);
  assert.equal(result.error?.code, 'PROJECT_EXISTS');
  assert.match(result.error?.message ?? '', /already exists/);
  assert.match(result.error?.message ?? '', /이미 있습니다/);
}

async function websocketToolCall(daemon, payload) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${daemon.url.replace('http:', 'ws:')}/ws`);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`websocket ${payload.id} timed out`));
    }, 5000);
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({
        version: 1,
        id: `evt_${payload.id}`,
        type: 'tool.call',
        createdAt: new Date().toISOString(),
        payload
      }));
    });
    socket.addEventListener('message', (event) => {
      const envelope = JSON.parse(event.data);
      if (envelope.type !== 'tool.result') return;
      if (envelope.payload?.id !== payload.id) return;
      clearTimeout(timer);
      socket.close();
      resolve(envelope.payload);
    });
    socket.addEventListener('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

test('project.create of an existing name returns PROJECT_EXISTS', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'chatpcb-project-exists-'));
  try {
    const created = await dispatchToolCall({
      name: 'project.create',
      args: { workspaceRoot, projectName: 'Sensor Board' }
    });
    assert.equal(created.ok, true);
    const duplicate = await dispatchToolCall({
      name: 'project.create',
      args: { workspaceRoot, projectName: 'Sensor Board' }
    });
    assertProjectExists(duplicate);
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test('websocket project.create of an existing name returns PROJECT_EXISTS', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'chatpcb-project-exists-ws-'));
  const daemon = await startDaemon({ port: 0 });
  try {
    const created = await websocketToolCall(daemon, {
      id: 'create_sensor_board',
      name: 'project.create',
      args: { workspaceRoot, projectName: 'Sensor Board' }
    });
    assert.equal(created.ok, true);
    const duplicate = await websocketToolCall(daemon, {
      id: 'create_sensor_board_again',
      name: 'project.create',
      args: { workspaceRoot, projectName: 'Sensor Board' }
    });
    assertProjectExists(duplicate);
  } finally {
    await daemon.close();
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});
