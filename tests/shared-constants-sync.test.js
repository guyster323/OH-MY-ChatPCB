import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { DEFAULT_DAEMON_PORT, PatchAction, ProtocolMessageType, ToolName } from '../src/shared/constants.js';

// The whole window.ChatPCB object must equal this subset. PROVIDER_ALLOWED_TOOLS
// stays daemon-only and is not part of the panel surface. Extra panel keys,
// missing keys, moved keys, and nested value drift all fail deepStrictEqual.
const sharedPanelConstants = {
  DEFAULT_DAEMON_PORT,
  ProtocolMessageType,
  ToolName,
  PatchAction
};

const panelConstantsUrl = new URL('../apps/panel/constants.js', import.meta.url);

// vm object literals use that realm's Object.prototype. deepStrictEqual treats a
// different prototype as inequality even when the keys and values match, so copy
// the evaluated data into local objects before comparing.
function plainData(value) {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => plainData(entry));
  }
  const copy = {};
  for (const key of Reflect.ownKeys(value)) {
    copy[key] = plainData(value[key]);
  }
  return copy;
}

function loadPanelConstants(source) {
  const window = {};
  vm.runInNewContext(source, { window }, { filename: 'apps/panel/constants.js' });
  if (window.ChatPCB === null || typeof window.ChatPCB !== 'object') {
    throw new TypeError('apps/panel/constants.js must assign window.ChatPCB to an object.');
  }
  return plainData(window.ChatPCB);
}

test('panel constants match the shared constants they mirror', async () => {
  const source = await readFile(panelConstantsUrl, 'utf8');
  assert.deepStrictEqual(loadPanelConstants(source), sharedPanelConstants);
});

test('in-memory panel constant drift fails the structural comparison', async () => {
  const source = await readFile(panelConstantsUrl, 'utf8');

  const withNestedPanelOnlyKey = source.replace(
    "  PROVIDER_CANCEL: 'provider.cancel'\n};",
    "  PROVIDER_CANCEL: 'provider.cancel',\n  PANEL_ONLY: 'panel.only'\n};"
  );
  assert.notEqual(withNestedPanelOnlyKey, source);
  const nestedPanelOnly = loadPanelConstants(withNestedPanelOnlyKey);
  assert.equal(nestedPanelOnly.ToolName.PANEL_ONLY, 'panel.only');
  assert.throws(
    () => assert.deepStrictEqual(nestedPanelOnly, sharedPanelConstants),
    assert.AssertionError
  );

  const withTopLevelPanelOnlyKey = source.replace(
    'window.ChatPCB = window.ChatPCB || {};',
    "window.ChatPCB = window.ChatPCB || {};\nwindow.ChatPCB.PANEL_ONLY = 'panel.only';"
  );
  assert.notEqual(withTopLevelPanelOnlyKey, source);
  const topLevelPanelOnly = loadPanelConstants(withTopLevelPanelOnlyKey);
  assert.equal(topLevelPanelOnly.PANEL_ONLY, 'panel.only');
  assert.throws(
    () => assert.deepStrictEqual(topLevelPanelOnly, sharedPanelConstants),
    assert.AssertionError
  );

  const withWidenedPort = source.replace(
    'window.ChatPCB.DEFAULT_DAEMON_PORT = 41317;',
    'window.ChatPCB.DEFAULT_DAEMON_PORT = 413170;'
  );
  assert.notEqual(withWidenedPort, source);
  const widenedPort = loadPanelConstants(withWidenedPort);
  assert.equal(widenedPort.DEFAULT_DAEMON_PORT, 413170);
  assert.throws(
    () => assert.deepStrictEqual(widenedPort, sharedPanelConstants),
    assert.AssertionError
  );

  const withCommentedPort = source.replace(
    'window.ChatPCB.DEFAULT_DAEMON_PORT = 41317;',
    '// window.ChatPCB.DEFAULT_DAEMON_PORT = 41317;\nwindow.ChatPCB.DEFAULT_DAEMON_PORT = 1;'
  );
  assert.notEqual(withCommentedPort, source);
  assert.equal(loadPanelConstants(withCommentedPort).DEFAULT_DAEMON_PORT, 1);
  assert.throws(
    () => assert.deepStrictEqual(loadPanelConstants(withCommentedPort), sharedPanelConstants),
    assert.AssertionError
  );
});
