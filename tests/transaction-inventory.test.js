import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  collectTransactionInventory,
  collectTransactionSnapshot,
  transactionArtifactKind
} from '../src/evidence/transaction-inventory.js';

const ALLOWLISTED_KINDS = [
  'project',
  'schematic',
  'board',
  'symbol-library',
  'footprint',
  'design-rules',
  'chatpcb-manifest',
  'spice',
  'symbol-table',
  'footprint-table'
];

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-transaction-inventory-'));
  await mkdir(path.join(root, 'nested'));
  await writeFile(path.join(root, 'board.kicad_pro'), 'pro-v1');
  await writeFile(path.join(root, 'root.kicad_sch'), 'sch-root');
  await writeFile(path.join(root, 'nested', '전원.kicad_sch'), 'sch-nested');
  await writeFile(path.join(root, 'board.kicad_pcb'), 'pcb-v1');
  await writeFile(path.join(root, 'lib.kicad_sym'), 'sym-v1');
  await writeFile(path.join(root, 'nested', 'foot.kicad_mod'), 'mod-v1');
  await writeFile(path.join(root, 'rules.kicad_dru'), 'dru-v1');
  await writeFile(path.join(root, 'board.chatpcb.json'), '{"kind":"manifest"}');
  await writeFile(path.join(root, 'sim.cir'), 'cir-v1');
  await writeFile(path.join(root, 'sym-lib-table'), 'sym-table');
  await writeFile(path.join(root, 'fp-lib-table'), 'fp-table');
  await writeFile(path.join(root, 'board.kicad_prl'), 'prl-transient');
  await writeFile(path.join(root, 'chatpcb-erc.json'), '{"transient":true}');
  await writeFile(path.join(root, 'chatpcb-drc.json'), '{"transient":true}');
  await writeFile(path.join(root, 'ignored.txt'), 'not-inventoried');
  return root;
}

