import { cp, lstat, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { assertSafeProjectDir, isInside } from './project-workspace.js';

function unsafe(entry) {
  const error = new Error('Inspection cannot use a symbolic link, junction, or special file: ' + entry);
  error.code = 'UNSAFE_INSPECTION_LINK';
  return error;
}

// Symlinks inside the project tree are rejected. Ancestors of the trusted
// root are not: macOS os.tmpdir() is under /var, and /var is a symlink to
// /private/var. realpath canonicalizes that root before the walk.
async function assertUnlinkedProjectTree(canonicalRoot) {
  const pending = [canonicalRoot];
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
}

export async function assertInspectionTree(projectDir, { allowedWorkspaceRoot } = {}) {
  const root = assertSafeProjectDir(projectDir, allowedWorkspaceRoot ? { allowedWorkspaceRoot } : {});
  // The project directory entry itself must be a real directory. lstat does
  // not follow the final component, so a symlinked project root is rejected
  // without walking ancestors above the trusted root.
  const rootInfo = await lstat(root);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw unsafe(root);

  const canonicalRoot = await realpath(root);
  const actualRoot = assertSafeProjectDir(canonicalRoot);
  if (allowedWorkspaceRoot) {
    const actualWorkspace = await realpath(allowedWorkspaceRoot);
    if (actualRoot !== actualWorkspace && !isInside(actualWorkspace, actualRoot)) {
      const error = new Error('Inspection project must remain inside the configured workspace.');
      error.code = 'UNSAFE_PROJECT_DIR';
      throw error;
    }
  }
  await assertUnlinkedProjectTree(canonicalRoot);
  return root;
}

export async function copyInspectionTree(projectDir, destination) {
  // Check the project tree, then copy from its canonical path so an ancestor
  // alias (OS temp dir, macOS /var) is not re-resolved during the copy.
  const checkedRoot = await assertInspectionTree(projectDir);
  const canonicalSource = await realpath(checkedRoot);
  const resolvedDestination = path.resolve(destination);
  const canonicalParent = await realpath(path.dirname(resolvedDestination));
  const canonicalDestination = path.join(canonicalParent, path.basename(resolvedDestination));
  // Keep dereference false. A link introduced during copying is rejected below,
  // before any tool receives the copy. Regular files are copied, never hardlinked.
  await cp(canonicalSource, canonicalDestination, { recursive: true, dereference: false, errorOnExist: true, force: false });
  await assertInspectionTree(canonicalDestination);
  return canonicalDestination;
}

