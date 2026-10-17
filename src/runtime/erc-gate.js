import { classifyRecordedErc } from '../../apps/panel/erc-verdict.js';

// Fail-closed ERC decision for schematic.patch approval.
// `passed === true` only when a recorded run actually succeeded.
export function normalizeRecordedErc(source) {
  const verdict = classifyRecordedErc(source);
  return {
    passed: verdict.passed,
    skipped: verdict.skipped,
    failed: verdict.failed,
    missing: verdict.missing,
    errorCount: verdict.errorCount
  };
}

export function recordedErcSource(record) {
  if (!record || typeof record !== 'object') return null;
  return record.plan?.candidateVerification?.erc
    ?? record.candidateVerification?.erc
    ?? record.plan?.validation
    ?? record.validation
    ?? null;
}

export function ercApprovalDecision(recorded, ercOverride) {
  if (recorded?.passed === true) {
    return { allow: true, allowSkippedErc: false };
  }
  const skipped = recorded?.skipped === true && recorded?.failed !== true && recorded?.passed !== true;
  if (skipped && ercOverride === 'skipped') {
    return { allow: true, allowSkippedErc: true };
  }
  const reason = recorded?.failed === true ? 'failed' : skipped ? 'skipped' : 'missing';
  return {
    allow: false,
    allowSkippedErc: false,
    reason,
    message: ercBlockedMessage(reason)
  };
}

export function ercBlockedMessage(reason) {
  if (reason === 'failed') return 'ERC_BLOCKED: ERC did not pass for this patch.';
  if (reason === 'skipped') return 'ERC_BLOCKED: ERC was skipped. Approve with ercOverride "skipped" to apply without ERC.';
  return 'ERC_BLOCKED: no ERC result is recorded for this patch.';
}
