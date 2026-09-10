import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  collectTransactionInventory,
  collectTransactionSnapshot,
  transactionArtifactKind
} from '../src/evidence/transaction-inventory.js';
import { createPatchApprovalRegistry } from '../src/runtime/patch-approval-registry.js';
import { createProjectMutexRegistry } from '../src/runtime/project-mutex-registry.js';
import { createTransactionJournal } from '../src/runtime/transaction-journal.js';
import { applyProjectTransaction, rollbackProjectTransaction } from '../src/workflow/project-transaction.js';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const passingVerify = async () => ({
  erc: { ok: true, skipped: false, executed: true, erc: { errorCount: 0, warningCount: 0 } },
  drc: { ok: true, skipped: true }
});

const passingBoardVerify = async () => ({
  erc: { ok: true, skipped: false, executed: true, erc: { errorCount: 0, warningCount: 0 } },
  drc: { ok: true, skipped: false, executed: true, drc: { violationCount: 0, unconnectedCount: 0 } }
});

function realFs() {
  return {
    readFile: fs.readFile,
    writeFile: fs.writeFile,
    mkdir: fs.mkdir,
    rm: fs.rm
  };
}

async function createHarness({ board = false, label = 'chatpcb-txn-' } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), label));
  const stateRoot = await mkdtemp(path.join(tmpdir(), 'chatpcb-txn-state-'));
  await writeFile(path.join(root, 'demo.kicad_sch'), 'before');
  if (board) await writeFile(path.join(root, 'demo.kicad_pcb'), 'pcb-before');
  return {
    root,
    stateRoot,
    schematic: path.join(root, 'demo.kicad_sch'),
    boardPath: path.join(root, 'demo.kicad_pcb'),
    approvalRegistry: createPatchApprovalRegistry(),
    mutexRegistry: createProjectMutexRegistry(),
    journal: createTransactionJournal({ stateRoot }),
    async cleanup() {
      await rm(root, { recursive: true, force: true });
      await rm(stateRoot, { recursive: true, force: true });
    }
  };
}

async function buildPlan(projectDir, edits) {
  const snapshot = await collectTransactionSnapshot({ projectDir });
  const files = new Map(snapshot.files.map((file) => [file.path, file]));
  const artifacts = new Map(snapshot.artifacts.map((item) => [item.path, { ...item }]));
  const changes = [];

  for (const edit of edits) {
    const current = files.get(edit.path);
    if (edit.operation === 'delete') {
      changes.push({
        path: edit.path,
        operation: 'delete',
        beforeBytes: current.bytes,
        beforeHash: current.sha256,
        afterBytes: null,
        afterHash: null
      });
      artifacts.delete(edit.path);
      continue;
    }

    const afterBytes = Buffer.from(edit.afterBytes);
    const contentHash = sha256(afterBytes);
    const afterHash = edit.afterHash ?? contentHash;
    const operation = current ? 'modify' : 'create';
    changes.push({
      path: edit.path,
      operation,
      beforeBytes: current?.bytes ?? null,
      beforeHash: current?.sha256 ?? null,
      afterBytes,
      afterHash
    });
    artifacts.set(edit.path, {
      path: edit.path,
      kind: transactionArtifactKind(edit.path),
      sha256: contentHash,
      size: afterBytes.length
    });
  }

  const sorted = [...artifacts.values()].sort((left, right) => (
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0
  ));

  return {
    proposalId: `sha256:${sha256(Buffer.from(JSON.stringify({
      projectDir,
      paths: edits.map((edit) => edit.path)
    })))}`,
    baseTransactionDigest: snapshot.transactionDigest,
    afterTransactionDigest: sha256(JSON.stringify(sorted)),
    changes,
    source: { id: 'native', version: '1' }
  };
}

function registerPlan(approvalRegistry, projectDir, plan) {
  return approvalRegistry.register({
    patchId: plan.proposalId,
    projectDir,
    ...plan
  });
}

async function applyWith(harness, plan, extra = {}) {
  registerPlan(harness.approvalRegistry, harness.root, plan);
  const options = {
    projectDir: harness.root,
    proposalId: plan.proposalId,
    approvalRegistry: harness.approvalRegistry,
    mutexRegistry: harness.mutexRegistry,
    journal: harness.journal,
    ...extra
  };
  if (!Object.hasOwn(extra, 'verifyAppliedProjectImpl')) {
    options.verifyAppliedProjectImpl = passingVerify;
  }
  return applyProjectTransaction(options);
}

