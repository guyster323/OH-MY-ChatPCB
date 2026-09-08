import { cp, lstat, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { assertSafeProjectDir, isInside } from './project-workspace.js';

function unsafe(entry) {
  const error = new Error('Inspection cannot use a symbolic link, junction, or special file: ' + entry);
  error.code = 'UNSAFE_INSPECTION_LINK';
  return error;
}

// Check every component: lstat(projectDir) alone misses an ancestor junction.
async function assertUnlinkedAncestors(directory) {
  let current = path.resolve(directory);
  while (true) {
    const info = await lstat(current);
    if (info.isSymbolicLink() || !info.isDirectory()) throw unsafe(current);
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

export async function assertInspectionTree(projectDir, { allowedWorkspaceRoot } = {}) {
  const root = assertSafeProjectDir(projectDir);
  await assertUnlinkedAncestors(root);
  const actualRoot = assertSafeProjectDir(await realpath(root));
  if (allowedWorkspaceRoot) {
    const actualWorkspace = await realpath(allowedWorkspaceRoot);
    if (actualRoot !== actualWorkspace && !isInside(actualWorkspace, actualRoot)) {
      const error = new Error('Inspection project must remain inside the configured workspace.');
      error.code = 'UNSAFE_PROJECT_DIR';
      throw error;
    }
  }
  const pending = [root];
  while (pending.length) {
    const directory = pending.pop();
    const info = await lstat(directory);
    if (info.isSymbolicLink() || !info.isDirectory()) throw unsafe(directory);
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      const stat = await lstat(entryPath);
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw unsafe(entryPath);
      if (stat.isDirectory()) pending.push(entryPath);
    }
  }
  return root;
}

export async function copyInspectionTree(projectDir, destination) {
  // User-supplied project paths are checked as given. Only the internally created
  // destination parent is canonicalized so OS temp aliases do not reject the copy.
  await assertInspectionTree(projectDir);
  const resolvedDestination = path.resolve(destination);
  const canonicalParent = await realpath(path.dirname(resolvedDestination));
  const canonicalDestination = path.join(canonicalParent, path.basename(resolvedDestination));
  // Keep dereference false. A link introduced during copying is rejected below,
  // before any tool receives the copy. Regular files are copied, never hardlinked.
  await cp(projectDir, canonicalDestination, { recursive: true, dereference: false, errorOnExist: true, force: false });
  await assertInspectionTree(canonicalDestination);
  return canonicalDestination;
}

