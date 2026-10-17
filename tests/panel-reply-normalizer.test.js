import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import '../apps/panel/daemon-reply.js';

const normalize = globalThis.chatpcbNormalizeDaemonReply;
const outcome = globalThis.chatpcbRequestOutcome;

function sliceFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  const end = source.indexOf('\nfunction ', start + 1);
  assert.ok(end > start, name);
  return source.slice(start, end);
}

const preview = {
  operation: 'patched',
  requiresApproval: true,
  approved: false,
  applied: false,
  patchId: 'sha256:preview',
  files: { 'board.kicad_sch': '(kicad_sch)' }
};

const removal = {
  operation: 'patched',
  requiresApproval: false,
  applied: false,
  patchId: 'sha256:preview',
  files: {},
  removedComponents: [{ ref: 'J2' }],
  reason: { code: 'EXISTING_COMPONENTS_REMOVED' }
};

const REPLIES = [
  {
    kind: 'project-create',
    outcomeKind: 'project-create',
    success: { displayName: 'Sensor board', slug: 'Sensor-board', projectDir: '/tmp/chatpcb-ui-project' }
  },
  {
    kind: 'project-request',
    outcomeKind: 'project-request',
    success: {
      operation: 'clarify',
      requiresApproval: false,
      applied: false,
      conversation: { status: 'awaiting-input' },
      assistantMessage: 'Which MCU?',
      nextQuestion: 'Which MCU?'
    }
  },
  {
    kind: 'project-request',
    outcomeKind: 'project-generate',
    label: 'project-request preview',
    success: preview
  },
  {
    kind: 'project-generate',
    outcomeKind: 'project-generate',
    success: {
      requiresApproval: true,
      approved: false,
      applied: false,
      patchId: 'patch-1',
      files: {},
      validation: { ok: true, skipped: false, erc: { errorCount: 0, warningCount: 0 } }
    }
  },
  {
    kind: 'project-generate',
    outcomeKind: 'project-generate',
    label: 'removal preview',
    success: removal
  },
  {
    kind: 'patch-apply',
    outcomeKind: 'patch-apply',
    success: {
      requiresApproval: false,
      approved: true,
      applied: true,
      rolledBack: false,
      files: {},
      fromPatchApprove: true
    }
  },
  {
    kind: 'inspect',
    outcomeKind: 'inspect',
    success: { ok: true, inspection: { projectDigest: 'a'.repeat(64) }, manifest: {} }
  },
  {
    kind: 'auth',
    outcomeKind: 'auth',
    success: { state: 'signed_in', account: { email: 'ada@ex.com' } }
  },
  {
    kind: 'status',
    outcomeKind: 'status',
    success: { provider: 'codex', status: 'available' }
  }
];

function shapesFor(success) {
  return [
    ['success', success, true],
    ['empty', {}, false],
    ['null', null, false],
    ['ok-false', { ...success, ok: false }, false],
    ['error', { ...success, error: { code: 'NOPE', message: 'nope' } }, false],
    ['unknown', { unexpected: true }, false],
    ['applied-string', { ...success, applied: 'true' }, false],
    ['applied-number', { ...success, applied: 1 }, false]
  ];
}

test('daemon replies accept only the daemon success shape', () => {
  assert.equal(typeof normalize, 'function');
  assert.equal(typeof outcome, 'function');
  for (const reply of REPLIES) {
    const label = reply.label ?? reply.kind;
    for (const [name, value, ok] of shapesFor(reply.success)) {
      const verdict = normalize(value, reply.kind);
      assert.equal(verdict.ok, ok, `${label} ${name} normalize`);
      assert.equal(verdict.kind, reply.kind, `${label} ${name} kind`);
      if (!ok && value && typeof value === 'object' && (value.applied === 'true' || value.applied === 1)) {
        assert.equal(verdict.code, 'APPLY_REJECTED', `${label} ${name} code`);
      }
      const routed = outcome(value);
      assert.equal(routed.ok, ok, `${label} ${name} outcome`);
      if (ok) assert.equal(routed.kind, reply.outcomeKind, `${label} ${name} outcome kind`);
    }
  }

  const canceled = { canceled: true, applied: false, files: {} };
  assert.equal(normalize(canceled, 'patch-apply').ok, false);
  assert.equal(normalize(canceled, 'patch-apply').canceled, undefined);
  assert.equal(outcome(canceled).ok, false);

  const looseGenerate = { operation: 'generated', files: {} };
  assert.equal(normalize(looseGenerate, 'project-generate').ok, false);
  assert.equal(outcome(looseGenerate).ok, false);
  assert.equal(outcome(null).ok, false);
  assert.equal(outcome({ ok: false, applied: true }).ok, false);
});

test('focus helper does not rewrite the Apply button', async () => {
  const panel = await readFile(new URL('../apps/panel/panel.js', import.meta.url), 'utf8');
  assert.match(panel, /globalThis\.chatpcbNormalizeDaemonReply\(result, kind\)/);
  assert.match(panel, /globalThis\.chatpcbRequestOutcome\(result\)/);
  const focus = sliceFunction(panel, 'focusApplyButton');
  assert.equal(focus.includes('aria-disabled'), false);
  assert.equal(focus.includes('.disabled'), false);
  assert.match(sliceFunction(panel, 'approvePatchWithoutErc'), /patchApplyBusy\(\)/);
  assert.match(sliceFunction(panel, 'applyGateOpen'), /ercBlockState\(\)\.passed !== true/);
});