async function fileText(projectDir, relativePath) {
  return readFile(path.join(projectDir, ...relativePath.split('/')), 'utf8');
}

async function assertMissing(projectDir, relativePath) {
  await assert.rejects(readFile(path.join(projectDir, ...relativePath.split('/'))), { code: 'ENOENT' });
}

test('applyProjectTransaction writes planned files and records an applied journal', async () => {
  const harness = await createHarness();
  try {
    const plan = await buildPlan(harness.root, [
      { path: 'demo.kicad_sch', afterBytes: 'after' },
      { path: 'demo.chatpcb.json', afterBytes: '{"ok":true}' }
    ]);
    const result = await applyWith(harness, plan);

    assert.equal(result.applied, true);
    assert.equal(result.transaction.status, 'applied');
    assert.match(result.transaction.transactionId, /^txn_[0-9a-f-]{36}$/);
    assert.equal(await readFile(harness.schematic, 'utf8'), 'after');
    assert.equal(await fileText(harness.root, 'demo.chatpcb.json'), '{"ok":true}');
    assert.equal(
      (await collectTransactionInventory({ projectDir: harness.root })).transactionDigest,
      plan.afterTransactionDigest
    );
    assert.equal(
      harness.approvalRegistry.peek({ patchId: plan.proposalId, projectDir: harness.root }).ok,
      false
    );
  } finally {
    await harness.cleanup();
  }
});

test('applyProjectTransaction creates parent directories for nested paths', async () => {
  const harness = await createHarness();
  try {
    const plan = await buildPlan(harness.root, [
      { path: 'demo.kicad_sch', afterBytes: 'after' },
      { path: 'nested/전원.chatpcb.json', afterBytes: '{"nested":true}' }
    ]);
    const result = await applyWith(harness, plan);
    assert.equal(result.applied, true);
    assert.equal(await fileText(harness.root, 'nested/전원.chatpcb.json'), '{"nested":true}');
  } finally {
    await harness.cleanup();
  }
});

