import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { compareArtifactPaths, digestArtifactKind, digestOfArtifacts } from './digest-exclusions.js';
import { assertInspectionTree } from '../workflow/inspection-copy.js';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

export function transactionArtifactKind(relativePath) {
  return digestArtifactKind(relativePath);
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolute));
    else if (entry.isFile()) files.push(absolute);
  }
  return files;
}

export async function collectTransactionSnapshot({ projectDir }) {
  const root = await assertInspectionTree(projectDir);
  const files = [];
  for (const absolutePath of await walk(root)) {
    const relative = path.relative(root, absolutePath).split(path.sep).join('/');
    const kind = transactionArtifactKind(relative);
    if (!kind) continue;
    const bytes = await readFile(absolutePath);
    files.push({
      path: relative,
      kind,
      sha256: sha256(bytes),
      size: bytes.length,
      bytes
    });
  }
  files.sort(compareArtifactPaths);
  const artifacts = files.map(({ path: artifactPath, kind, sha256: digest, size }) => ({
    path: artifactPath,
    kind,
    sha256: digest,
    size
  }));
  return {
    projectDir: root,
    transactionDigest: digestOfArtifacts(artifacts),
    artifacts,
    files
  };
}

export async function collectTransactionInventory({ projectDir }) {
  const snapshot = await collectTransactionSnapshot({ projectDir });
  return {
    projectDir: snapshot.projectDir,
    transactionDigest: snapshot.transactionDigest,
    artifacts: snapshot.artifacts
  };
}
