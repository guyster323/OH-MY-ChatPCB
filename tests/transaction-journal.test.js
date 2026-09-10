import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createTransactionJournal } from '../src/runtime/transaction-journal.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const SEVEN_DAYS = 7 * DAY_MS;

async function mkdirTemp(label) {
  return mkdtemp(path.join(tmpdir(), label));
}

async function makeRoot(label = 'chatpcb-journal-') {
  return mkdirTemp(label);
}

function sampleChanges() {
  return [{
    path: 'demo.kicad_sch',
    operation: 'modify',
    beforeBytes: Buffer.from('old'),
    beforeHash: 'old-hash'
  }];
}

function sampleProposal() {
  return { proposalId: 'sha256:test', source: { id: 'native', version: '1' } };
}

async function prepareSample(journal, projectDir, extra = {}) {
  return journal.prepare({
    projectDir,
    beforeTransactionDigest: extra.beforeTransactionDigest ?? 'before',
    afterTransactionDigest: extra.afterTransactionDigest ?? 'after',
    changes: extra.changes ?? sampleChanges(),
    proposal: extra.proposal ?? sampleProposal()
  });
}

async function complete(journal, record, status, patch) {
  await journal.transition({ transactionId: record.transactionId, status: 'applying' });
  return journal.transition({ transactionId: record.transactionId, status, patch });
}

async function projectKeyFor(projectDir) {
  const canonical = await realpath(path.resolve(projectDir));
  return createHash('sha256').update(canonical).digest('hex');
}