const FAILURES = [
  {
    name: 'stale transaction digest',
    expectedCode: 'PROPOSAL_STALE',
    journalStatus: null,
    consumed: false,
    async setup(harness) {
      await writeFile(harness.schematic, 'stale-live');
    }
  },
  {
    name: 'stale before hash',
    expectedCode: 'PROPOSAL_STALE',
    journalStatus: null,
    consumed: false,
    async setup(harness) {
      const frozen = await collectTransactionSnapshot({ projectDir: harness.root });
      await writeFile(harness.schematic, 'hash-stale');
      return {
        collectSnapshotImpl: async () => frozen
      };
    }
  },
  {
    name: 'create failure',
    expectedCode: 'TRANSACTION_WRITE_FAILED',
    journalStatus: 'auto-rolled-back',
    consumed: true,
    async setup() {
      return {
        fsImpl: {
          ...realFs(),
          async writeFile(target, data, options) {
            if (String(target).endsWith('.chatpcb.json')) {
              const error = new Error('injected create failure');
              error.code = 'EIO';
              throw error;
            }
            return fs.writeFile(target, data, options);
          }
        }
      };
    }
  },
  {
    name: 'second-write failure',
    expectedCode: 'TRANSACTION_WRITE_FAILED',
    journalStatus: 'auto-rolled-back',
    consumed: true,
    board: true,
    edits: [
      { path: 'demo.kicad_sch', afterBytes: 'after' },
      { path: 'demo.kicad_pcb', afterBytes: 'pcb-after' }
    ],
    verifyAppliedProjectImpl: passingBoardVerify,
    async setup() {
      let writes = 0;
      return {
        fsImpl: {
          ...realFs(),
          async writeFile(target, data, options) {
            const text = Buffer.from(data).toString();
            if (text === 'after' || text === 'pcb-after') {
              writes += 1;
              if (writes >= 2) {
                const error = new Error('injected second write failure');
                error.code = 'EIO';
                throw error;
              }
            }
            return fs.writeFile(target, data, options);
          }
        }
      };
    }
  },
  {
    name: 'delete failure',
    expectedCode: 'TRANSACTION_WRITE_FAILED',
    journalStatus: 'auto-rolled-back',
    consumed: true,
    board: true,
    edits: [
      { path: 'demo.kicad_sch', afterBytes: 'after' },
      { path: 'demo.kicad_pcb', operation: 'delete' }
    ],
    verifyAppliedProjectImpl: passingBoardVerify,
    async setup() {
      return {
        fsImpl: {
          ...realFs(),
          async rm(target, options) {
            const error = new Error('injected delete failure');
            error.code = 'EPERM';
            throw error;
          }
        }
      };
    }
  },
  {
    name: 'after-hash mismatch',
    expectedCode: 'TRANSACTION_WRITE_FAILED',
    journalStatus: 'auto-rolled-back',
    consumed: true,
    edits: [
      { path: 'demo.kicad_sch', afterBytes: 'after', afterHash: '0'.repeat(64) },
      { path: 'demo.chatpcb.json', afterBytes: '{"ok":true}' }
    ]
  },
  {
    name: 'required ERC skip',
    expectedCode: 'VERIFICATION_UNAVAILABLE',
    journalStatus: 'auto-rolled-back',
    consumed: true,
    verifyAppliedProjectImpl: async () => ({
      erc: { ok: true, skipped: true, reason: { code: 'KICAD_CLI_UNAVAILABLE', message: 'missing' } },
      drc: { ok: true, skipped: true }
    })
  },
  {
    name: 'required ERC failure',
    expectedCode: 'VERIFICATION_FAILED',
    journalStatus: 'auto-rolled-back',
    consumed: true,
    verifyAppliedProjectImpl: async () => ({
      erc: { ok: false, skipped: false, executed: true, erc: { errorCount: 1, warningCount: 0 } },
      drc: { ok: true, skipped: true }
    })
  },
  {
    name: 'required DRC skip',
    expectedCode: 'VERIFICATION_UNAVAILABLE',
    journalStatus: 'auto-rolled-back',
    consumed: true,
    board: true,
    edits: [
      { path: 'demo.kicad_sch', afterBytes: 'after' },
      { path: 'demo.kicad_pcb', afterBytes: 'pcb-after' }
    ],
    verifyAppliedProjectImpl: async () => ({
      erc: { ok: true, skipped: false, executed: true },
      drc: { ok: true, skipped: true, reason: { code: 'KICAD_CLI_UNAVAILABLE', message: 'missing' } }
    })
  },
  {
    name: 'required DRC failure',
    expectedCode: 'VERIFICATION_FAILED',
    journalStatus: 'auto-rolled-back',
    consumed: true,
    board: true,
    edits: [
      { path: 'demo.kicad_sch', afterBytes: 'after' },
      { path: 'demo.kicad_pcb', afterBytes: 'pcb-after' }
    ],
    verifyAppliedProjectImpl: async () => ({
      erc: { ok: true, skipped: false, executed: true },
      drc: { ok: false, skipped: false, executed: true, drc: { violationCount: 1, unconnectedCount: 0 } }
    })
  }
];

test('applyProjectTransaction restores every file for injected failures', async (t) => {
  for (const row of FAILURES) {
    await t.test(row.name, async () => {
      const harness = await createHarness({ board: row.board === true });
      try {
        const edits = row.edits ?? [
          { path: 'demo.kicad_sch', afterBytes: 'after' },
          { path: 'demo.chatpcb.json', afterBytes: '{"ok":true}' }
        ];
        const plan = await buildPlan(harness.root, edits);
        const extra = {
          verifyAppliedProjectImpl: row.verifyAppliedProjectImpl ?? passingVerify,
          ...(await row.setup?.(harness) ?? {})
        };
        const result = await applyWith(harness, plan, extra);

        assert.equal(result.applied, false);
        assert.equal(result.reason.code, row.expectedCode);
        if (row.name === 'stale transaction digest') {
          assert.equal(await readFile(harness.schematic, 'utf8'), 'stale-live');
        } else if (row.name === 'stale before hash') {
          assert.equal(await readFile(harness.schematic, 'utf8'), 'hash-stale');
        } else {
          assert.equal(await readFile(harness.schematic, 'utf8'), 'before');
          if (!row.edits || row.edits.some((edit) => edit.path === 'demo.chatpcb.json')) {
            await assertMissing(harness.root, 'demo.chatpcb.json');
          }
          if (row.board) {
            assert.equal(await readFile(harness.boardPath, 'utf8'), 'pcb-before');
          }
        }

        const listed = await harness.journal.list({ projectDir: harness.root });
        if (row.journalStatus == null) {
          assert.equal(listed.length, 0);
          assert.equal(result.transaction, undefined);
        } else {
          assert.equal(result.transaction.status, row.journalStatus);
          assert.equal(listed[0].status, row.journalStatus);
        }

        const peeked = harness.approvalRegistry.peek({ patchId: plan.proposalId, projectDir: harness.root });
        assert.equal(peeked.ok, !row.consumed);
      } finally {
        await harness.cleanup();
      }
    });
  }
});

