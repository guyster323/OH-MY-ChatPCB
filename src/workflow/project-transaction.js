import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { collectTransactionInventory, transactionArtifactKind } from '../evidence/transaction-inventory.js';
import { assertInspectionTree, copyInspectionTree } from './inspection-copy.js';
import { assertSafeProjectDir, isInside } from './project-workspace.js';
import { validateBoard } from './validate-board.js';
import { validateProject } from './validate-project.js';

const TXN_ID_RE = /^txn_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PROPOSAL_REASON = {
  PATCH_APPROVAL_MISSING: 'PROPOSAL_MISSING',
  PATCH_APPROVAL_EXPIRED: 'PROPOSAL_EXPIRED',
  PATCH_STALE: 'PROPOSAL_STALE'
};

const APPLY_FAILURE_CODES = new Set([
  'VERIFICATION_UNAVAILABLE',
  'VERIFICATION_FAILED',
  'TRANSACTION_WRITE_FAILED',
  'ROLLBACK_FAILED',
  'PROPOSAL_STALE',
  'UNSAFE_TRANSACTION_PATH'
]);

const defaultFsImpl = { readFile, writeFile, mkdir, rm };

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function coded(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function asBuffer(value) {
  if (value == null) return null;
  return Buffer.isBuffer(value) ? value : Buffer.from(value);
}

function applyResult(reason, extra = {}) {
  return { applied: false, reason, ...extra };
}

function rollbackResult(reason, extra = {}) {
  return { rolledBack: false, reason, ...extra };
}

function mapProposalReason(reason) {
  return {
    code: PROPOSAL_REASON[reason.code] ?? reason.code,
    message: reason.message
  };
}

function planFrom(record) {
  const nested = record.plan && typeof record.plan === 'object' ? record.plan : {};
  return {
    proposalId: record.proposalId ?? nested.proposalId ?? record.patchId,
    baseTransactionDigest: record.baseTransactionDigest ?? nested.baseTransactionDigest,
    afterTransactionDigest: record.afterTransactionDigest ?? nested.afterTransactionDigest,
    changes: record.changes ?? nested.changes ?? [],
    requiredValidation: record.requiredValidation ?? nested.requiredValidation,
    source: record.source ?? nested.source ?? null
  };
}

function requiredValidationFor(plan) {
  if (plan.requiredValidation && typeof plan.requiredValidation === 'object') {
    return {
      erc: plan.requiredValidation.erc === true,
      drc: plan.requiredValidation.drc === true
    };
  }
  return {
    erc: plan.changes.some((change) => change.path.endsWith('.kicad_sch')),
    drc: plan.changes.some((change) => change.path.endsWith('.kicad_pcb'))
  };
}

function requiredOk(result) {
  return result?.ok === true && result.skipped !== true && result.executed !== false;
}

function firstChangedPath(changes, extension) {
  return changes
    .filter((change) => change.path.endsWith(extension) && change.operation !== 'delete')
    .map((change) => change.path)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))[0] ?? null;
}

function serializeVerification(verification) {
  if (verification == null) return null;
  return JSON.parse(JSON.stringify(verification));
}

function applyFailureCode(error) {
  return APPLY_FAILURE_CODES.has(error?.code) ? error.code : 'TRANSACTION_WRITE_FAILED';
}

function assertRelativeTransactionPath(relativePath) {
  if (typeof relativePath !== 'string' || relativePath.length === 0) {
    throw coded('UNSAFE_TRANSACTION_PATH', 'Transaction path must be a non-empty relative POSIX path.');
  }
  if (path.isAbsolute(relativePath) || relativePath.includes('\\') || relativePath.includes('\0')) {
    throw coded('UNSAFE_TRANSACTION_PATH', `Transaction path must be a relative POSIX path: ${relativePath}`);
  }
  const parts = relativePath.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) {
    throw coded('UNSAFE_TRANSACTION_PATH', `Transaction path must be a relative POSIX path: ${relativePath}`);
  }
  if (!transactionArtifactKind(relativePath)) {
    throw coded('UNSAFE_TRANSACTION_PATH', `Transaction path is not a protected artifact: ${relativePath}`);
  }
}

function resolveTransactionPath(projectDir, relativePath) {
  assertRelativeTransactionPath(relativePath);
  const target = path.resolve(projectDir, ...relativePath.split('/'));
  if (target !== projectDir && !isInside(projectDir, target)) {
    throw coded('UNSAFE_TRANSACTION_PATH', `Transaction path must remain inside the project: ${relativePath}`);
  }
  return target;
}

function isTransactionId(transactionId) {
  return typeof transactionId === 'string' && TXN_ID_RE.test(transactionId);
}

