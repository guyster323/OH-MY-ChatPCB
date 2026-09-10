import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { assertInspectionTree } from '../workflow/inspection-copy.js';

const TRANSACTION_EXTENSIONS = new Map([
  ['.kicad_pro', 'project'],
  ['.kicad_sch', 'schematic'],
  ['.kicad_pcb', 'board'],
  ['.kicad_sym', 'symbol-library'],
  ['.kicad_mod', 'footprint'],
  ['.kicad_dru', 'design-rules'],
  ['.cir', 'spice']
]);

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

export function transactionArtifactKind(relativePath) {
  const normalized = relativePath.split(path.sep).join('/');
  if (normalized.endsWith('.chatpcb.json')) return 'chatpcb-manifest';
  if (path.posix.basename(normalized) === 'sym-lib-table') return 'symbol-table';
  if (path.posix.basename(normalized) === 'fp-lib-table') return 'footprint-table';
  return TRANSACTION_EXTENSIONS.get(path.posix.extname(normalized)) ?? null;
}

function compareArtifactPaths(left, right) {
  return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
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
    transactionDigest: sha256(JSON.stringify(artifacts)),
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