test('restoration failure marks rollback-failed and preserves the journal', async () => {
  const harness = await createHarness();
  try {
    const plan = await buildPlan(harness.root, [
      { path: 'demo.kicad_sch', afterBytes: 'after' },
      { path: 'demo.chatpcb.json', afterBytes: '{"ok":true}' }
    ]);
    const result = await applyWith(harness, plan, {
      fsImpl: {
        ...realFs(),
        async writeFile(target, data, options) {
          if (Buffer.from(data).toString() === 'before') {
            const error = new Error('injected restoration failure');
            error.code = 'EACCES';
            throw error;
          }
          return fs.writeFile(target, data, options);
        }
      },
      verifyAppliedProjectImpl: async () => ({
        erc: { ok: false, skipped: false, executed: true, erc: { errorCount: 1, warningCount: 0 } },
        drc: { ok: true, skipped: true }
      })
    });

    assert.equal(result.applied, false);
    assert.equal(result.reason.code, 'ROLLBACK_FAILED');
    assert.equal(result.transaction.status, 'rollback-failed');
    const listed = await harness.journal.list({ projectDir: harness.root });
    assert.equal(listed.length, 1);
    assert.equal(listed[0].status, 'rollback-failed');
    assert.equal(listed[0].transactionId, result.transaction.transactionId);
  } finally {
    await harness.cleanup();
  }
});

test('rollbackProjectTransaction restores the before digest', async () => {
  const harness = await createHarness();
  try {
    const plan = await buildPlan(harness.root, [
      { path: 'demo.kicad_sch', afterBytes: 'after' },
      { path: 'demo.chatpcb.json', afterBytes: '{"ok":true}' }
    ]);
    const applied = await applyWith(harness, plan);
    assert.equal(applied.applied, true);

    const result = await rollbackProjectTransaction({
      projectDir: harness.root,
      transactionId: applied.transaction.transactionId,
      mutexRegistry: harness.mutexRegistry,
      journal: harness.journal
    });

    assert.equal(result.rolledBack, true);
    assert.equal(result.transaction.status, 'rolled-back');
    assert.equal(await readFile(harness.schematic, 'utf8'), 'before');
    await assertMissing(harness.root, 'demo.chatpcb.json');
    assert.equal(
      (await collectTransactionInventory({ projectDir: harness.root })).transactionDigest,
      plan.baseTransactionDigest
    );
  } finally {
    await harness.cleanup();
  }
});

test('rollback after a later saved edit returns ROLLBACK_STALE', async () => {
  const harness = await createHarness();
  try {
    const plan = await buildPlan(harness.root, [
      { path: 'demo.kicad_sch', afterBytes: 'after' },
      { path: 'demo.chatpcb.json', afterBytes: '{"ok":true}' }
    ]);
    const applied = await applyWith(harness, plan);
    await writeFile(harness.schematic, 'later-edit');

    const result = await rollbackProjectTransaction({
      projectDir: harness.root,
      transactionId: applied.transaction.transactionId,
      mutexRegistry: harness.mutexRegistry,
      journal: harness.journal
    });

    assert.equal(result.rolledBack, false);
    assert.equal(result.reason.code, 'ROLLBACK_STALE');
    assert.equal(await readFile(harness.schematic, 'utf8'), 'later-edit');
    assert.equal(await fileText(harness.root, 'demo.chatpcb.json'), '{"ok":true}');
    assert.equal(
      (await harness.journal.get({ transactionId: applied.transaction.transactionId })).status,
      'applied'
    );
  } finally {
    await harness.cleanup();
  }
});

