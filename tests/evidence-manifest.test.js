import assert from 'node:assert/strict';
import test from 'node:test';

import { createEvidenceManifestV2, evidenceFreshness, normalizeEvidenceManifest, projectDigestForArtifacts } from '../src/evidence/evidence-manifest.js';

test('legacy metadata remains readable but cannot claim current evidence', () => {
  const legacy = normalizeEvidenceManifest({ kind: 'mcu-peripheral', mcu: { family: 'STM32' } });
  assert.equal(legacy.schemaVersion, 1);
  assert.deepEqual(legacy.intent.mcu, { family: 'STM32' });
  assert.equal(evidenceFreshness({ manifest: legacy, projectDigest: 'abc' }).status, 'legacy-unverified');
});

test('schema v2 evidence becomes stale when the saved project digest changes', () => {
  const manifest = normalizeEvidenceManifest({
    schemaVersion: 2,
    artifacts: [{
      path: 'board.kicad_pcb',
      kind: 'board',
      sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      size: 12,
      capturedAt: '2026-09-03T00:00:00.000Z'
    }]
  });
  assert.deepEqual(evidenceFreshness({ manifest, projectDigest: 'new' }), {
    status: 'stale', reason: 'Evidence digest 432401d78c6e802fe1867edd4961b6c76a6e4b55e2a6ed441847d5e479ed2d1c does not match saved project digest new.'
  });
});

test('normalization rejects unsupported versions and malformed arrays', () => {
  assert.throws(() => normalizeEvidenceManifest(null), /object/);
  assert.throws(() => normalizeEvidenceManifest({ schemaVersion: 3 }), /schema version/);
  assert.throws(() => normalizeEvidenceManifest({ schemaVersion: 2, facts: {} }), /facts.*array/);
  assert.throws(() => normalizeEvidenceManifest({ schemaVersion: 2, constraints: {} }), /constraints.*array/);
  assert.throws(() => normalizeEvidenceManifest({ schemaVersion: 2, releaseGates: {} }), /releaseGates.*array/);
  assert.throws(() => normalizeEvidenceManifest({ schemaVersion: 2, artifacts: [{ path: 'C:/secret' }] }), /relative/);
});

test('v2 creation has stable keys, copied arrays, and relative artifact paths', () => {
  const facts = [{ name: 'voltage' }];
  const artifacts = [{ path: 'board.kicad_pcb', kind: 'board', sha256: 'x', size: 1, capturedAt: '2026-09-03T00:00:00.000Z' }];
  const manifest = createEvidenceManifestV2({
    intent: { kind: 'mcu' },
    constraints: [{ id: 'supply-voltage', value: '3.3V' }],
    artifacts,
    toolchain: { kicad: '9' },
    facts,
    findings: undefined,
    approvals: undefined,
    releaseGates: undefined
  });
  assert.deepEqual(Object.keys(manifest), ['schemaVersion', 'intent', 'constraints', 'artifacts', 'toolchain', 'facts', 'findings', 'approvals', 'releaseGates']);
  assert.equal(manifest.schemaVersion, 2);
  assert.deepEqual(manifest.facts, facts);
  assert.notEqual(manifest.facts, facts);
  assert.deepEqual(manifest.constraints, [{ id: 'supply-voltage', value: '3.3V' }]);
  assert.notEqual(manifest.artifacts, artifacts);
  assert.deepEqual(manifest.findings, []);
  assert.deepEqual(manifest.approvals, []);
  assert.deepEqual(manifest.releaseGates, []);
  assert.equal(manifest.artifacts[0].path, 'board.kicad_pcb');
  assert.throws(() => createEvidenceManifestV2({ artifacts: [{ path: 'C:/secret.kicad_pcb' }] }), /relative/);
});

test('v2 manifest digest uses code-point ordering for mixed-case artifact paths', () => {
  const handOrderedInventory = [
    { path: 'B.kicad_sch', kind: 'schematic', sha256: 'b'.repeat(64), size: 2 },
    { path: 'a.kicad_sch', kind: 'schematic', sha256: 'a'.repeat(64), size: 1 }
  ];
  const projectDigest = 'a3cb0691c039c8cd792e4e1a9dbf47f80dd0f3697deae823192f59d8840bbe68';
  const manifest = normalizeEvidenceManifest({ schemaVersion: 2, artifacts: handOrderedInventory.toReversed() });

  assert.equal(projectDigestForArtifacts(manifest.artifacts), projectDigest);
  assert.deepEqual(evidenceFreshness({ manifest, projectDigest }), {
    status: 'current', reason: 'Evidence matches the saved project artifacts.'
  });
});