async function canonicalProjectDir(projectDir) {
  const resolved = path.resolve(projectDir);
  try {
    return await realpath(resolved);
  } catch (error) {
    if (error?.code === 'ENOENT') return resolved;
    throw error;
  }
}

async function loadInventory(projectDir, collectSnapshotImpl) {
  if (collectSnapshotImpl) return collectSnapshotImpl({ projectDir });
  return collectTransactionInventory({ projectDir });
}

async function currentFileHash(fsImpl, target) {
  try {
    return sha256(await fsImpl.readFile(target));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function restoreChanges({ projectDir, changes, fsImpl }) {
  for (const change of changes.toReversed()) {
    const target = resolveTransactionPath(projectDir, change.path);
    if (change.beforeBytes === null) await fsImpl.rm(target, { force: true });
    else {
      await fsImpl.mkdir(path.dirname(target), { recursive: true });
      await fsImpl.writeFile(target, asBuffer(change.beforeBytes));
    }
  }
}

async function applyChanges({ projectDir, changes, fsImpl }) {
  for (const change of changes) {
    const target = resolveTransactionPath(projectDir, change.path);
    if (change.operation === 'delete') {
      await fsImpl.rm(target, { force: true });
      continue;
    }
    if (change.operation !== 'create' && change.operation !== 'modify') {
      throw coded('TRANSACTION_WRITE_FAILED', `Unsupported transaction operation ${change.operation}.`);
    }
    await fsImpl.mkdir(path.dirname(target), { recursive: true });
    await fsImpl.writeFile(target, asBuffer(change.afterBytes));
  }
}

async function assertAfterHashes({ projectDir, changes, fsImpl }) {
  for (const change of changes) {
    const target = resolveTransactionPath(projectDir, change.path);
    if (change.operation === 'delete') {
      const hash = await currentFileHash(fsImpl, target);
      if (hash != null) {
        throw coded('TRANSACTION_WRITE_FAILED', `Deleted path still exists: ${change.path}`);
      }
      continue;
    }
    const hash = await currentFileHash(fsImpl, target);
    if (hash !== change.afterHash) {
      throw coded('TRANSACTION_WRITE_FAILED', `After hash mismatch for ${change.path}`);
    }
  }
}

async function hasNeedsInspection(journal, projectDir) {
  const records = await journal.list({ projectDir });
  return records.some((record) => record.status === 'needs-inspection');
}

function attachBoardParity(verification, required) {
  if (!required.erc || required.drc) return verification;
  const drc = verification?.drc;
  const unverified = drc == null || drc.skipped === true || !requiredOk(drc);
  if (!unverified) return verification;
  return {
    ...verification,
    diagnostics: [
      ...(verification?.diagnostics ?? []),
      { code: 'SCHEMATIC_BOARD_PARITY_UNVERIFIED' }
    ]
  };
}

function evaluateVerification(verification, required) {
  if (required.erc && (verification?.erc == null || verification.erc.skipped === true)) {
    const error = coded('VERIFICATION_UNAVAILABLE', 'Required ERC did not execute.');
    error.verification = verification;
    return error;
  }
  if (required.drc && (verification?.drc == null || verification.drc.skipped === true)) {
    const error = coded('VERIFICATION_UNAVAILABLE', 'Required DRC did not execute.');
    error.verification = verification;
    return error;
  }
  if (required.erc && !requiredOk(verification.erc)) {
    const error = coded('VERIFICATION_FAILED', 'Required ERC failed.');
    error.verification = verification;
    return error;
  }
  if (required.drc && !requiredOk(verification.drc)) {
    const error = coded('VERIFICATION_FAILED', 'Required DRC failed.');
    error.verification = verification;
    return error;
  }
  return null;
}

function settledValidator(settled) {
  if (settled.status === 'fulfilled') return settled.value;
  const reason = settled.reason;
  return {
    ok: false,
    skipped: false,
    reason: {
      code: reason?.code ?? 'VERIFICATION_FAILED',
      message: reason?.message ?? String(reason)
    }
  };
}

async function defaultVerifyAppliedProject({ projectDir, changes }, options = {}) {
  const copyImpl = options.copyInspectionTreeImpl ?? copyInspectionTree;
  const validateProjectImpl = options.validateProjectImpl ?? validateProject;
  const validateBoardImpl = options.validateBoardImpl ?? validateBoard;
  const inspectionRoot = await mkdtemp(path.join(tmpdir(), 'chatpcb-txn-verify-'));
  let canonicalRoot = inspectionRoot;
  try {
    canonicalRoot = await realpath(inspectionRoot);
    const copyDir = await copyImpl(projectDir, path.join(canonicalRoot, 'project'));
    const schematicRelative = firstChangedPath(changes, '.kicad_sch');
    const boardRelative = firstChangedPath(changes, '.kicad_pcb');
    const schematicPath = schematicRelative ? path.join(copyDir, ...schematicRelative.split('/')) : undefined;
    const boardPath = boardRelative ? path.join(copyDir, ...boardRelative.split('/')) : undefined;
    const settled = await Promise.allSettled([
      Promise.resolve().then(() => validateProjectImpl({
        projectDir: copyDir,
        schematicPath,
        excludeProjectDir: projectDir,
        kicadCliPath: options.kicadCliPath
      })),
      Promise.resolve().then(() => validateBoardImpl({
        projectDir: copyDir,
        boardPath,
        excludeProjectDir: projectDir,
        kicadCliPath: options.kicadCliPath
      }))
    ]);
    return {
      erc: settledValidator(settled[0]),
      drc: settledValidator(settled[1])
    };
  } finally {
    await rm(canonicalRoot, { force: true, recursive: true });
    if (canonicalRoot !== inspectionRoot) {
      await rm(inspectionRoot, { force: true, recursive: true });
    }
  }
}

async function autoRollback({
  projectDir,
  changes,
  journal,
  transactionId,
  fsImpl,
  collectSnapshotImpl,
  error,
  beforeTransactionDigest
}) {
  try {
    await restoreChanges({ projectDir, changes, fsImpl });
    const inventory = await loadInventory(projectDir, collectSnapshotImpl);
    if (inventory.transactionDigest !== beforeTransactionDigest) {
      throw coded('ROLLBACK_FAILED', 'Automatic restoration did not restore the before transaction digest.');
    }
    const record = await journal.transition({
      transactionId,
      status: 'auto-rolled-back',
      patch: { verification: serializeVerification(error.verification) }
    });
    return applyResult(
      { code: applyFailureCode(error), message: error.message },
      { rolledBack: true, transaction: record }
    );
  } catch (restoreError) {
    const record = await journal.transition({
      transactionId,
      status: 'rollback-failed',
      patch: { verification: serializeVerification(error.verification) }
    });
    return applyResult(
      { code: 'ROLLBACK_FAILED', message: restoreError.message },
      { rolledBack: false, transaction: record }
    );
  }
}

export async function applyProjectTransaction({
  projectDir,
  proposalId,
  approvalRegistry,
  mutexRegistry,
  journal,
  verifyAppliedProjectImpl,
  collectSnapshotImpl,
  fsImpl = defaultFsImpl,
  ...options
} = {}) {
  const resolvedProjectDir = assertSafeProjectDir(projectDir);
  try {
    return await mutexRegistry.runExclusive({ projectDir: resolvedProjectDir }, async () => {
      await assertInspectionTree(resolvedProjectDir);
      if (await hasNeedsInspection(journal, resolvedProjectDir)) {
        return applyResult({
          code: 'TRANSACTION_NEEDS_INSPECTION',
          message: 'A previous transaction for this project needs inspection before new writes.'
        });
      }

      const peeked = approvalRegistry.peek({ patchId: proposalId, projectDir: resolvedProjectDir });
      if (!peeked.ok) return applyResult(mapProposalReason(peeked.reason));
      const plan = planFrom(peeked.record);

      try {
        for (const change of plan.changes) resolveTransactionPath(resolvedProjectDir, change.path);
      } catch (error) {
        if (error.code === 'UNSAFE_TRANSACTION_PATH') {
          return applyResult({ code: error.code, message: error.message });
        }
        throw error;
      }

      const beforeInventory = await loadInventory(resolvedProjectDir, collectSnapshotImpl);
      if (beforeInventory.transactionDigest !== plan.baseTransactionDigest) {
        return applyResult({
          code: 'PROPOSAL_STALE',
          message: 'Project transaction digest no longer matches the approved proposal.'
        });
      }

      for (const change of plan.changes) {
        const target = resolveTransactionPath(resolvedProjectDir, change.path);
        const hash = await currentFileHash(fsImpl, target);
        const expected = change.operation === 'create' ? null : change.beforeHash;
        if (hash !== expected) {
          return applyResult({
            code: 'PROPOSAL_STALE',
            message: `Before hash no longer matches for ${change.path}.`
          });
        }
      }

      const consumed = approvalRegistry.consume({ patchId: proposalId, projectDir: resolvedProjectDir });
      if (!consumed.ok) return applyResult(mapProposalReason(consumed.reason));

      const journalRecord = await journal.prepare({
        projectDir: resolvedProjectDir,
        beforeTransactionDigest: plan.baseTransactionDigest,
        afterTransactionDigest: plan.afterTransactionDigest,
        changes: plan.changes,
        proposal: { proposalId: plan.proposalId, source: plan.source }
      });
      await journal.transition({ transactionId: journalRecord.transactionId, status: 'applying' });

      try {
        await applyChanges({ projectDir: resolvedProjectDir, changes: plan.changes, fsImpl });
        await assertAfterHashes({ projectDir: resolvedProjectDir, changes: plan.changes, fsImpl });

        const afterInventory = await loadInventory(resolvedProjectDir, collectSnapshotImpl);
        if (afterInventory.transactionDigest !== plan.afterTransactionDigest) {
          throw coded('TRANSACTION_WRITE_FAILED', 'After transaction digest did not match the approved proposal.');
        }

        const required = requiredValidationFor(plan);
        const verifyImpl = verifyAppliedProjectImpl
          ?? ((args) => defaultVerifyAppliedProject(args, { ...options, kicadCliPath: options.kicadCliPath }));
        const verification = await verifyImpl({
          projectDir: resolvedProjectDir,
          changes: plan.changes,
          requiredValidation: required
        });
        const verificationError = evaluateVerification(verification, required);
        if (verificationError) throw verificationError;
        const recordedVerification = attachBoardParity(verification, required);

        const applied = await journal.transition({
          transactionId: journalRecord.transactionId,
          status: 'applied',
          patch: { verification: serializeVerification(recordedVerification) }
        });
        return {
          applied: true,
          transaction: applied,
          verification: recordedVerification
        };
      } catch (error) {
        return autoRollback({
          projectDir: resolvedProjectDir,
          changes: plan.changes,
          journal,
          transactionId: journalRecord.transactionId,
          fsImpl,
          collectSnapshotImpl,
          error,
          beforeTransactionDigest: plan.baseTransactionDigest
        });
      }
    });
  } catch (error) {
    if (error?.code === 'PROJECT_BUSY') {
      return applyResult({ code: 'PROJECT_BUSY', message: error.message });
    }
    throw error;
  }
}

export async function rollbackProjectTransaction({
  projectDir,
  transactionId,
  mutexRegistry,
  journal,
  collectSnapshotImpl,
  fsImpl = defaultFsImpl
} = {}) {
  const resolvedProjectDir = assertSafeProjectDir(projectDir);
  try {
    return await mutexRegistry.runExclusive({ projectDir: resolvedProjectDir }, async () => {
      await assertInspectionTree(resolvedProjectDir);
      if (await hasNeedsInspection(journal, resolvedProjectDir)) {
        return rollbackResult({
          code: 'TRANSACTION_NEEDS_INSPECTION',
          message: 'A previous transaction for this project needs inspection before rollback.'
        });
      }

      if (!isTransactionId(transactionId)) {
        return rollbackResult({
          code: 'JOURNAL_NOT_FOUND',
          message: 'Transaction id must be a txn_ UUID.'
        });
      }

      const record = await journal.get({ transactionId });
      if (!record) {
        return rollbackResult({
          code: 'JOURNAL_NOT_FOUND',
          message: `Journal record ${transactionId} was not found.`
        });
      }

      const canonical = await canonicalProjectDir(resolvedProjectDir);
      if (record.projectDir !== canonical) {
        return rollbackResult({
          code: 'ROLLBACK_STALE',
          message: 'Journal record belongs to a different project.'
        });
      }

      if (record.status !== 'applied') {
        return rollbackResult({
          code: 'ROLLBACK_STALE',
          message: `Journal record ${transactionId} is not eligible for rollback.`
        });
      }

      const current = await loadInventory(resolvedProjectDir, collectSnapshotImpl);
      if (current.transactionDigest !== record.afterTransactionDigest) {
        return rollbackResult({
          code: 'ROLLBACK_STALE',
          message: 'Saved project changed after apply.'
        });
      }

      try {
        await restoreChanges({ projectDir: resolvedProjectDir, changes: record.changes, fsImpl });
        const restored = await loadInventory(resolvedProjectDir, collectSnapshotImpl);
        if (restored.transactionDigest !== record.beforeTransactionDigest) {
          throw coded('ROLLBACK_FAILED', 'Manual restoration did not restore the before transaction digest.');
        }
        const rolledBack = await journal.transition({
          transactionId: record.transactionId,
          status: 'rolled-back'
        });
        return { rolledBack: true, transaction: rolledBack };
      } catch (error) {
        const failed = await journal.transition({
          transactionId: record.transactionId,
          status: 'rollback-failed'
        });
        return rollbackResult(
          { code: 'ROLLBACK_FAILED', message: error.message },
          { transaction: failed }
        );
      }
    });
  } catch (error) {
    if (error?.code === 'PROJECT_BUSY') {
      return rollbackResult({ code: 'PROJECT_BUSY', message: error.message });
    }
    throw error;
  }
}
