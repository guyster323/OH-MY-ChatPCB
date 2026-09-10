import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createPatchApprovalRegistry } from '../runtime/patch-approval-registry.js';
import { createProjectMutexRegistry } from '../runtime/project-mutex-registry.js';
import { createTransactionJournal } from '../runtime/transaction-journal.js';
import { createNativeProposal, disposeNativeProposal, publicProposal } from './native-proposal-source.js';
import { applyProjectTransaction } from './project-transaction.js';
import { assertSafeProjectDir } from './project-workspace.js';
import { reviewCircuitReadiness } from './review-project.js';
import { validateProject } from './validate-project.js';

const PATCH_REASON = {
  PROPOSAL_STALE: 'PATCH_STALE',
  PROPOSAL_MISSING: 'PATCH_APPROVAL_MISSING',
  PROPOSAL_EXPIRED: 'PATCH_APPROVAL_EXPIRED'
};

function patchFailure(code, message, plan) {
  return {
    requiresApproval: false,
    approved: true,
    applied: false,
    rolledBack: false,
    files: plan?.targetFiles ?? {},
    changedFiles: plan?.changedFiles ?? [],
    diff: plan?.diff ?? '',
    ...(plan ? { validation: plan.validation, review: plan.review } : {}),
    reason: { code, message }
  };
}

function candidateAllowsApply(plan) {
  const required = plan.requiredValidation ?? {};
  const verification = plan.candidateVerification ?? {};
  if (required.erc && verification.erc?.status !== 'passed') return false;
  if (required.drc && verification.drc?.status !== 'passed') return false;
  return true;
}

function previewFrom(plan) {
  const preview = publicProposal(plan);
  return {
    requiresApproval: true,
    approved: false,
    applied: false,
    files: plan.targetFiles,
    changedFiles: plan.changedFiles,
    diff: plan.diff,
    review: plan.review,
    patchId: plan.proposalId,
    proposalId: plan.proposalId,
    why: preview.why,
    what: preview.what,
    components: preview.components,
    nets: preview.nets,
    risks: preview.risks,
    verificationPlan: preview.verificationPlan,
    candidateVerification: preview.candidateVerification,
    artifactChanges: preview.artifactChanges,
    beforeArtifacts: plan.beforeArtifacts,
    afterArtifacts: plan.afterArtifacts,
    beforeProjectDigest: plan.beforeProjectDigest,
    afterProjectDigest: plan.afterProjectDigest,
    beforeTransactionDigest: plan.baseTransactionDigest,
    afterTransactionDigest: plan.afterTransactionDigest,
    validation: plan.validation
  };
}

function mapApplyResult(result, plan) {
  if (result.applied) {
    return {
      requiresApproval: false,
      approved: true,
      applied: true,
      rolledBack: false,
      files: plan.targetFiles,
      changedFiles: plan.changedFiles,
      diff: plan.diff,
      validation: plan.validation,
      review: reviewCircuitReadiness({ spec: plan.proposed.spec, validation: plan.validation }),
      transaction: result.transaction,
      verification: result.verification
    };
  }

  return {
    requiresApproval: false,
    approved: true,
    applied: false,
    rolledBack: result.rolledBack === true,
    files: plan.targetFiles,
    changedFiles: plan.changedFiles,
    diff: plan.diff,
    validation: plan.validation,
    review: plan.review,
    reason: {
      code: PATCH_REASON[result.reason?.code] ?? result.reason?.code,
      message: result.reason?.message
    },
    transaction: result.transaction,
    verification: result.verification
  };
}

export async function createSchematicPatchPlan({
  projectDir,
  prompt,
  projectName = 'chatpcb_mcu_peripheral',
  validateProjectImpl = validateProject,
  context
} = {}) {
  return createNativeProposal({
    projectDir: assertSafeProjectDir(projectDir),
    request: { prompt },
    projectName,
    context,
    validateCandidateImpl: validateProjectImpl
  });
}

export async function disposeSchematicPatchPlan(plan) {
  await disposeNativeProposal(plan);
}

export async function applySchematicPatch({
  projectDir,
  prompt,
  projectName = 'chatpcb_mcu_peripheral',
  approved = false,
  cancel = false,
  expectedPatchId,
  patchPlan,
  validateProjectImpl = validateProject,
  verifyAppliedProjectImpl,
  approvalRegistry,
  mutexRegistry,
  journal,
  collectSnapshotImpl,
  fsImpl
} = {}) {
  if (!projectDir) {
    throw new Error('projectDir is required.');
  }

  const resolvedProjectDir = assertSafeProjectDir(projectDir);

  if (cancel) {
    return {
      requiresApproval: false,
      approved: false,
      canceled: true,
      applied: false,
      files: {},
      changedFiles: [],
      diff: ''
    };
  }

  if (approved && !expectedPatchId) {
    return patchFailure('PATCH_APPROVAL_REQUIRED', 'expectedPatchId is required to apply a patch preview.');
  }

  const plan = patchPlan ?? await createNativeProposal({
    projectDir: resolvedProjectDir,
    request: { prompt },
    projectName,
    validateCandidateImpl: validateProjectImpl
  });
  const ownsPlan = !patchPlan;

  if (!approved) {
    const preview = previewFrom(plan);
    if (ownsPlan) await disposeNativeProposal(plan);
    return preview;
  }

  if (expectedPatchId && expectedPatchId !== plan.proposalId && expectedPatchId !== plan.patchId) {
    if (ownsPlan) await disposeNativeProposal(plan);
    return patchFailure('PATCH_STALE', 'Patch preview no longer matches the project artifacts.', plan);
  }

  if (!candidateAllowsApply(plan)) {
    if (ownsPlan) await disposeNativeProposal(plan);
    return {
      requiresApproval: false,
      approved: true,
      applied: false,
      rolledBack: false,
      files: plan.targetFiles,
      changedFiles: plan.changedFiles,
      diff: plan.diff,
      validation: plan.validation,
      review: plan.review,
      reason: {
        code: 'PATCH_CANDIDATE_UNVERIFIED',
        message: 'Required candidate ERC/DRC did not pass, so approval remains disabled.'
      }
    };
  }

  const ownsJournal = !journal;
  const stateRoot = ownsJournal ? await mkdtemp(path.join(tmpdir(), 'chatpcb-patch-journal-')) : null;
  const approvals = approvalRegistry ?? createPatchApprovalRegistry();
  const mutexes = mutexRegistry ?? createProjectMutexRegistry();
  const txnJournal = journal ?? createTransactionJournal({ stateRoot });

  try {
    if (!approvalRegistry) {
      approvals.register({
        patchId: plan.proposalId,
        projectDir: resolvedProjectDir,
        ...plan,
        plan
      });
    }

    const result = await applyProjectTransaction({
      projectDir: resolvedProjectDir,
      proposalId: plan.proposalId,
      approvalRegistry: approvals,
      mutexRegistry: mutexes,
      journal: txnJournal,
      verifyAppliedProjectImpl,
      collectSnapshotImpl,
      fsImpl
    });
    return mapApplyResult(result, plan);
  } finally {
    if (ownsPlan) await disposeNativeProposal(plan);
    if (ownsJournal && stateRoot) await rm(stateRoot, { force: true, recursive: true });
  }
}
