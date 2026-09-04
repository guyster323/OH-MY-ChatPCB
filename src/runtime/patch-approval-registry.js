import path from 'node:path';

export function createPatchApprovalRegistry({
  ttlMs = 900000,
  tombstoneTtlMs = 900000,
  maxExpiredTombstones = 128,
  now = Date.now,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout
} = {}) {
  const approvals = new Map();

  function clearTimer(record, name) {
    if (record[name] === undefined) return;
    clearTimeoutImpl(record[name]);
    record[name] = undefined;
  }

  function disposeRecord(record) {
    if (record.disposed) return;
    record.disposed = true;
    clearTimer(record, 'timer');
    try {
      Promise.resolve(record.dispose?.()).catch(() => {});
    } catch {
      // Cleanup failures must not escape expiry callbacks or create an unhandled rejection.
    }
  }

  function remove(record) {
    if (approvals.get(record.patchId) === record) approvals.delete(record.patchId);
    clearTimer(record, 'tombstoneTimer');
    disposeRecord(record);
  }

  function expire(record) {
    if (approvals.get(record.patchId) !== record || record.status === 'expired') return;
    record.status = 'expired';
    record.expiredAt = now();
    // This callback is already running, so it has no timer left to cancel.
    record.timer = undefined;
    disposeRecord(record);
    record.tombstoneTimer = setTimeoutImpl(() => {
      if (approvals.get(record.patchId) === record && record.status === 'expired') remove(record);
    }, tombstoneTtlMs);
    record.tombstoneTimer?.unref?.();
    evictExpiredTombstones();
  }

  function evictExpiredTombstones() {
    const expired = [...approvals.values()]
      .filter((record) => record.status === 'expired')
      .sort((left, right) => left.expiredAt - right.expiredAt);
    while (expired.length > maxExpiredTombstones) remove(expired.shift());
  }

  function purgeExpiredTombstones() {
    for (const record of [...approvals.values()]) {
      if (record.status === 'expired' && now() >= record.expiredAt + tombstoneTtlMs) remove(record);
    }
  }

  return {
    register(record) {
      purgeExpiredTombstones();
      const expiresAt = now() + ttlMs;
      const normalized = {
        ...record,
        projectDir: path.resolve(record.projectDir),
        expiresAt,
        disposed: false,
        status: 'active',
        timer: undefined,
        tombstoneTimer: undefined
      };
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
        remove(record);
        return { ok: false, reason: { code: 'PATCH_APPROVAL_EXPIRED', message: 'Patch approval has expired.' } };
      }
      if (record.projectDir !== path.resolve(projectDir)) {
        remove(record);
        return { ok: false, reason: { code: 'PATCH_STALE', message: 'Patch approval belongs to a different project.' } };
      }
      approvals.delete(patchId);
      clearTimer(record, 'timer');
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
