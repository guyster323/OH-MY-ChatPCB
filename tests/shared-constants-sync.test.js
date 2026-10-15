import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_DAEMON_PORT, ProtocolMessageType, ToolName, PROVIDER_ALLOWED_TOOLS } from '../src/shared/constants.js';

test('panel constants stay in sync with shared constants', async () => {
  const panelConstants = await readFile('apps/panel/constants.js', 'utf8');
  
  assert.match(panelConstants, new RegExp(`DEFAULT_DAEMON_PORT = ${DEFAULT_DAEMON_PORT}`), 
    'DEFAULT_DAEMON_PORT must match');
  
  for (const [key, value] of Object.entries(ProtocolMessageType)) {
    assert.match(panelConstants, new RegExp(`${key}:\\s*'${value}'`),
      `ProtocolMessageType.${key} must match`);
  }
  
  for (const [key, value] of Object.entries(ToolName)) {
    assert.match(panelConstants, new RegExp(`${key}:\\s*'${value}'`),
      `ToolName.${key} must match`);
  }
});

test('panel.js contains tool name literals for grep-based tests', async () => {
  const panelJs = await readFile('apps/panel/panel.js', 'utf8');
  
  assert.match(panelJs, /ToolName\.PROJECT_CREATE/, 'panel.js must reference ToolName.PROJECT_CREATE');
  
  const toolValues = Object.values(ToolName);
  const constantsJs = await readFile('apps/panel/constants.js', 'utf8');
  
  for (const toolName of toolValues) {
    assert.match(constantsJs, new RegExp(`'${toolName}'`), 
      `constants.js must contain literal '${toolName}' for tests that grep for it`);
  }
});