test('needs-inspection journals block apply and rollback', async () => {
  const harness = await createHarness();
  try {
    const crashed = await harness.journal.prepare({
      projectDir: harness.root,
      beforeTransactionDigest: 'before',
      afterTransactionDigest: 'after',
      changes: [{ path: 'demo.kicad_sch', operation: 'modify', beforeBytes: Buffer.from('before'), beforeHash: 'x' }],
      proposal: { proposalId: 'sha256:crash' }
    });
    await harness.journal.transition({ transactionId: crashed.transactionId, status: 'applying' });
    await harness.journal.transition({ transactionId: crashed.transactionId, status: 'needs-inspection' });

    const plan = await buildPlan(harness.root, [
      { path: 'demo.kicad_sch', afterBytes: 'after' }
    ]);
    const applyResult = await applyWith(harness, plan);
    assert.equal(applyResult.applied, false);
    assert.equal(applyResult.reason.code, 'TRANSACTION_NEEDS_INSPECTION');
    assert.equal(await readFile(harness.schematic, 'utf8'), 'before');
    assert.equal(
      harness.approvalRegistry.peek({ patchId: plan.proposalId, projectDir: harness.root }).ok,
      true
    );

    const rollbackResult = await rollbackProjectTransaction({
      projectDir: harness.root,
      transactionId: crashed.transactionId,
      mutexRegistry: harness.mutexRegistry,
      journal: harness.journal
    });
    assert.equal(rollbackResult.rolledBack, false);
    assert.equal(rollbackResult.reason.code, 'TRANSACTION_NEEDS_INSPECTION');
    assert.equal(
      (await harness.journal.get({ transactionId: crashed.transactionId })).status,
      'needs-inspection'
    );
  } finally {
    await harness.cleanup();
  }
});

test('apply rejects unsafe relative paths and invalid rollback ids', async () => {
  const harness = await createHarness();
  try {
    const plan = await buildPlan(harness.root, [
      { path: 'demo.kicad_sch', afterBytes: 'after' }
    ]);
    plan.changes[0].path = '../stolen.kicad_sch';
    const applyResult = await applyWith(harness, plan);
    assert.equal(applyResult.applied, false);
    assert.equal(applyResult.reason.code, 'UNSAFE_TRANSACTION_PATH');
    assert.equal(await readFile(harness.schematic, 'utf8'), 'before');
    assert.equal(
      harness.approvalRegistry.peek({ patchId: plan.proposalId, projectDir: harness.root }).ok,
      true
    );

    const rollbackResult = await rollbackProjectTransaction({
      projectDir: harness.root,
      transactionId: '../not-a-txn',
      mutexRegistry: harness.mutexRegistry,
      journal: harness.journal
    });
    assert.equal(rollbackResult.rolledBack, false);
    assert.equal(rollbackResult.reason.code, 'JOURNAL_NOT_FOUND');
  } finally {
    await harness.cleanup();
  }
});

test('default verification runs ERC and DRC on a disposable copy with explicit targets', async () => {
  const harness = await createHarness({ board: true });
  try {
    const plan = await buildPlan(harness.root, [
      { path: 'demo.kicad_sch', afterBytes: 'after' },
      { path: 'demo.kicad_pcb', afterBytes: 'pcb-after' }
    ]);
    const calls = [];
    const result = await applyWith(harness, plan, {
      verifyAppliedProjectImpl: undefined,
      async copyInspectionTreeImpl(projectDir, destination) {
        await mkdir(destination, { recursive: true });
        await writeFile(path.join(destination, 'demo.kicad_sch'), await readFile(path.join(projectDir, 'demo.kicad_sch')));
        await writeFile(path.join(destination, 'demo.kicad_pcb'), await readFile(path.join(projectDir, 'demo.kicad_pcb')));
        return destination;
      },
      async validateProjectImpl(options) {
        calls.push({ kind: 'erc', ...options });
        return { ok: true, skipped: false, executed: true, erc: { errorCount: 0, warningCount: 0 } };
      },
      async validateBoardImpl(options) {
        calls.push({ kind: 'drc', ...options });
        return { ok: true, skipped: false, executed: true, drc: { violationCount: 0, unconnectedCount: 0 } };
      }
    });

    assert.equal(result.applied, true);
    assert.equal(calls.length, 2);
    const erc = calls.find((call) => call.kind === 'erc');
    const drc = calls.find((call) => call.kind === 'drc');
    assert.notEqual(erc.projectDir, harness.root);
    assert.notEqual(drc.projectDir, harness.root);
    assert.equal(erc.excludeProjectDir, path.resolve(harness.root));
    assert.equal(path.basename(erc.schematicPath), 'demo.kicad_sch');
    assert.equal(path.basename(drc.boardPath), 'demo.kicad_pcb');
    assert.ok(erc.schematicPath.startsWith(erc.projectDir));
    assert.ok(drc.boardPath.startsWith(drc.projectDir));
  } finally {
    await harness.cleanup();
  }
});
