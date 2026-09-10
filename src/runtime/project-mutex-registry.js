import { realpath } from 'node:fs/promises';
import path from 'node:path';

function projectBusy(projectDir) {
  const error = new Error(`Another ChatPCB transaction is active for ${projectDir}.`);
  error.code = 'PROJECT_BUSY';
  return error;
}

export function createProjectMutexRegistry({ realpathImpl = realpath } = {}) {
  const locks = new Set();

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
    async isLocked({ projectDir }) {
      return locks.has(await canonicalKey(projectDir));
    },

    async runExclusive({ projectDir }, work) {
      const key = await canonicalKey(projectDir);
      if (locks.has(key)) throw projectBusy(projectDir);
      locks.add(key);
      try {
        return await work();
      } finally {
        locks.delete(key);
      }
    }
  };
}
