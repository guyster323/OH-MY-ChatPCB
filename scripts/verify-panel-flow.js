#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createEnvelope, parseEnvelope } from '../src/runtime/envelope.js';
import { startDaemon } from '../src/runtime/agent-daemon.js';

const panelHtml = await readFile('apps/panel/index.html', 'utf8');
const defaultPrompt = extractTextareaDefault(panelHtml, 'prompt');
const defaultProjectDir = extractInputValue(panelHtml, 'project-dir');

const projectDir = await mkdtemp(path.join(tmpdir(), 'chatpcb-panel-flow-'));
const daemon = await startDaemon({ port: 0 });

try {
  assert.ok(defaultPrompt.includes('STM32'), 'panel default prompt should mention STM32');
  assert.ok(defaultProjectDir.includes('workspaces'), 'panel default project should target a workspace path');

  const result = await sendGenerateOverWebSocket({
    url: daemon.url.replace('http:', 'ws:') + '/ws',
    projectDir,
    prompt: defaultPrompt
  });

  assert.equal(result.type, 'tool.result');
  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.result.spec.kind, 'mcu-peripheral');
  assert.match(result.payload.result.files.schematic, /\.kicad_sch$/);

  console.log(
    JSON.stringify(
      {
        ok: true,
        service: 'chatpcb-agentd',
        verified: 'panel schematic.generate websocket flow',
        mcu: result.payload.result.spec.mcu.family,
        files: result.payload.result.files
      },
      null,
      2
    )
  );
} finally {
  await daemon.close();
  await rm(projectDir, { force: true, recursive: true });
}

function extractTextareaDefault(html, id) {
  const pattern = new RegExp(`<textarea[^>]*id="${id}"[^>]*>([\\s\\S]*?)<\\/textarea>`);
  const match = html.match(pattern);
  if (!match) {
    throw new Error(`Could not find textarea#${id} in apps/panel/index.html.`);
  }
  return decodeHtml(match[1]).trim();
}

function extractInputValue(html, id) {
  const pattern = new RegExp(`<input[^>]*id="${id}"[^>]*value="([^"]*)"`);
  const match = html.match(pattern);
  if (!match) {
    throw new Error(`Could not find input#${id} in apps/panel/index.html.`);
  }
  return decodeHtml(match[1]).trim();
}

function decodeHtml(value) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function sendGenerateOverWebSocket({ url, projectDir, prompt }) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error('panel websocket verification timed out'));
    }, 10000);

    socket.addEventListener('open', () => {
      socket.send(
        JSON.stringify(
          createEnvelope('tool.call', {
            id: 'panel-flow-1',
            name: 'schematic.generate',
            args: { projectDir, prompt }
          })
        )
      );
    });

    socket.addEventListener('message', (event) => {
      const envelope = parseEnvelope(event.data);
      if (envelope.type !== 'tool.result') return;
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
