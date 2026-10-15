import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { DEFAULT_DAEMON_PORT, ProtocolMessageType, ToolName } from '../src/shared/constants.js';

// Keys apps/panel/constants.js must mirror from src/shared/constants.js.
// deepStrictEqual checks both directions: extra keys, missing keys, moved keys,
// and nested values fail on either side. PatchAction is panel-only.
// PROVIDER_ALLOWED_TOOLS is daemon-only. Neither belongs in this subset.
const MIRRORED_KEYS = ['DEFAULT_DAEMON_PORT', 'ProtocolMessageType', 'ToolName'];

const panelConstantsUrl = new URL('../apps/panel/constants.js', import.meta.url);

const sharedConstantsSubset = constantsSubset({
  DEFAULT_DAEMON_PORT,
  ProtocolMessageType,
  ToolName
});

function constantsSubset(record) {
  const subset = {};
  for (const key of MIRRORED_KEYS) {
    subset[key] = record[key];
  }
  return subset;
}

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

function panelConstantsSubset(source) {
  const window = {};
  vm.runInNewContext(source, { window }, { filename: 'apps/panel/constants.js' });
  if (window.ChatPCB === null || typeof window.ChatPCB !== 'object') {
    throw new TypeError('apps/panel/constants.js must assign window.ChatPCB to an object.');
  }
  return plainData(constantsSubset(window.ChatPCB));
}

test('panel constants match the shared constants they mirror', async () => {
  const source = await readFile(panelConstantsUrl, 'utf8');
  assert.deepStrictEqual(panelConstantsSubset(source), sharedConstantsSubset);
});

test('in-memory panel constant drift fails the structural comparison', async () => {
  const source = await readFile(panelConstantsUrl, 'utf8');

  const withPanelOnlyKey = source.replace(
    "  PROVIDER_CANCEL: 'provider.cancel'\n};",
    "  PROVIDER_CANCEL: 'provider.cancel',\n  PANEL_ONLY: 'panel.only'\n};"
  );
  assert.notEqual(withPanelOnlyKey, source);
  const panelOnlySubset = panelConstantsSubset(withPanelOnlyKey);
  assert.equal(panelOnlySubset.ToolName.PANEL_ONLY, 'panel.only');
  assert.throws(
    () => assert.deepStrictEqual(panelOnlySubset, sharedConstantsSubset),
    assert.AssertionError
  );

  const withWidenedPort = source.replace(
    'window.ChatPCB.DEFAULT_DAEMON_PORT = 41317;',
    'window.ChatPCB.DEFAULT_DAEMON_PORT = 413170;'
  );
  assert.notEqual(withWidenedPort, source);
  const widenedPortSubset = panelConstantsSubset(withWidenedPort);
  assert.equal(widenedPortSubset.DEFAULT_DAEMON_PORT, 413170);
  assert.throws(
    () => assert.deepStrictEqual(widenedPortSubset, sharedConstantsSubset),
    assert.AssertionError
  );
});
