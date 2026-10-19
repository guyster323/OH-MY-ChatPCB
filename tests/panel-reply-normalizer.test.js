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

function without(source, key) {
  const copy = { ...source };
  delete copy[key];
  return copy;
}

function shapesFor(success) {
  return [
    ['success', success, true],
    ['empty', {}, false],
    ['null', null, false],
    ['ok-false', { ...success, ok: false }, false],
    ['error', { ...success, error: { code: 'NOPE', message: 'nope' } }, false],
    ['unexpected', { unexpected: true }, false],
    ['applied-string', { ...success, applied: 'true' }, false],
    ['applied-number', { ...success, applied: 1 }, false],
    ['applied-null', { ...success, applied: null }, false],
    ['applied-object', { ...success, applied: {} }, false],
    ['rolled-back', { ...success, rolledBack: true }, false]
  ];
}

const KINDS = ['project-create', 'project-request', 'project-generate', 'patch-apply', 'inspect', 'auth', 'status'];

// Preview successes are valid project-request replies. Every other pair is cross-kind.
const ACCEPTED_KINDS = {
  'project-create': ['project-create'],
  'project-request': ['project-request'],
  'project-request preview': ['project-request', 'project-generate'],
  'project-generate': ['project-request', 'project-generate'],
  'removal preview': ['project-request', 'project-generate'],
  'patch-apply': ['patch-apply'],
  inspect: ['inspect'],
  auth: ['auth'],
  status: ['status']
};

test('daemon replies accept only the daemon success shape', () => {
  assert.equal(typeof normalize, 'function');
  assert.equal(typeof outcome, 'function');
  for (const reply of REPLIES) {
    const label = reply.label ?? reply.kind;
    for (const [name, value, ok] of shapesFor(reply.success)) {
      const verdict = normalize(value, reply.kind);
      assert.equal(verdict.ok, ok, `${label} ${name} normalize`);
      assert.equal(verdict.kind, reply.kind, `${label} ${name} kind`);
      if (!ok && value && typeof value === 'object' && Object.hasOwn(value, 'applied') && typeof value.applied !== 'boolean') {
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

  // requiresApproval:false is a preview success only for a removal. A non-removal
  // with the same flag is a failure for every preview kind.
  const nonRemovalFalseApproval = {
    requiresApproval: false,
    applied: false,
    patchId: 'sha256:preview',
    files: { 'board.kicad_sch': '(kicad_sch)' }
  };
  for (const kind of ['project-request', 'project-generate']) {
    const verdict = normalize(nonRemovalFalseApproval, kind);
    assert.equal(verdict.ok, false, `non-removal requiresApproval false ${kind}`);
    assert.equal(verdict.kind, kind, `non-removal requiresApproval false ${kind} kind`);
  }
  assert.equal(outcome(nonRemovalFalseApproval).ok, false, 'non-removal requiresApproval false outcome');

  const byLabel = Object.fromEntries(REPLIES.map((reply) => [reply.label ?? reply.kind, reply.success]));
  const omissions = [
    ['project-create', 'displayName', without(byLabel['project-create'], 'displayName')],
    ['project-create', 'slug', without(byLabel['project-create'], 'slug')],
    ['project-create', 'projectDir', without(byLabel['project-create'], 'projectDir')],
    ['project-request', 'operation', without(byLabel['project-request'], 'operation')],
    ['project-request', 'applied', without(byLabel['project-request'], 'applied')],
    ['project-request', 'requiresApproval', without(byLabel['project-request'], 'requiresApproval')],
    ['project-request', 'conversation', without(byLabel['project-request'], 'conversation')],
    ['project-request', 'conversation-null', { ...byLabel['project-request'], conversation: null }],
    ['project-request', 'preview patchId', without(byLabel['project-request preview'], 'patchId')],
    ['project-request', 'preview files', without(byLabel['project-request preview'], 'files')],
    ['project-request', 'preview applied', without(byLabel['project-request preview'], 'applied')],
    ['project-request', 'preview requiresApproval', without(byLabel['project-request preview'], 'requiresApproval')],
    ['project-generate', 'patchId', without(byLabel['project-generate'], 'patchId')],
    ['project-generate', 'files', without(byLabel['project-generate'], 'files')],
    ['project-generate', 'applied', without(byLabel['project-generate'], 'applied')],
    ['project-generate', 'requiresApproval', without(byLabel['project-generate'], 'requiresApproval')],
    ['project-generate', 'removal patchId', without(byLabel['removal preview'], 'patchId')],
    ['project-generate', 'removal files', without(byLabel['removal preview'], 'files')],
    ['project-generate', 'removal applied', without(byLabel['removal preview'], 'applied')],
    ['project-generate', 'removal requiresApproval', without(byLabel['removal preview'], 'requiresApproval')],
    ['patch-apply', 'applied', without(byLabel['patch-apply'], 'applied')],
    ['inspect', 'ok', without(byLabel.inspect, 'ok')],
    ['inspect', 'projectDigest', { ...byLabel.inspect, inspection: {} }],
    ['auth', 'state', without(byLabel.auth, 'state')],
    ['status', 'provider', without(byLabel.status, 'provider')],
    ['status', 'status', without(byLabel.status, 'status')]
  ];
  for (const [kind, name, value] of omissions) {
    const verdict = normalize(value, kind);
    assert.equal(verdict.ok, false, `${kind} missing ${name}`);
    assert.equal(verdict.kind, kind, `${kind} missing ${name} kind`);
    assert.equal(outcome(value).ok, false, `${kind} missing ${name} outcome`);
  }

  for (const reply of REPLIES) {
    const label = reply.label ?? reply.kind;
    const accepted = ACCEPTED_KINDS[label];
    assert.ok(accepted, label);
    for (const kind of KINDS) {
      const verdict = normalize(reply.success, kind);
      assert.equal(verdict.ok, accepted.includes(kind), `${label} fed to ${kind}`);
      assert.equal(verdict.kind, kind, `${label} fed to ${kind} kind`);
    }
  }

  for (const kind of ['nope', '', undefined]) {
    for (const reply of REPLIES) {
      const label = reply.label ?? reply.kind;
      assert.equal(normalize(reply.success, kind).ok, false, `${label} unknown kind ${String(kind)}`);
    }
    assert.equal(normalize({ unexpected: true }, kind).ok, false, `unexpected unknown kind ${String(kind)}`);
  }
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
