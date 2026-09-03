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

test('patch approval registry expires at the exact boundary and disposes the retained plan once', () => {
  let time = 1000;
  let expiry;
  let cleared = 0;
  let disposed = 0;
  const registry = createPatchApprovalRegistry({
    ttlMs: 10,
    now: () => time,
    setTimeoutImpl: (callback) => { expiry = callback; return 'expiry-timer'; },
    clearTimeoutImpl: () => { cleared += 1; }
  });
  registry.register({ patchId: 'sha256:abc', projectDir: 'C:/project', dispose: () => { disposed += 1; } });
  time = 1010;
  assert.equal(registry.consume({ patchId: 'sha256:abc', projectDir: 'C:/project' }).reason.code, 'PATCH_APPROVAL_EXPIRED');
  assert.equal(disposed, 1);
  assert.equal(cleared, 1);
  expiry();
  assert.equal(disposed, 1);
});

test('patch approval registry timer disposes an unconsumed approval and disposeAll clears timers', () => {
  let expiry;
  let disposed = 0;
  let cleared = 0;
  const registry = createPatchApprovalRegistry({
    setTimeoutImpl: (callback) => { expiry = callback; return 'expiry-timer'; },
    clearTimeoutImpl: () => { cleared += 1; }
  });
  registry.register({ patchId: 'sha256:abc', projectDir: 'C:/project', dispose: () => { disposed += 1; } });
  expiry();
  assert.equal(disposed, 1);
  registry.disposeAll();
  assert.equal(cleared, 1);
});

test('patch approval registry retains an expired tombstone until it is consumed', async () => {
  const registry = createPatchApprovalRegistry({ ttlMs: 5 });
  registry.register({ patchId: 'sha256:expired', projectDir: 'C:/project' });
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(registry.consume({ patchId: 'sha256:expired', projectDir: 'C:/project' }).reason.code, 'PATCH_APPROVAL_EXPIRED');
  assert.equal(registry.consume({ patchId: 'sha256:expired', projectDir: 'C:/project' }).reason.code, 'PATCH_APPROVAL_MISSING');
});

test('patch approval registry absorbs rejected asynchronous disposal from expiry cleanup', async () => {
  const registry = createPatchApprovalRegistry({ ttlMs: 5 });
  registry.register({ patchId: 'sha256:reject', projectDir: 'C:/project', dispose: () => Promise.reject(new Error('cleanup failed')) });
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(registry.consume({ patchId: 'sha256:reject', projectDir: 'C:/project' }).reason.code, 'PATCH_APPROVAL_EXPIRED');
});
