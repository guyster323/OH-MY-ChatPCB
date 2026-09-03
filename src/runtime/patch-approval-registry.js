import path from 'node:path';

export function createPatchApprovalRegistry({ ttlMs = 900000, now = Date.now, setTimeoutImpl = setTimeout, clearTimeoutImpl = clearTimeout } = {}) {
  const approvals = new Map();

  function disposeRecord(record) {
    if (record.disposed) return;
    record.disposed = true;
    if (record.timer !== undefined) clearTimeoutImpl(record.timer);
    try {
      Promise.resolve(record.dispose?.()).catch(() => {});
    } catch {
      // Cleanup failures must not escape expiry callbacks or create an unhandled rejection.
    }
  }

  function remove(record) {
    if (approvals.get(record.patchId) === record) approvals.delete(record.patchId);
    disposeRecord(record);
  }

  function expire(record) {
    if (approvals.get(record.patchId) !== record) return;
    record.status = 'expired';
    disposeRecord(record);
  }

  return {
    register(record) {
      const expiresAt = now() + ttlMs;
      const normalized = { ...record, projectDir: path.resolve(record.projectDir), expiresAt, disposed: false, status: 'active' };
      const prior = approvals.get(record.patchId);
      if (prior) remove(prior);
      approvals.set(record.patchId, normalized);
      normalized.timer = setTimeoutImpl(() => expire(normalized), ttlMs);
      normalized.timer?.unref?.();
      return normalized;
    },

    consume({ patchId, projectDir }) {
      const record = approvals.get(patchId);
      if (!record) return { ok: false, reason: { code: 'PATCH_APPROVAL_MISSING', message: 'Patch approval was not found.' } };
      if (record.status === 'expired' || now() >= record.expiresAt) {
        expire(record);
        approvals.delete(patchId);
        return { ok: false, reason: { code: 'PATCH_APPROVAL_EXPIRED', message: 'Patch approval has expired.' } };
      }
      if (record.projectDir !== path.resolve(projectDir)) {
        remove(record);
        return { ok: false, reason: { code: 'PATCH_STALE', message: 'Patch approval belongs to a different project.' } };
      }
      approvals.delete(patchId);
      if (record.timer !== undefined) clearTimeoutImpl(record.timer);
      return { ok: true, record };
    },

    dispose({ patchId }) {
      const record = approvals.get(patchId);
      if (!record) return false;
      remove(record);
      return true;
    },

    disposeAll() {
      for (const record of [...approvals.values()]) remove(record);
    }
  };
}
