import { AsyncLocalStorage } from 'node:async_hooks';
import { realpath } from 'node:fs/promises';
import path from 'node:path';

function projectBusy(projectDir) {
  const error = new Error(`Another ChatPCB transaction is active for ${projectDir}.`);
  error.code = 'PROJECT_BUSY';
  return error;
}

export function createProjectMutexRegistry({ realpathImpl = realpath } = {}) {
  const locks = new Set();
  const callerLocks = new AsyncLocalStorage();

  async function canonicalKey(projectDir) {
    const resolved = path.resolve(projectDir);
    try {
      return await realpathImpl(resolved);
    } catch (error) {
      if (error?.code === 'ENOENT') return resolved;
      throw error;
    }
  }

  return {
    canonicalKey,
    async callerHolds({ projectDir }) {
      return callerLocks.getStore()?.has(await canonicalKey(projectDir)) === true;
    },
    async isLocked({ projectDir }) {
      return locks.has(await canonicalKey(projectDir));
    },

    // reentrant is only for the async caller that already holds this project.
    // A different caller still gets PROJECT_BUSY, and the default stays strict.
    async runExclusive({ projectDir, reentrant = false }, work) {
      const key = await canonicalKey(projectDir);
      const held = callerLocks.getStore();
      if (held?.has(key)) {
        if (!reentrant) throw projectBusy(projectDir);
        return work();
      }
      if (locks.has(key)) throw projectBusy(projectDir);
      locks.add(key);
      const next = new Set(held);
      next.add(key);
      try {
        return await callerLocks.run(next, () => work());
      } finally {
        locks.delete(key);
      }
    }
  };
}
