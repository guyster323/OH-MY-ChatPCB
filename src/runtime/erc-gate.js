// Fail-closed ERC decision for schematic.patch approval.
// `passed === true` only when a recorded run actually succeeded.

function numericCount(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function normalizeRecordedErc(source) {
  if (!source || typeof source !== 'object') {
    return { passed: false, skipped: false, failed: false, missing: true, errorCount: 0 };
  }

  const nested = source.erc && typeof source.erc === 'object' ? source.erc : null;
  const deep = nested?.erc && typeof nested.erc === 'object' ? nested.erc : null;
  const errorCount = numericCount(deep?.errorCount ?? nested?.errorCount ?? source.errorCount);
  const skippedFlag = source.skipped === true || nested?.skipped === true;
  const okFalse = source.ok === false || nested?.ok === false || deep?.ok === false;
  const okTrue = source.ok === true || nested?.ok === true || deep?.ok === true;
  const status = typeof source.status === 'string' ? source.status : nested?.status;
  // A skipped flag must not hide errors. Those stay failed and cannot be overridden.
  const failed = status === 'failed' || okFalse || errorCount > 0;

  if (failed) {
    return { passed: false, skipped: false, failed: true, missing: false, errorCount };
  }
  if (skippedFlag) {
    return { passed: false, skipped: true, failed: false, missing: false, errorCount: 0 };
  }
  if ((status === 'passed' || (status == null && okTrue)) && okTrue && errorCount === 0) {
    return { passed: true, skipped: false, failed: false, missing: false, errorCount: 0 };
  }
  return { passed: false, skipped: false, failed: false, missing: true, errorCount: 0 };
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
