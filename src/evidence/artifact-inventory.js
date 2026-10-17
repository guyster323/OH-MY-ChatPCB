import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { compareArtifactPaths, digestArtifactKind, digestOfArtifacts } from './digest-exclusions.js';

export { compareArtifactPaths };

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const files = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolute));
    else if (entry.isFile()) files.push(absolute);
  }
  return files;
}

export async function collectArtifactInventory({ projectDir }) {
  const root = path.resolve(projectDir);
  const artifacts = [];
  for (const absolutePath of await walk(root)) {
    const relative = path.relative(root, absolutePath).split(path.sep).join('/');
    const kind = digestArtifactKind(relative);
    if (!kind) continue;
    const content = await readFile(absolutePath);
    artifacts.push({ path: relative, kind, sha256: sha256(content), size: content.length });
  }
  artifacts.sort(compareArtifactPaths);
  return { projectDigest: digestOfArtifacts(artifacts), artifacts };
}
