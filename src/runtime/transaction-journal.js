import { createHash, randomUUID } from 'node:crypto';
import { access, chmod, mkdir, readdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

const SCHEMA_VERSION = 1;
const DEFAULT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_PER_PROJECT = 20;

const ALLOWED_TRANSITIONS = {
  prepared: new Set(['applying', 'aborted', 'applied', 'needs-inspection']),
  applying: new Set(['applied', 'auto-rolled-back', 'rollback-failed', 'aborted', 'needs-inspection']),
  applied: new Set(['rolled-back', 'rollback-failed']),
  'auto-rolled-back': new Set(),
  'rolled-back': new Set(),
  aborted: new Set(),
  'needs-inspection': new Set(),
  'rollback-failed': new Set()
};

const IMMUTABLE_FIELDS = new Set([
  'schemaVersion',
  'transactionId',
  'projectDir',
  'projectKey',
  'beforeTransactionDigest',
  'afterTransactionDigest',
  'createdAt',
  'changes',
  'proposal',
  'status'
]);

const ELIGIBLE_FOR_PRUNE = new Set(['applied', 'auto-rolled-back', 'rolled-back', 'aborted']);
const NEVER_PRUNE = new Set(['needs-inspection', 'rollback-failed']);

function coded(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function defaultStateRoot() {
  if (process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, 'OH-MY-ChatPCB', 'transactions');
  }
  return path.join(homedir(), '.local', 'state', 'oh-my-chatpcb', 'transactions');
}

async function canonicalProjectDir(projectDir) {
  const resolved = path.resolve(projectDir);
  try {
    return await realpath(resolved);
  } catch (error) {
    if (error?.code === 'ENOENT') return resolved;
    throw error;
  }
}

function projectKeyFor(canonicalDir) {
  return createHash('sha256').update(canonicalDir).digest('hex');
}

function serializeChange(change) {
  let beforeBase64 = change.beforeBase64 ?? null;
  if (beforeBase64 == null && change.beforeBytes != null) {
    beforeBase64 = Buffer.from(change.beforeBytes).toString('base64');
  }
  return {
    path: change.path,
    operation: change.operation,
    beforeHash: change.beforeHash ?? null,
    beforeBase64
  };
}

function persistable(record) {
  return {
    schemaVersion: SCHEMA_VERSION,
    transactionId: record.transactionId,
    projectDir: record.projectDir,
    projectKey: record.projectKey,
    status: record.status,
    beforeTransactionDigest: record.beforeTransactionDigest,
    afterTransactionDigest: record.afterTransactionDigest,
    changes: (record.changes ?? []).map(serializeChange),
    proposal: record.proposal ?? null,
    verification: record.verification ?? null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

function hydrate(record) {
  const stored = persistable(record);
  return {
    ...stored,
    changes: stored.changes.map((change) => ({
      ...change,
      beforeBytes: change.beforeBase64 == null ? null : Buffer.from(change.beforeBase64, 'base64')
    }))
  };
}

async function tryChmod(target, mode) {
  try {
    await chmod(target, mode);
  } catch {
    // Windows and some filesystems ignore or reject POSIX permission bits.
  }
}

async function ensurePrivateDir(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await tryChmod(directory, 0o700);
}

async function replaceAtomic(tempPath, finalPath) {
  await tryChmod(tempPath, 0o600);
  try {
    await rename(tempPath, finalPath);
  } catch (error) {
    if (!['EPERM', 'EEXIST', 'EACCES'].includes(error.code)) throw error;
    const backupPath = `${finalPath}.${randomUUID()}.bak`;
    await rename(finalPath, backupPath);
    try {
      await rename(tempPath, finalPath);
    } catch (renameError) {
      try {
        await rename(backupPath, finalPath);
      } catch {
        // Preserve the backup beside the destination if restoration fails.
      }
      throw renameError;
    }
    await rm(backupPath, { force: true });
  }
  await tryChmod(finalPath, 0o600);
}

function compareRecords(left, right) {
  if (left.createdAt !== right.createdAt) return left.createdAt - right.createdAt;
  if (left.updatedAt !== right.updatedAt) return left.updatedAt - right.updatedAt;
  if (left.transactionId < right.transactionId) return -1;
  if (left.transactionId > right.transactionId) return 1;
  return 0;
}

function applyPatch(record, patch, status) {
  if (patch == null) return { ...record };
  const next = { ...record };
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'status') {
      if (value !== record.status && value !== status) {
        throw coded('JOURNAL_IMMUTABLE_FIELD', 'Journal status cannot be patched independently of transition.');
      }
      continue;
    }
    if (key === 'updatedAt') continue;
    if (key === 'changes') {
      if (JSON.stringify(serializeAll(value)) !== JSON.stringify(serializeAll(record.changes))) {
        throw coded('JOURNAL_IMMUTABLE_FIELD', 'Journal field changes is immutable.');
      }
      continue;
    }
    if (key === 'proposal') {
      if (JSON.stringify(value) !== JSON.stringify(record.proposal)) {
        throw coded('JOURNAL_IMMUTABLE_FIELD', 'Journal field proposal is immutable.');
      }
      continue;
    }
    if (IMMUTABLE_FIELDS.has(key) && value !== record[key]) {
      throw coded('JOURNAL_IMMUTABLE_FIELD', `Journal field ${key} is immutable.`);
    }
    if (!IMMUTABLE_FIELDS.has(key)) next[key] = value;
  }
  return next;
}

function serializeAll(changes) {
  return (changes ?? []).map(serializeChange);
}

export function createTransactionJournal({
  stateRoot,
  now = Date.now,
  retentionMs = DEFAULT_RETENTION_MS,
  maxPerProject = DEFAULT_MAX_PER_PROJECT
} = {}) {
  const root = path.resolve(stateRoot ?? defaultStateRoot());

  function recordPath(record) {
    return path.join(root, record.projectKey, `${record.transactionId}.json`);
  }

  async function writeRecord(record) {
    const stored = persistable(record);
    const directory = path.join(root, stored.projectKey);
    await ensurePrivateDir(root);
    await ensurePrivateDir(directory);
    const finalPath = path.join(directory, `${stored.transactionId}.json`);
    const tempPath = path.join(directory, `${stored.transactionId}.json.${randomUUID()}.tmp`);
    try {
      await writeFile(tempPath, JSON.stringify(stored), { encoding: 'utf8', mode: 0o600 });
      await replaceAtomic(tempPath, finalPath);
    } catch (error) {
      await rm(tempPath, { force: true });
      throw error;
    }
    return stored;
  }

  async function readStored(filePath) {
    const raw = JSON.parse(await readFile(filePath, 'utf8'));
    if (raw.schemaVersion !== SCHEMA_VERSION) {
      throw coded('JOURNAL_UNSUPPORTED_SCHEMA', `Unsupported journal schema version ${raw.schemaVersion}.`);
    }
    return hydrate(raw);
  }

  async function findFile(transactionId) {
    let projects;
    try {
      projects = await readdir(root, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
    for (const entry of projects) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(root, entry.name, `${transactionId}.json`);
      try {
        await access(candidate);
        return candidate;
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
    return null;
  }

  async function get({ transactionId }) {
    const filePath = await findFile(transactionId);
    if (!filePath) return null;
    return readStored(filePath);
  }

  async function list({ projectDir }) {
    const canonical = await canonicalProjectDir(projectDir);
    const directory = path.join(root, projectKeyFor(canonical));
    let names;
    try {
      names = await readdir(directory);
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
    const records = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      records.push(await readStored(path.join(directory, name)));
    }
    records.sort(compareRecords);
    return records;
  }

  async function prune({ projectDir }) {
    const records = await list({ projectDir });
    const timestamp = now();
    const deleted = [];
    const eligible = [];
    for (const record of records) {
      if (NEVER_PRUNE.has(record.status)) continue;
      if (!ELIGIBLE_FOR_PRUNE.has(record.status)) continue;
      if (timestamp - record.updatedAt > retentionMs) {
        await rm(recordPath(record), { force: true });
        deleted.push(record.transactionId);
      } else {
        eligible.push(record);
      }
    }
    eligible.sort((left, right) => {
      if (left.updatedAt !== right.updatedAt) return left.updatedAt - right.updatedAt;
      if (left.transactionId < right.transactionId) return -1;
      if (left.transactionId > right.transactionId) return 1;
      return 0;
    });
    while (eligible.length > maxPerProject) {
      const record = eligible.shift();
      await rm(recordPath(record), { force: true });
      deleted.push(record.transactionId);
    }
    return { deleted };
  }

  async function prepare(input) {
    const canonical = await canonicalProjectDir(input.projectDir);
    const createdAt = now();
    const record = {
      schemaVersion: SCHEMA_VERSION,
      transactionId: `txn_${randomUUID()}`,
      projectDir: canonical,
      projectKey: projectKeyFor(canonical),
      status: 'prepared',
      beforeTransactionDigest: input.beforeTransactionDigest,
      afterTransactionDigest: input.afterTransactionDigest,
      changes: serializeAll(input.changes),
      proposal: input.proposal == null ? null : structuredClone(input.proposal),
      verification: null,
      createdAt,
      updatedAt: createdAt
    };
    await writeRecord(record);
    await prune({ projectDir: canonical });
    return hydrate(record);
  }

  async function transition({ transactionId, status, patch } = {}) {
    const current = await get({ transactionId });
    if (!current) {
      throw coded('JOURNAL_NOT_FOUND', `Journal record ${transactionId} was not found.`);
    }
    if (!ALLOWED_TRANSITIONS[current.status]?.has(status)) {
      throw coded(
        'JOURNAL_INVALID_TRANSITION',
        `Invalid journal transition from ${current.status} to ${status}.`
      );
    }
    const next = applyPatch(current, patch, status);
    next.status = status;
    next.schemaVersion = current.schemaVersion;
    next.transactionId = current.transactionId;
    next.projectDir = current.projectDir;
    next.projectKey = current.projectKey;
    next.beforeTransactionDigest = current.beforeTransactionDigest;
    next.afterTransactionDigest = current.afterTransactionDigest;
    next.createdAt = current.createdAt;
    next.changes = current.changes;
    next.proposal = current.proposal;
    next.updatedAt = now();
    await writeRecord(next);
    if (ELIGIBLE_FOR_PRUNE.has(status)) await prune({ projectDir: current.projectDir });
    return get({ transactionId });
  }

  async function reconcile({ projectDir, collectInventoryImpl } = {}) {
    const canonical = await canonicalProjectDir(projectDir);
    const impl = collectInventoryImpl
      ?? (await import('../evidence/transaction-inventory.js')).collectTransactionInventory;
    const inventory = await impl({ projectDir: canonical });
    const currentDigest = inventory.transactionDigest;
    const records = await list({ projectDir: canonical });
    for (const record of records) {
      if (record.status !== 'prepared' && record.status !== 'applying') continue;
      let status;
      if (currentDigest === record.beforeTransactionDigest) status = 'aborted';
      else if (currentDigest === record.afterTransactionDigest) status = 'applied';
      else status = 'needs-inspection';
      if (status !== record.status) {
        await transition({ transactionId: record.transactionId, status });
      }
    }
    return { records: await list({ projectDir: canonical }) };
  }

  return { prepare, transition, get, list, reconcile, prune };
}
