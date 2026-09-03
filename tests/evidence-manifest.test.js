import assert from 'node:assert/strict';
import test from 'node:test';

import { createEvidenceManifestV2, evidenceFreshness, normalizeEvidenceManifest } from '../src/evidence/evidence-manifest.js';

test('legacy metadata remains readable but cannot claim current evidence', () => {
  const legacy = normalizeEvidenceManifest({ kind: 'mcu-peripheral', mcu: { family: 'STM32' } });
  assert.equal(legacy.schemaVersion, 1);
  assert.deepEqual(legacy.intent.mcu, { family: 'STM32' });
  assert.equal(evidenceFreshness({ manifest: legacy, projectDigest: 'abc' }).status, 'legacy-unverified');
});

test('schema v2 evidence becomes stale when the saved project digest changes', () => {
  const manifest = normalizeEvidenceManifest({ schemaVersion: 2, evidence: { projectDigest: 'old' } });
  assert.deepEqual(evidenceFreshness({ manifest, projectDigest: 'new' }), {
    status: 'stale', reason: 'Evidence digest old does not match saved project digest new.'
  });
});

test('normalization rejects unsupported versions and malformed arrays', () => {
  assert.throws(() => normalizeEvidenceManifest(null), /object/);
  assert.throws(() => normalizeEvidenceManifest({ schemaVersion: 3 }), /schema version/);
  assert.throws(() => normalizeEvidenceManifest({ schemaVersion: 2, facts: {} }), /facts.*array/);
  assert.throws(() => normalizeEvidenceManifest({ schemaVersion: 2, artifacts: [{ path: 'C:/secret' }] }), /relative/);
});

test('v2 creation has stable keys, copied arrays, and relative artifact paths', () => {
  const facts = [{ name: 'voltage' }];
  const manifest = createEvidenceManifestV2({ intent: { kind: 'mcu' }, inspection: { artifacts: [{ path: 'board.kicad_pcb', sha256: 'x' }] }, toolchain: { kicad: '9' }, facts, findings: undefined, approvals: undefined });
  assert.deepEqual(Object.keys(manifest), ['schemaVersion', 'intent', 'inspection', 'toolchain', 'evidence', 'facts', 'findings', 'approvals']);
  assert.equal(manifest.schemaVersion, 2);
  assert.deepEqual(manifest.facts, facts);
  assert.notEqual(manifest.facts, facts);
  assert.deepEqual(manifest.findings, []);
  assert.deepEqual(manifest.approvals, []);
  assert.equal(manifest.inspection.artifacts[0].path, 'board.kicad_pcb');
  assert.throws(() => createEvidenceManifestV2({ inspection: { artifacts: [{ path: 'C:/secret.kicad_pcb' }] } }), /relative/);
});
