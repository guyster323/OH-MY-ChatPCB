import assert from 'node:assert/strict';
import test from 'node:test';

import { createPatchApprovalRegistry } from '../src/runtime/patch-approval-registry.js';

test('patch approval registry consumes a matching unexpired preview once', () => {
  let time = 1000;
  const registry = createPatchApprovalRegistry({ ttlMs: 900000, now: () => time });
  registry.register({ patchId: 'sha256:abc', projectDir: 'C:/project' });
  assert.equal(registry.consume({ patchId: 'sha256:abc', projectDir: 'C:/project' }).ok, true);
  assert.equal(registry.consume({ patchId: 'sha256:abc', projectDir: 'C:/project' }).reason.code, 'PATCH_APPROVAL_MISSING');
});

test('patch approval registry rejects an expired preview', () => {
  let time = 1000;
  const registry = createPatchApprovalRegistry({ ttlMs: 10, now: () => time });
  registry.register({ patchId: 'sha256:abc', projectDir: 'C:/project' });
  time = 1011;
  assert.equal(registry.consume({ patchId: 'sha256:abc', projectDir: 'C:/project' }).reason.code, 'PATCH_APPROVAL_EXPIRED');
});
