import { classifyRecordedErc } from '../../apps/panel/erc-verdict.js';
import { stderrExcerpt } from '../kicad/stderr-excerpt.js';

// Fail-closed ERC decision for schematic.patch approval.
// `passed === true` only when a recorded run actually succeeded.
export function normalizeRecordedErc(source) {
  const verdict = classifyRecordedErc(source);
  const reason = recordedReason(source);
  return {
    passed: verdict.passed,
    skipped: verdict.skipped,
    failed: verdict.failed,
    missing: verdict.missing,
    errorCount: verdict.errorCount,
    ...(reason ? { reason } : {})
  };
}

const REASON_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;

// The recorded failure reason (code and a short stderr excerpt), when the
// validator left one. Display only: it never changes the verdict above.
function recordedReason(source) {
  const reason = source && typeof source === 'object' ? source.reason : null;
  if (!reason || typeof reason !== 'object' || typeof reason.code !== 'string' || !REASON_CODE.test(reason.code)) {
    return null;
  }
  const stderr = stderrExcerpt(reason.stderr);
  return { code: reason.code, ...(stderr ? { stderr } : {}) };
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
  const detail = reason === 'failed' ? recorded?.reason : undefined;
  return {
    allow: false,
    allowSkippedErc: false,
    reason,
    ...(detail ? { reasonCode: detail.code, ...(detail.stderr ? { stderr: detail.stderr } : {}) } : {}),
    message: ercBlockedMessage(reason, detail)
  };
}

export function ercBlockedMessage(reason, detail) {
  if (reason === 'failed') {
    const base = 'ERC_BLOCKED: ERC did not pass for this patch.';
    if (!detail?.code) return base;
    return `${base} Reason: ${detail.code}${detail.stderr ? ` (stderr: ${detail.stderr})` : ''}.`;
  }
  if (reason === 'skipped') return 'ERC_BLOCKED: ERC was skipped. Approve with ercOverride "skipped" to apply without ERC.';
  return 'ERC_BLOCKED: no ERC result is recorded for this patch.';
}