async function journalFiles(stateRoot, projectDir) {
  const directory = path.join(stateRoot, await projectKeyFor(projectDir));
  try {
    return await readdir(directory);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

test('prepare persists schema version 1 records atomically with base64 before bytes', async () => {
  const stateRoot = await mkdirTemp('chatpcb-journal-state-');
  const root = await makeRoot('chatpcb-journal-project-');
  try {
    const journal = createTransactionJournal({ stateRoot, now: () => 1000 });
    const record = await journal.prepare({
      projectDir: root,
      beforeTransactionDigest: 'before',
      afterTransactionDigest: 'after',
      changes: [{ path: 'demo.kicad_sch', operation: 'modify', beforeBytes: Buffer.from('old'), beforeHash: 'old-hash' }],
      proposal: { proposalId: 'sha256:test', source: { id: 'native', version: '1' } }
    });
    assert.equal(record.status, 'prepared');
    assert.equal(record.schemaVersion, 1);
    assert.match(record.transactionId, /^txn_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    assert.equal(record.createdAt, 1000);
    assert.equal(record.updatedAt, 1000);
    assert.equal(record.beforeTransactionDigest, 'before');
    assert.equal(record.afterTransactionDigest, 'after');
    const loaded = await journal.get({ transactionId: record.transactionId });
    assert.equal(loaded.changes[0].beforeBase64, Buffer.from('old').toString('base64'));
    assert.ok(Buffer.isBuffer(loaded.changes[0].beforeBytes));
    assert.equal(loaded.changes[0].beforeBytes.toString('utf8'), 'old');
    assert.equal(loaded.changes[0].beforeHash, 'old-hash');
    assert.equal(loaded.proposal.proposalId, 'sha256:test');

    const projectKey = await projectKeyFor(root);
    assert.equal(loaded.projectKey, projectKey);
    const filePath = path.join(stateRoot, projectKey, `${record.transactionId}.json`);
    const raw = JSON.parse(await readFile(filePath, 'utf8'));
    assert.equal(raw.schemaVersion, 1);
    assert.equal('beforeBytes' in raw.changes[0], false);
    assert.equal(raw.changes[0].beforeBase64, Buffer.from('old').toString('base64'));
    const names = await journalFiles(stateRoot, root);
    assert.deepEqual(names.filter((name) => name.endsWith('.tmp') || name.endsWith('.bak')), []);
    assert.deepEqual(names, [`${record.transactionId}.json`]);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});

test('journal directories are 0o700 and metadata is 0o600 where the platform supports modes', async () => {
  const stateRoot = await mkdirTemp('chatpcb-journal-mode-state-');
  const root = await makeRoot('chatpcb-journal-mode-project-');
  try {
    const journal = createTransactionJournal({ stateRoot, now: () => 1000 });
    const record = await prepareSample(journal, root);
    const projectKey = await projectKeyFor(root);
    const directory = path.join(stateRoot, projectKey);
    const filePath = path.join(directory, `${record.transactionId}.json`);
    const dirStat = await stat(directory);
    const fileStat = await stat(filePath);
    const rootStat = await stat(stateRoot);
    if (process.platform === 'win32') {
      assert.equal(dirStat.isDirectory(), true);
      assert.equal(fileStat.isFile(), true);
      assert.equal(rootStat.isDirectory(), true);
      return;
    }
    assert.equal(rootStat.mode & 0o777, 0o700);
    assert.equal(dirStat.mode & 0o777, 0o700);
    assert.equal(fileStat.mode & 0o777, 0o600);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});

test('list isolates projects and follows canonical path aliases', async () => {
  const stateRoot = await mkdirTemp('chatpcb-journal-list-state-');
  const first = await makeRoot('chatpcb-journal-list-a-');
  const second = await mkdirTemp('chatpcb-journal-한글 경로-');
  try {
    await mkdir(path.join(first, 'nested'), { recursive: true });
    const journal = createTransactionJournal({ stateRoot, now: () => 1000 });
    const firstRecord = await prepareSample(journal, first);
    await prepareSample(journal, second, {
      changes: [{ path: '전원.kicad_sch', operation: 'modify', beforeBytes: Buffer.from('한글'), beforeHash: 'ko-hash' }]
    });
    const aliasListed = await journal.list({ projectDir: path.join(first, 'nested', '..') });
    assert.equal(aliasListed.length, 1);
    assert.equal(aliasListed[0].transactionId, firstRecord.transactionId);
    const secondListed = await journal.list({ projectDir: second });
    assert.equal(secondListed.length, 1);
    assert.equal(secondListed[0].changes[0].path, '전원.kicad_sch');
    assert.equal(secondListed[0].changes[0].beforeBytes.toString('utf8'), '한글');
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(first, { recursive: true, force: true });
    await rm(second, { recursive: true, force: true });
  }
});

test('transition enforces the allowed state set and preserves immutable identity fields', async () => {
  const stateRoot = await mkdirTemp('chatpcb-journal-transition-state-');
  const root = await makeRoot('chatpcb-journal-transition-project-');
  try {
    const journal = createTransactionJournal({ stateRoot, now: () => 1000 });
    const record = await prepareSample(journal, root);
    await assert.rejects(
      journal.transition({ transactionId: record.transactionId, status: 'rolled-back' }),
      (error) => {
        assert.equal(error.code, 'JOURNAL_INVALID_TRANSITION');
        return true;
      }
    );
    const applying = await journal.transition({ transactionId: record.transactionId, status: 'applying' });
    assert.equal(applying.status, 'applying');
    const applied = await journal.transition({
      transactionId: record.transactionId,
      status: 'applied',
      patch: { verification: { erc: { ok: true, skipped: false } } }
    });
    assert.equal(applied.status, 'applied');
    assert.deepEqual(applied.verification, { erc: { ok: true, skipped: false } });
    assert.equal(applied.transactionId, record.transactionId);
    assert.equal(applied.schemaVersion, 1);
    assert.equal(applied.projectKey, record.projectKey);
    assert.equal(applied.projectDir, record.projectDir);
    assert.equal(applied.beforeTransactionDigest, 'before');
    assert.equal(applied.afterTransactionDigest, 'after');
    assert.equal(applied.createdAt, 1000);
    assert.equal(applied.changes[0].beforeBase64, Buffer.from('old').toString('base64'));
    assert.deepEqual(applied.proposal, sampleProposal());
    await assert.rejects(
      journal.transition({
        transactionId: record.transactionId,
        status: 'rolled-back',
        patch: { beforeTransactionDigest: 'mutated' }
      }),
      (error) => {
        assert.equal(error.code, 'JOURNAL_IMMUTABLE_FIELD');
        return true;
      }
    );
    const stillApplied = await journal.get({ transactionId: record.transactionId });
    assert.equal(stillApplied.status, 'applied');
    assert.equal(stillApplied.beforeTransactionDigest, 'before');
    const names = await journalFiles(stateRoot, root);
    assert.deepEqual(names.filter((name) => name.endsWith('.tmp') || name.endsWith('.bak')), []);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});

test('create, modify, and delete changes persist hashes without after bytes', async () => {
  const stateRoot = await mkdirTemp('chatpcb-journal-changes-state-');
  const root = await makeRoot('chatpcb-journal-changes-project-');
  try {
    const journal = createTransactionJournal({ stateRoot, now: () => 1000 });
    const record = await journal.prepare({
      projectDir: root,
      beforeTransactionDigest: 'before',
      afterTransactionDigest: 'after',
      changes: [
        { path: 'created.chatpcb.json', operation: 'create', beforeBytes: null, beforeHash: null, afterBytes: Buffer.from('secret') },
        { path: 'demo.kicad_sch', operation: 'modify', beforeBytes: Buffer.from('old'), beforeHash: 'old-hash' },
        { path: 'gone.kicad_pcb', operation: 'delete', beforeBytes: Buffer.from('pcb'), beforeHash: 'pcb-hash' }
      ],
      proposal: sampleProposal()
    });
    const raw = JSON.parse(await readFile(
      path.join(stateRoot, record.projectKey, `${record.transactionId}.json`),
      'utf8'
    ));
    assert.equal(raw.changes[0].beforeBase64, null);
    assert.equal(raw.changes[0].beforeHash, null);
    assert.equal('afterBytes' in raw.changes[0], false);
    assert.equal(raw.changes[1].beforeBase64, Buffer.from('old').toString('base64'));
    assert.equal(raw.changes[2].beforeBase64, Buffer.from('pcb').toString('base64'));
    const loaded = await journal.get({ transactionId: record.transactionId });
    assert.equal(loaded.changes[0].beforeBytes, null);
    assert.equal(loaded.changes[2].beforeBytes.toString('utf8'), 'pcb');
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});

test('reconcile maps prepared and applying crash states onto aborted, applied, and needs-inspection', async (t) => {
  const cases = [
    { name: 'prepared matches before digest', from: 'prepared', digest: 'before', expected: 'aborted' },
    { name: 'prepared matches after digest', from: 'prepared', digest: 'after', expected: 'applied' },
    { name: 'prepared matches neither digest', from: 'prepared', digest: 'unrelated', expected: 'needs-inspection' },
    { name: 'applying matches before digest', from: 'applying', digest: 'before', expected: 'aborted' },
    { name: 'applying matches after digest', from: 'applying', digest: 'after', expected: 'applied' },
    { name: 'applying matches neither digest', from: 'applying', digest: 'unrelated', expected: 'needs-inspection' }
  ];

  for (const row of cases) {
    await t.test(row.name, async () => {
      const stateRoot = await mkdirTemp('chatpcb-journal-reconcile-state-');
      const root = await makeRoot('chatpcb-journal-reconcile-project-');
      try {
        const journal = createTransactionJournal({ stateRoot, now: () => 1000 });
        const record = await prepareSample(journal, root);
        if (row.from === 'applying') {
          await journal.transition({ transactionId: record.transactionId, status: 'applying' });
        }
        const alreadyApplied = await prepareSample(journal, root);
        await complete(journal, alreadyApplied, 'applied');
        await journal.reconcile({
          projectDir: root,
          collectInventoryImpl: async () => ({ transactionDigest: row.digest })
        });
        assert.equal((await journal.get({ transactionId: record.transactionId })).status, row.expected);
        assert.equal((await journal.get({ transactionId: alreadyApplied.transactionId })).status, 'applied');
      } finally {
        await rm(stateRoot, { recursive: true, force: true });
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

test('prune keeps at most 20 eligible completed journals and never removes inspection or rollback-failed records', async () => {
  let now = 1000;
  const stateRoot = await mkdirTemp('chatpcb-journal-prune-state-');
  const root = await makeRoot('chatpcb-journal-prune-project-');
  try {
    const journal = createTransactionJournal({
      stateRoot,
      now: () => now,
      retentionMs: SEVEN_DAYS,
      maxPerProject: 20
    });

    const oldApplied = await prepareSample(journal, root);
    await complete(journal, oldApplied, 'applied');
    const oldAborted = await prepareSample(journal, root);
    await journal.transition({ transactionId: oldAborted.transactionId, status: 'aborted' });
    const oldRolledBack = await prepareSample(journal, root);
    await complete(journal, oldRolledBack, 'applied');
    await journal.transition({ transactionId: oldRolledBack.transactionId, status: 'rolled-back' });
    const oldAuto = await prepareSample(journal, root);
    await journal.transition({ transactionId: oldAuto.transactionId, status: 'applying' });
    await journal.transition({ transactionId: oldAuto.transactionId, status: 'auto-rolled-back' });
    const inspect = await prepareSample(journal, root);
    await journal.transition({ transactionId: inspect.transactionId, status: 'applying' });
    await journal.reconcile({
      projectDir: root,
      collectInventoryImpl: async () => ({ transactionDigest: 'unrelated' })
    });
    const rollbackFailed = await prepareSample(journal, root);
    await journal.transition({ transactionId: rollbackFailed.transactionId, status: 'applying' });
    await journal.transition({ transactionId: rollbackFailed.transactionId, status: 'rollback-failed' });
    const oldPrepared = await prepareSample(journal, root);
    const oldApplying = await prepareSample(journal, root);
    await journal.transition({ transactionId: oldApplying.transactionId, status: 'applying' });

    now = 1000 + SEVEN_DAYS;
    let listed = await journal.list({ projectDir: root });
    assert.equal(listed.some((item) => item.transactionId === oldApplied.transactionId), true);
    await journal.prune({ projectDir: root });
    listed = await journal.list({ projectDir: root });
    const ids = new Set(listed.map((item) => item.transactionId));
    assert.equal(ids.has(oldApplied.transactionId), true);
    assert.equal(ids.has(oldAborted.transactionId), true);

    now = 1000 + SEVEN_DAYS + 1;
    await journal.prune({ projectDir: root });
    listed = await journal.list({ projectDir: root });
    const remaining = new Set(listed.map((item) => item.transactionId));
    assert.equal(remaining.has(oldApplied.transactionId), false);
    assert.equal(remaining.has(oldAborted.transactionId), false);
    assert.equal(remaining.has(oldRolledBack.transactionId), false);
    assert.equal(remaining.has(oldAuto.transactionId), false);
    assert.equal(remaining.has(oldPrepared.transactionId), true);
    assert.equal(remaining.has(oldApplying.transactionId), true);
    assert.equal(remaining.has(inspect.transactionId), true);
    assert.equal(remaining.has(rollbackFailed.transactionId), true);
    assert.equal((await journal.get({ transactionId: inspect.transactionId })).status, 'needs-inspection');
    assert.equal((await journal.get({ transactionId: rollbackFailed.transactionId })).status, 'rollback-failed');

    now = 2000 + SEVEN_DAYS + 1;
    const kept = [];
    for (let index = 0; index < 21; index += 1) {
      now += 1;
      const record = await prepareSample(journal, root);
      kept.push(await complete(journal, record, 'applied'));
    }
    await journal.prune({ projectDir: root });
    listed = await journal.list({ projectDir: root });
    const applied = listed.filter((item) => item.status === 'applied');
    assert.equal(applied.length, 20);
    assert.equal(listed.some((item) => item.transactionId === inspect.transactionId && item.status === 'needs-inspection'), true);
    assert.equal(listed.some((item) => item.transactionId === rollbackFailed.transactionId && item.status === 'rollback-failed'), true);
    assert.equal(listed.some((item) => item.transactionId === oldPrepared.transactionId), true);
    const appliedIds = new Set(applied.map((item) => item.transactionId));
    const newest = kept[kept.length - 1].transactionId;
    const oldestBatch = kept[0].transactionId;
    assert.equal(appliedIds.has(newest), true);
    assert.equal(appliedIds.has(oldestBatch), false);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});
