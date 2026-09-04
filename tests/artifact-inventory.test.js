import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { collectArtifactInventory } from '../src/evidence/artifact-inventory.js';

test('collectArtifactInventory hashes sorted KiCad sources and ignores reports', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-inventory-'));
  try {
    await mkdir(path.join(root, 'sheets'));
    await writeFile(path.join(root, 'board.kicad_pcb'), 'pcb-v1');
    await writeFile(path.join(root, 'sheets', 'power.kicad_sch'), 'sch-v1');
    await writeFile(path.join(root, 'chatpcb-drc.json'), '{"transient":true}');
    const first = await collectArtifactInventory({ projectDir: root });
    const second = await collectArtifactInventory({ projectDir: root });
    assert.deepEqual(first, second);
    assert.deepEqual(first.artifacts.map((item) => item.path), ['board.kicad_pcb', 'sheets/power.kicad_sch']);
    assert.equal(first.artifacts.every((item) => /^[a-f0-9]{64}$/.test(item.sha256)), true);
    assert.match(first.projectDigest, /^[a-f0-9]{64}$/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a source mutation changes its hash and project digest', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-inventory-'));
  try {
    await writeFile(path.join(root, 'main.kicad_sch'), 'v1');
    const first = await collectArtifactInventory({ projectDir: root });
    await writeFile(path.join(root, 'main.kicad_sch'), 'v2');
    const second = await collectArtifactInventory({ projectDir: root });
    assert.notEqual(first.artifacts[0].sha256, second.artifacts[0].sha256);
    assert.notEqual(first.projectDigest, second.projectDigest);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('does not follow symlinks', { skip: process.platform === 'win32' }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-inventory-'));
  const outside = await mkdtemp(path.join(tmpdir(), 'chatpcb-outside-'));
  try {
    await writeFile(path.join(outside, 'hidden.kicad_pcb'), 'hidden');
    await symlink(outside, path.join(root, 'linked'));
    const result = await collectArtifactInventory({ projectDir: root });
    assert.deepEqual(result.artifacts, []);
  } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});
