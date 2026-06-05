import assert from 'node:assert/strict';
import test from 'node:test';

import { createEnvelope, parseEnvelope } from '../src/runtime/envelope.js';

test('creates and parses ChatPCB websocket envelopes', () => {
  const envelope = createEnvelope('tool.call', {
    id: 'call-1',
    name: 'schematic.generate',
    args: { projectDir: 'demo' }
  });

  assert.equal(envelope.type, 'tool.call');
  assert.equal(envelope.version, 1);
  assert.match(envelope.id, /^evt_/);
  assert.ok(envelope.createdAt.endsWith('Z'));

  assert.deepEqual(parseEnvelope(JSON.stringify(envelope)), envelope);
});

test('rejects malformed envelopes before they reach the daemon', () => {
  assert.throws(
    () => parseEnvelope(JSON.stringify({ version: 1, type: 'bad type', payload: {} })),
    /Invalid envelope type/
  );
});
