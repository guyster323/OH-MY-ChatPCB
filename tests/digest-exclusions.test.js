import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { collectArtifactInventory } from '../src/evidence/artifact-inventory.js';
import { digestArtifactKind, isExcludedFromDigest } from '../src/evidence/digest-exclusions.js';
import { collectTransactionInventory } from '../src/evidence/transaction-inventory.js';

const BYPRODUCTS = [
  { name: '*.lck', file: 'board.kicad_sch.lck', body: 'lock' },
  { name: '*.LCK', file: 'board.kicad_sch.LCK', body: 'lock' },
  { name: '*-backups/**', file: 'board-backups/old.kicad_sch', body: '(kicad_sch backup)' },
  { name: '*-BACKUPS/**', file: 'X-BACKUPS/old.kicad_sch', body: '(kicad_sch backup)' },
  { name: '_autosave-*', file: '_autosave-board.kicad_sch', body: '(kicad_sch autosave)' },
  { name: '_AUTOSAVE-*', file: '_AUTOSAVE-X.kicad_sch', body: '(kicad_sch autosave)' },
  { name: '*.kicad_sch-bak', file: 'board.kicad_sch-bak', body: 'sch-bak' },
  { name: '*.kicad_sch-BAK', file: 'board.kicad_sch-BAK', body: 'sch-bak' },
  { name: '*.kicad_pcb-bak', file: 'board.kicad_pcb-bak', body: 'pcb-bak' },
  { name: '*.kicad_pcb-BAK', file: 'board.kicad_pcb-BAK', body: 'pcb-bak' },
  { name: 'fp-info-cache', file: 'fp-info-cache', body: 'cache' },
  { name: 'FP-INFO-CACHE', file: 'FP-INFO-CACHE', body: 'cache' },
  { name: '*.kicad_prl', file: 'board.kicad_prl', body: 'prl' },
  { name: '*.KICAD_PRL', file: 'board.KICAD_PRL', body: 'prl' },
  { name: 'x-bak.kicad_sch', file: 'x-bak.kicad_sch', body: '(kicad_sch real)', excluded: false }
];

async function writeProject(root, extra = []) {
  await writeFile(path.join(root, 'board.kicad_sch'), 'schematic-v1');
  await writeFile(path.join(root, 'board.kicad_pcb'), 'board-v1');
  await writeFile(path.join(root, 'board.chatpcb.json'), '{"note":"v1"}\n');
  await writeFile(path.join(root, '.chatpcb-conversation.json'), '{"messages":[]}\n');
  for (const item of extra) {
    const absolute = path.join(root, ...item.file.split('/'));
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, item.body);
  }
}

async function digests(root) {
  const artifact = await collectArtifactInventory({ projectDir: root });
  const transaction = await collectTransactionInventory({ projectDir: root });
  return { artifact, transaction };
}

test('KiCad by-products do not change the panel or daemon digest', async (t) => {
  for (const byproduct of BYPRODUCTS) {
    await t.test(byproduct.name, async () => {
      const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-digest-skip-'));
      try {
        await writeProject(root);
        const before = await digests(root);
        assert.equal(before.artifact.projectDigest, before.transaction.transactionDigest);
        await writeProject(root, [byproduct]);
        const after = await digests(root);
        const excluded = byproduct.excluded !== false;
        assert.equal(isExcludedFromDigest(byproduct.file), excluded, byproduct.file);
        if (excluded) assert.equal(digestArtifactKind(byproduct.file), null, byproduct.file);
        else assert.equal(digestArtifactKind(byproduct.file), 'schematic', byproduct.file);
        assert.equal(after.artifact.projectDigest === before.artifact.projectDigest, excluded, byproduct.file);
        assert.equal(after.transaction.transactionDigest === before.transaction.transactionDigest, excluded, byproduct.file);
        assert.equal(after.artifact.projectDigest, after.transaction.transactionDigest);
        assert.equal(after.artifact.artifacts.some((item) => item.path === byproduct.file), !excluded);
        assert.equal(after.transaction.artifacts.some((item) => item.path === byproduct.file), !excluded);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

test('panel and daemon inventories share one digest for the same directory', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-digest-same-'));
  try {
    await writeProject(root, BYPRODUCTS);
    await mkdir(path.join(root, 'board-backups', 'nested'), { recursive: true });
    await writeFile(path.join(root, 'board-backups', 'nested', 'old.kicad_pcb'), 'nested-backup');
    const first = await digests(root);
    assert.equal(first.artifact.projectDigest, first.transaction.transactionDigest);
    assert.deepEqual(
      first.artifact.artifacts.map((item) => item.path),
      first.transaction.artifacts.map((item) => item.path)
    );
    assert.deepEqual(first.artifact.artifacts, first.transaction.artifacts);
    assert.equal(first.artifact.artifacts.some((item) => item.path === 'board.chatpcb.json'), false);
    assert.equal(first.transaction.artifacts.some((item) => item.path === 'board.chatpcb.json'), false);
    assert.equal(isExcludedFromDigest('board.chatpcb.json'), true);
    assert.equal(isExcludedFromDigest('notes.evidence.json'), true);
    assert.equal(isExcludedFromDigest('.chatpcb-conversation.json'), false);
    assert.equal(digestArtifactKind('.chatpcb-conversation.json'), 'conversation');
    assert.ok(first.artifact.artifacts.some((item) => item.path === '.chatpcb-conversation.json'));

    await writeFile(path.join(root, 'board.chatpcb.json'), '{"note":"v2"}\n');
    await writeFile(path.join(root, 'board.evidence.json'), '{"evidence":1}\n');
    const specEdit = await digests(root);
    assert.equal(specEdit.artifact.projectDigest, first.artifact.projectDigest);
    assert.equal(specEdit.artifact.projectDigest, specEdit.transaction.transactionDigest);

    await writeFile(path.join(root, '.chatpcb-conversation.json'), '{"messages":["hello"]}\n');
    const conversationEdit = await digests(root);
    assert.notEqual(conversationEdit.artifact.projectDigest, specEdit.artifact.projectDigest);
    assert.notEqual(conversationEdit.transaction.transactionDigest, specEdit.transaction.transactionDigest);
    assert.equal(conversationEdit.artifact.projectDigest, conversationEdit.transaction.transactionDigest);

    await writeFile(path.join(root, 'board.kicad_sch'), 'schematic-v2');
    const schematicEdit = await digests(root);
    assert.notEqual(schematicEdit.artifact.projectDigest, conversationEdit.artifact.projectDigest);
    assert.notEqual(schematicEdit.transaction.transactionDigest, conversationEdit.transaction.transactionDigest);
    assert.equal(schematicEdit.artifact.projectDigest, schematicEdit.transaction.transactionDigest);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