test('collectTransactionInventory includes every allowlisted kind and is byte-identical', async () => {
  const root = await fixture();
  try {
    const first = await collectTransactionInventory({ projectDir: root });
    const second = await collectTransactionInventory({ projectDir: root });
    assert.deepEqual(second, first);
    assert.ok(first.artifacts.some((item) => item.path === 'nested/전원.kicad_sch'));
    assert.ok(first.artifacts.some((item) => item.path.endsWith('.chatpcb.json')));
    assert.ok(first.artifacts.some((item) => item.path.endsWith('.kicad_mod')));
    assert.ok(first.artifacts.some((item) => item.path.endsWith('.kicad_dru')));
    assert.ok(!first.artifacts.some((item) => item.path.endsWith('.kicad_prl')));
    assert.ok(!first.artifacts.some((item) => item.path === 'chatpcb-erc.json'));
    assert.ok(!first.artifacts.some((item) => item.path === 'chatpcb-drc.json'));
    assert.ok(!first.artifacts.some((item) => item.path === 'ignored.txt'));
    assert.equal(first.artifacts.every((item) => !item.path.includes('\\')), true);
    const paths = first.artifacts.map((item) => item.path);
    assert.deepEqual(paths, [...paths].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)));
    const kinds = new Set(first.artifacts.map((item) => item.kind));
    for (const kind of ALLOWLISTED_KINDS) assert.ok(kinds.has(kind), kind);
    assert.equal(first.artifacts.every((item) => /^[a-f0-9]{64}$/.test(item.sha256)), true);
    assert.match(first.transactionDigest, /^[a-f0-9]{64}$/);
    assert.deepEqual(Object.keys(first).sort(), ['artifacts', 'projectDir', 'transactionDigest']);
    assert.equal('files' in first, false);
    assert.equal(first.projectDir, path.resolve(root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('collectTransactionSnapshot attaches the exact read bytes to sorted files', async () => {
  const root = await fixture();
  try {
    const snapshot = await collectTransactionSnapshot({ projectDir: root });
    const inventory = await collectTransactionInventory({ projectDir: root });
    assert.deepEqual(snapshot.artifacts, inventory.artifacts);
    assert.equal(snapshot.transactionDigest, inventory.transactionDigest);
    assert.equal(snapshot.files.length, snapshot.artifacts.length);
    for (const [index, file] of snapshot.files.entries()) {
      assert.equal(file.path, snapshot.artifacts[index].path);
      assert.equal(file.kind, snapshot.artifacts[index].kind);
      assert.ok(Buffer.isBuffer(file.bytes));
      assert.equal(file.size, file.bytes.length);
      assert.equal(file.sha256, createHash('sha256').update(file.bytes).digest('hex'));
      assert.equal(file.size, snapshot.artifacts[index].size);
      assert.equal(file.sha256, snapshot.artifacts[index].sha256);
    }
    const nested = snapshot.files.find((item) => item.path === 'nested/전원.kicad_sch');
    assert.equal(nested.bytes.toString('utf8'), 'sch-nested');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('transactionArtifactKind classifies allowlisted names and rejects transients', () => {
  assert.equal(transactionArtifactKind('nested/전원.kicad_sch'), 'schematic');
  assert.equal(transactionArtifactKind('board.chatpcb.json'), 'chatpcb-manifest');
  assert.equal(transactionArtifactKind('sym-lib-table'), 'symbol-table');
  assert.equal(transactionArtifactKind('fp-lib-table'), 'footprint-table');
  assert.equal(transactionArtifactKind(`libs${path.sep}fp-lib-table`), 'footprint-table');
  assert.equal(transactionArtifactKind('board.kicad_prl'), null);
  assert.equal(transactionArtifactKind('chatpcb-erc.json'), null);
  assert.equal(transactionArtifactKind('chatpcb-drc.json'), null);
});

const PROTECTED_MUTATIONS = [
  { name: 'project', file: 'demo.kicad_pro', before: 'pro-1', after: 'pro-2' },
  { name: 'schematic', file: 'demo.kicad_sch', before: 'sch-1', after: 'sch-2' },
  { name: 'board', file: 'demo.kicad_pcb', before: 'pcb-1', after: 'pcb-2' },
  { name: 'symbol-library', file: 'demo.kicad_sym', before: 'sym-1', after: 'sym-2' },
  { name: 'footprint', file: 'demo.kicad_mod', before: 'mod-1', after: 'mod-2' },
  { name: 'design-rules', file: 'demo.kicad_dru', before: 'dru-1', after: 'dru-2' },
  { name: 'chatpcb-manifest', file: 'demo.chatpcb.json', before: '{"n":1}', after: '{"n":2}' },
  { name: 'spice', file: 'demo.cir', before: 'cir-1', after: 'cir-2' },
  { name: 'symbol-table', file: 'sym-lib-table', before: 'sym-1', after: 'sym-2' },
  { name: 'footprint-table', file: 'fp-lib-table', before: 'fp-1', after: 'fp-2' }
];

test('mutating one byte of a protected artifact changes the transaction digest', async (t) => {
  for (const mutation of PROTECTED_MUTATIONS) {
    await t.test(mutation.name, async () => {
      const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-transaction-mutate-'));
      try {
        await writeFile(path.join(root, mutation.file), mutation.before);
        const first = await collectTransactionInventory({ projectDir: root });
        await writeFile(path.join(root, mutation.file), mutation.after);
        const second = await collectTransactionInventory({ projectDir: root });
        assert.notEqual(first.transactionDigest, second.transactionDigest);
        assert.notEqual(first.artifacts[0].sha256, second.artifacts[0].sha256);
        assert.equal(first.artifacts[0].kind, mutation.name);
        assert.equal(second.artifacts[0].kind, mutation.name);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

test('rejects inspection links before returning snapshot bytes', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-transaction-link-'));
  const outside = await mkdtemp(path.join(tmpdir(), 'chatpcb-transaction-outside-'));
  const linkPath = path.join(root, 'library');
  try {
    await writeFile(path.join(root, 'demo.kicad_sch'), 'sch-v1');
    await writeFile(path.join(outside, 'hidden.kicad_pcb'), 'hidden');
    await symlink(outside, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(collectTransactionSnapshot({ projectDir: root }), { code: 'UNSAFE_INSPECTION_LINK' });
    await assert.rejects(collectTransactionInventory({ projectDir: root }), { code: 'UNSAFE_INSPECTION_LINK' });
  } catch (error) {
    if (error.code === 'EPERM' || error.code === 'ENOTSUP') t.skip('Symlink creation unavailable');
    else throw error;
  } finally {
    await rm(linkPath, { force: true, recursive: true });
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
