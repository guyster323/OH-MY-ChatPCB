// Classic script: no import or export. panel.js calls these globals.
// Node tests import this file for the same side effect.

function asRecord(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
  return result;
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function failureCodeOf(result) {
  if (!result || typeof result !== 'object') return 'APPLIED_MISSING';
  if (Object.hasOwn(result, 'applied') && result.applied !== true && result.applied !== false) return 'APPLY_REJECTED';
  if (!Object.hasOwn(result, 'applied')) return 'APPLIED_MISSING';
  const code = result.reason?.code;
  if (typeof code === 'string' && code.length > 0) return code;
  return 'APPLY_REJECTED';
}

function hasHardFailure(value) {
  if (value.ok === false || value.rolledBack === true || value.error != null) return true;
  return Object.hasOwn(value, 'applied') && value.applied !== true && value.applied !== false;
}

function isRemovalPreview(value) {
  if (!value || value.applied === true) return false;
  if (value.reason?.code === 'EXISTING_COMPONENTS_REMOVED') return true;
  if (Array.isArray(value.removedComponents) && value.removedComponents.length > 0) return true;
  const blockers = value.review?.findings?.blockers;
  if (!Array.isArray(blockers)) return false;
  return blockers.some((finding) => (
    finding?.code === 'existing-components-removed'
    || finding?.id === 'existing-components-removed'
    || finding?.code === 'EXISTING_COMPONENTS_REMOVED'
  ));
}

function isCreateSuccess(value) {
  return nonEmptyString(value.displayName)
    && nonEmptyString(value.slug)
    && nonEmptyString(value.projectDir)
    && !Object.hasOwn(value, 'applied')
    && value.operation == null
    && value.patchId == null
    && value.requiresApproval == null;
}

function isClarifySuccess(value) {
  return value.operation === 'clarify'
    && value.applied === false
    && value.requiresApproval === false
    && value.conversation !== null
    && typeof value.conversation === 'object'
    && !Array.isArray(value.conversation);
}

function isPreviewSuccess(value) {
  if (value.applied !== false) return false;
  if (!nonEmptyString(value.patchId)) return false;
  if (!value.files || typeof value.files !== 'object' || Array.isArray(value.files)) return false;
  if (value.requiresApproval === true) return true;
  return value.requiresApproval === false && isRemovalPreview(value);
}

function isPatchApplySuccess(value) {
  return value.applied === true && value.canceled !== true && value.cancelled !== true;
}

function isInspectSuccess(value) {
  return value.ok === true && nonEmptyString(value.inspection?.projectDigest);
}

function isAuthSuccess(value) {
  return nonEmptyString(value.state);
}

function isStatusSuccess(value) {
  return nonEmptyString(value.provider) && nonEmptyString(value.status);
}

function successForKind(kind, value) {
  if (kind === 'project-create') return isCreateSuccess(value);
  if (kind === 'project-request') return isClarifySuccess(value) || isPreviewSuccess(value);
  if (kind === 'project-generate') return isPreviewSuccess(value);
  if (kind === 'patch-apply') return isPatchApplySuccess(value);
  if (kind === 'inspect') return isInspectSuccess(value);
  if (kind === 'auth') return isAuthSuccess(value);
  if (kind === 'status') return isStatusSuccess(value);
  return false;
}

function chatpcbNormalizeDaemonReply(result, kind) {
  const value = asRecord(result);
  const resolvedKind = typeof kind === 'string' && kind ? kind : 'unknown';
  if (!value || hasHardFailure(value) || value.canceled === true || value.cancelled === true) {
    return { ok: false, kind: resolvedKind, code: failureCodeOf(value) };
  }
  if (!successForKind(resolvedKind, value)) {
    return { ok: false, kind: resolvedKind, code: failureCodeOf(value) };
  }
  return { ok: true, kind: resolvedKind };
}

function chatpcbRequestOutcome(result) {
  const value = asRecord(result);
  if (!value) return { ok: false, kind: 'unknown', code: 'APPLY_REJECTED' };
  if (value.fromPatchApprove === true) return chatpcbNormalizeDaemonReply(value, 'patch-apply');
  if (isCreateSuccess(value)) return chatpcbNormalizeDaemonReply(value, 'project-create');
  if (value.operation === 'clarify') return chatpcbNormalizeDaemonReply(value, 'project-request');
  if (value.approved === true && Object.hasOwn(value, 'applied') && value.requiresApproval !== true) {
    return chatpcbNormalizeDaemonReply(value, 'patch-apply');
  }
  if (
    value.requiresApproval === true
    || isRemovalPreview(value)
    || nonEmptyString(value.patchId)
    || value.operation === 'generated'
    || value.operation === 'patched'
  ) {
    return chatpcbNormalizeDaemonReply(value, 'project-generate');
  }
  if (Object.hasOwn(value, 'applied')) return chatpcbNormalizeDaemonReply(value, 'patch-apply');
  if (typeof value.state === 'string' && !value.provider && !value.projectDir) {
    return chatpcbNormalizeDaemonReply(value, 'auth');
  }
  if (typeof value.provider === 'string' && typeof value.status === 'string') {
    return chatpcbNormalizeDaemonReply(value, 'status');
  }
  if (value.ok === true && value.inspection && typeof value.inspection === 'object') {
    return chatpcbNormalizeDaemonReply(value, 'inspect');
  }
  return { ok: false, kind: 'unknown', code: failureCodeOf(value) };
}

globalThis.chatpcbNormalizeDaemonReply = chatpcbNormalizeDaemonReply;
globalThis.chatpcbRequestOutcome = chatpcbRequestOutcome;
