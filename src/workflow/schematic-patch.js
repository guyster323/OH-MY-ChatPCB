import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createPatchApprovalRegistry } from '../runtime/patch-approval-registry.js';
import { createProjectMutexRegistry } from '../runtime/project-mutex-registry.js';
import { createTransactionJournal } from '../runtime/transaction-journal.js';
import { createCandidateValidator, createNativeProposal, disposeNativeProposal, proposalSource, publicProposal } from './native-proposal-source.js';
import { applyProjectTransaction } from './project-transaction.js';
import { assertSafeProjectDir } from './project-workspace.js';
import { reviewCircuitReadiness } from './review-project.js';
import { validateBoard } from './validate-board.js';
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

function candidateAllowsApply(plan, { allowSkippedErc = false } = {}) {
  const required = plan.requiredValidation ?? {};
  const verification = plan.candidateVerification ?? {};
  if (required.erc && verification.erc?.status !== 'passed') {
    const erc = verification.erc ?? {};
    const errorCount = Number(erc.erc?.errorCount ?? erc.errorCount ?? 0);
    const failed = erc.status === 'failed' || erc.ok === false || (Number.isFinite(errorCount) && errorCount > 0);
    const skipped = erc.skipped === true && !failed;
    if (!(allowSkippedErc && skipped)) return false;
  }
  if (required.drc && verification.drc?.status !== 'passed') return false;
  return true;
}

function previewManifest(plan) {
  const parts = plan.proposed?.spec?.partManifest?.parts;
  if (!Array.isArray(parts) || parts.length === 0) return null;
  return { parts };
}

function findRemovalBlocker(plan) {
  const blockers = plan?.review?.findings?.blockers ?? [];
  return blockers.find((finding) => (
    finding?.code === 'existing-components-removed' || finding?.id === 'existing-components-removed'
  )) ?? null;
}

function removedRefs(plan) {
  const blocker = findRemovalBlocker(plan);
  const listed = Array.isArray(blocker?.removedComponents) ? blocker.removedComponents : [];
  return listed.map((component) => component?.ref).filter((ref) => typeof ref === 'string' && ref.length > 0);
}

function mismatchDetail(missing, extra) {
  const missingText = missing.length > 0 ? missing.join(', ') : '(none)';
  const extraText = extra.length > 0 ? extra.join(', ') : '(none)';
  return {
    code: 'ALLOW_REMOVED_COMPONENTS_MISMATCH',
    missing,
    extra,
    message: `allowRemovedComponents does not match the removed references. Missing: ${missingText}. Extra: ${extraText}.`
  };
}

function removalOverrideDecision(allowRemovedComponents, removedRefList) {
  if (removedRefList.length === 0) return { match: true };
  if (allowRemovedComponents === undefined) return { match: false };
  const removed = [...new Set(removedRefList)].sort();
  const invalid = !Array.isArray(allowRemovedComponents)
    || allowRemovedComponents.some((ref) => typeof ref !== 'string' || ref.trim() === '');
  if (invalid) return { match: false, mismatch: mismatchDetail(removed, []) };
  const allowed = [...new Set(allowRemovedComponents.map((ref) => ref.trim()))].sort();
  const removedSet = new Set(removed);
  const allowedSet = new Set(allowed);
  const missing = removed.filter((ref) => !allowedSet.has(ref));
  const extra = allowed.filter((ref) => !removedSet.has(ref));
  if (missing.length === 0 && extra.length === 0) return { match: true };
  return { match: false, mismatch: mismatchDetail(missing, extra) };
}

function removalFailure(plan, mismatch) {
  const blocker = findRemovalBlocker(plan);
  const removedComponents = Array.isArray(blocker?.removedComponents) ? blocker.removedComponents : [];
  const baseMessage = blocker?.message ?? 'Existing components were removed. Apply stays closed until the client confirms this exact set. 기존 부품이 빠졌습니다. 클라이언트가 이 목록을 그대로 확인하기 전에는 적용할 수 없습니다.';
  return {
    requiresApproval: false,
    approved: true,
    applied: false,
    rolledBack: false,
    files: plan?.targetFiles ?? {},
    changedFiles: plan?.changedFiles ?? [],
    diff: plan?.diff ?? '',
    ...(plan ? { validation: plan.validation, review: plan.review } : {}),
    removedComponents,
    reason: {
      code: 'EXISTING_COMPONENTS_REMOVED',
      message: mismatch ? `${baseMessage} ${mismatch.message}` : baseMessage,
      removedComponents,
      ...(mismatch ? { mismatch } : {})
    }
  };
}

function previewFrom(plan) {
  const preview = publicProposal(plan);
  const manifest = previewManifest(plan);
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
    ...(manifest ? { manifest } : {}),
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
    validation: plan.validation,
    source: plan.source
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
  userPrompt,
  projectName = 'chatpcb_mcu_peripheral',
  validateProjectImpl = validateProject,
  validateBoardImpl = validateBoard,
  validateCandidateImpl,
  context,
  signal,
  conversationBytes,
  source
} = {}) {
  return createNativeProposal({
    projectDir: assertSafeProjectDir(projectDir),
    request: { prompt, ...(typeof userPrompt === 'string' ? { userPrompt } : {}) },
    projectName,
    context,
    signal,
    conversationBytes,
    source: proposalSource(source),
    validateCandidateImpl: validateCandidateImpl ?? createCandidateValidator({
      validateProjectImpl,
      validateBoardImpl
    })
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
  allowRemovedComponents,
  validateProjectImpl = validateProject,
  validateBoardImpl = validateBoard,
  validateCandidateImpl,
  verifyAppliedProjectImpl,
  approvalRegistry,
  mutexRegistry,
  journal,
  collectSnapshotImpl,
  fsImpl,
  allowSkippedErc = false
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
    validateCandidateImpl: validateCandidateImpl ?? createCandidateValidator({
      validateProjectImpl,
      validateBoardImpl
    })
  });
  const ownsPlan = !patchPlan;

  if (!approved) {
    const preview = previewFrom(plan);
    const blocker = findRemovalBlocker(plan);
    if (blocker) {
      const removedComponents = Array.isArray(blocker.removedComponents) ? blocker.removedComponents : [];
      preview.requiresApproval = false;
      preview.removedComponents = removedComponents;
      preview.reason = {
        code: 'EXISTING_COMPONENTS_REMOVED',
        message: blocker.message,
        removedComponents
      };
    }
    if (ownsPlan) await disposeNativeProposal(plan);
    return preview;
  }

  if (findRemovalBlocker(plan)) {
    const decision = removalOverrideDecision(allowRemovedComponents, removedRefs(plan));
    if (!decision.match) {
      if (ownsPlan) await disposeNativeProposal(plan);
      return removalFailure(plan, decision.mismatch);
    }
  }

  if (expectedPatchId && expectedPatchId !== plan.proposalId && expectedPatchId !== plan.patchId) {
    if (ownsPlan) await disposeNativeProposal(plan);
    return patchFailure('PATCH_STALE', 'Patch preview no longer matches the project artifacts.', plan);
  }

  if (!candidateAllowsApply(plan, { allowSkippedErc })) {
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
