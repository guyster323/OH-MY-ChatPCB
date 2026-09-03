import path from 'node:path';

export function createPatchApprovalRegistry({ ttlMs = 900000, now = Date.now } = {}) {
  const approvals = new Map();

  function disposeRecord(record) {
    record.dispose?.();
  }

  return {
    register(record) {
      const expiresAt = now() + ttlMs;
      const normalized = { ...record, projectDir: path.resolve(record.projectDir), expiresAt };
      const prior = approvals.get(record.patchId);
      if (prior) disposeRecord(prior);
      approvals.set(record.patchId, normalized);
      return normalized;
    },

    consume({ patchId, projectDir }) {
      const record = approvals.get(patchId);
      if (!record) return { ok: false, reason: { code: 'PATCH_APPROVAL_MISSING', message: 'Patch approval was not found.' } };
      approvals.delete(patchId);
      if (record.projectDir !== path.resolve(projectDir)) {
        disposeRecord(record);
        return { ok: false, reason: { code: 'PATCH_STALE', message: 'Patch approval belongs to a different project.' } };
      }
      if (now() > record.expiresAt) {
        disposeRecord(record);
        return { ok: false, reason: { code: 'PATCH_APPROVAL_EXPIRED', message: 'Patch approval has expired.' } };
      }
      return { ok: true, record };
    },

    dispose({ patchId }) {
      const record = approvals.get(patchId);
      if (!record) return false;
      approvals.delete(patchId);
      disposeRecord(record);
      return true;
    },

    disposeAll() {
      for (const record of approvals.values()) disposeRecord(record);
      approvals.clear();
    }
  };
}
