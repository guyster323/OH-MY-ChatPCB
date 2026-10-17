import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { dispatchToolCall } from '../src/runtime/agent-daemon.js';
import { createPatchApprovalRegistry } from '../src/runtime/patch-approval-registry.js';

const passingErc = {
  ok: true,
  skipped: false,
  status: 'passed',
  errorCount: 0,
  erc: { errorCount: 0 }
};

function approve(projectDir, patchId, registry) {
  return dispatchToolCall({
    name: 'schematic.patch',
    args: { projectDir, approved: true, patchId, passed: true }
  }, { patchApprovalRegistry: registry });
}

test('daemon logs blocked-missing and blocked-stale when apply is rejected', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-erc-block-log-'));
  const registry = createPatchApprovalRegistry();
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => {
    warnings.push(args.map(String));
  };

  try {
    registry.register({
      patchId: 'patch-missing',
      projectDir: root,
      proposalId: 'not-an-erc-id',
      plan: {
        proposalId: 'different-proposal',
        patchId: 'different-plan',
        changes: [],
        candidateVerification: { erc: null }
      }
    });
    const missing = await approve(root, 'patch-missing', registry);
    assert.equal(missing.ok, false);
    assert.equal(missing.error.code, 'ERC_BLOCKED');
    assert.match(missing.error.message, /no ERC result/i);
    assert.equal(missing.error.message.includes('patch.apply.blocked-stale'), false);
    assert.deepEqual(warnings, [['patch.apply.blocked-missing']]);

    warnings.length = 0;
    registry.register({
      patchId: 'patch-stale',
      projectDir: root,
      plan: {
        proposalId: 'patch-stale',
        patchId: 'plan-id-is-not-erc',
        changes: [],
        candidateVerification: {
          patchId: 'patch-other',
          erc: { ...passingErc, patchId: 'patch-other' }
        }
      }
    });
    const stale = await approve(root, 'patch-stale', registry);
    assert.equal(stale.ok, false);
    assert.equal(stale.error.code, 'ERC_BLOCKED');
    assert.match(stale.error.message, /patch\.apply\.blocked-stale/);
    assert.deepEqual(warnings, [['patch.apply.blocked-stale']]);

    warnings.length = 0;
    registry.register({
      patchId: 'patch-stale-erc',
      projectDir: root,
      plan: {
        proposalId: 'patch-stale-erc',
        changes: [],
        candidateVerification: {
          erc: { ...passingErc, patchId: 'other-erc' }
        }
      }
    });
    const staleErc = await approve(root, 'patch-stale-erc', registry);
    assert.equal(staleErc.ok, false);
    assert.match(staleErc.error.message, /patch\.apply\.blocked-stale/);
    assert.deepEqual(warnings, [['patch.apply.blocked-stale']]);

    warnings.length = 0;
    registry.register({
      patchId: 'patch-record-stale',
      projectDir: root,
      candidateVerification: {
        patchId: 'elsewhere',
        erc: passingErc
      },
      plan: {
        proposalId: 'patch-record-stale',
        changes: [],
        candidateVerification: { erc: passingErc }
      }
    });
    const recordStale = await approve(root, 'patch-record-stale', registry);
    assert.equal(recordStale.ok, false);
    assert.match(recordStale.error.message, /patch\.apply\.blocked-stale/);
    assert.deepEqual(warnings, [['patch.apply.blocked-stale']]);

    warnings.length = 0;
    registry.register({
      patchId: 'patch-failed',
      projectDir: root,
      plan: {
        proposalId: 'patch-failed',
        patchId: 'ignored-plan-id',
        changes: [],
        candidateVerification: {
          erc: { ok: false, status: 'failed', errorCount: 2, erc: { errorCount: 2 } }
        }
      }
    });
    const failed = await approve(root, 'patch-failed', registry);
    assert.equal(failed.ok, false);
    assert.equal(failed.error.code, 'ERC_BLOCKED');
    assert.deepEqual(warnings, []);

    warnings.length = 0;
    registry.register({
      patchId: 'patch-skipped',
      projectDir: root,
      plan: {
        proposalId: 'patch-skipped',
        changes: [],
        candidateVerification: {
          erc: { ok: true, skipped: true, executed: false }
        }
      }
    });
    const skipped = await approve(root, 'patch-skipped', registry);
    assert.equal(skipped.ok, false);
    assert.equal(skipped.error.code, 'ERC_BLOCKED');
    assert.deepEqual(warnings, []);
  } finally {
    console.warn = originalWarn;
    registry.disposeAll();
    await rm(root, { force: true, recursive: true });
  }
});
