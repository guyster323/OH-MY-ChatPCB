import assert from 'node:assert/strict';
import test from 'node:test';

import { assertSupportedNodeVersion } from '../src/runtime/node-version.js';

test('accepts Node.js 22 and newer when the version string is injected', () => {
  assert.doesNotThrow(() => assertSupportedNodeVersion('22.0.0'));
  assert.doesNotThrow(() => assertSupportedNodeVersion('22.23.3'));
  assert.doesNotThrow(() => assertSupportedNodeVersion('24.1.0'));
  assert.doesNotThrow(() => assertSupportedNodeVersion('v22.11.0'));
  assert.doesNotThrow(() => assertSupportedNodeVersion(process.versions.node));
});

test('rejects Node.js older than 22 with the injected version in the message', () => {
  for (const version of ['21.7.3', '20.18.1', '18.20.4', '0.10.48', 'v21.0.0']) {
    assert.throws(() => assertSupportedNodeVersion(version), (error) => {
      assert.equal(error.code, 'UNSUPPORTED_NODE_VERSION');
      assert.match(error.message, /Node\.js 22 or newer is required/);
      assert.match(error.message, new RegExp(version.replace(/[.]/gu, '\\.')));
      return true;
    });
  }
  assert.throws(() => assertSupportedNodeVersion(''), { code: 'UNSUPPORTED_NODE_VERSION' });
  assert.throws(() => assertSupportedNodeVersion('not-a-version'), { code: 'UNSUPPORTED_NODE_VERSION' });
});
