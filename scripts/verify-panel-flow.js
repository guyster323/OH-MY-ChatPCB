#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createEnvelope, parseEnvelope } from '../src/runtime/envelope.js';
import { startDaemon } from '../src/runtime/agent-daemon.js';

const projectName = '가스 센서 보드 01';
const prompt = 'ESP32-S3와 가스 센서를 연결하고 3.3V 전원을 사용하는 회로를 만들어줘.';
const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'chatpcb-panel-flow-'));
const daemon = await startDaemon({
  port: 0,
  dispatchOptions: {
    checkProviderAvailabilityImpl: async ({ provider }) => ({
      provider,
      command: 'fake-provider',
      available: true,
      status: 'available'
    }),
    runProviderProcessImpl: async () => ({
      exitCode: 0,
      stderr: '',
      events: [
        createEnvelope('agent.delta', { text: '가스 센서 보드를 생성하겠습니다.' }),
        createEnvelope('tool.call', {
          id: 'panel-provider-generate',
          name: 'schematic.generate',
          args: { prompt }
        })
      ]
    })
  }
});

try {
  const url = daemon.url.replace('http:', 'ws:') + '/ws';
  const created = await sendToolCallOverWebSocket({
    url,
    id: 'panel-project-create',
    name: 'project.create',
    args: { workspaceRoot, projectName }
  });

  assert.equal(created.type, 'tool.result');
  assert.equal(created.payload.ok, true);
  assert.equal(created.payload.result.displayName, projectName);
  assert.equal(created.payload.result.projectDir, path.join(workspaceRoot, '가스-센서-보드-01'));

  const requested = await sendToolCallOverWebSocket({
    url,
    id: 'panel-project-request',
    name: 'project.request',
    args: {
      provider: 'codex',
      projectDir: created.payload.result.projectDir,
      prompt
    }
  });

  assert.equal(requested.type, 'tool.result');
  assert.equal(requested.payload.ok, true);
  assert.equal(requested.payload.result.operation, 'generated');
  assert.match(requested.payload.result.files.project, /\.kicad_pro$/);
  assert.equal(path.dirname(requested.payload.result.files.project), created.payload.result.projectDir);
  assert.equal(typeof requested.payload.result.validation.erc, 'object');
  assert.equal(typeof requested.payload.result.validation.erc.errorCount, 'number');
  assert.equal(typeof requested.payload.result.review, 'object');
  assert.equal(typeof requested.payload.result.review.status, 'string');

  const inspected = await sendToolCallOverWebSocket({
    url,
    id: 'panel-project-inspect',
    name: 'project.inspect',
    args: { projectDir: created.payload.result.projectDir }
  });

  assert.equal(inspected.type, 'tool.result');
  assert.equal(inspected.payload.ok, true);
  assert.equal(typeof inspected.payload.result.inspection.projectDigest, 'string');
  assert.equal(typeof inspected.payload.result.inspection.artifactCount, 'number');
  assert.equal(typeof inspected.payload.result.manifest.freshness.status, 'string');

  console.log(
    JSON.stringify(
      {
        ok: true,
        service: 'chatpcb-agentd',
        verified: 'named project.create and project.request websocket flow',
        displayName: created.payload.result.displayName,
        operation: requested.payload.result.operation,
        project: requested.payload.result.files.project,
        erc: requested.payload.result.validation.erc,
        reviewStatus: requested.payload.result.review.status,
        freshness: inspected.payload.result.manifest.freshness.status
      },
      null,
      2
    )
  );
} finally {
  await daemon.close();
  await rm(workspaceRoot, { force: true, recursive: true });
}

function sendToolCallOverWebSocket({ url, id, name, args }) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error(`panel websocket verification timed out for ${name}`));
    }, 30000);

    socket.addEventListener('open', () => {
      socket.send(JSON.stringify(createEnvelope('tool.call', { id, name, args })));
    });

    socket.addEventListener('message', (event) => {
      const envelope = parseEnvelope(event.data);
      if (envelope.type !== 'tool.result' || envelope.payload.id !== id) return;
      clearTimeout(timeout);
      socket.close();
      resolve(envelope);
    });

    socket.addEventListener('error', (event) => {
      clearTimeout(timeout);
      reject(new Error(`chatpcb-agentd websocket error: ${event.message ?? 'unknown error'}`));
    });
  });
}
