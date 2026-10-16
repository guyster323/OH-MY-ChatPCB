import { lstatSync, realpathSync } from 'node:fs';
import { cp, lstat, readdir, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assertSafeProjectDir, isInside } from './project-workspace.js';

function unsafe(entry) {
  const error = new Error('Inspection cannot use a symbolic link, junction, or special file: ' + entry);
  error.code = 'UNSAFE_INSPECTION_LINK';
  return error;
}

// Symlink paths that sit on the way to a trusted root. macOS os.tmpdir() is
// /var/folders/... while /var itself is a symlink to /private/var; that /var
// entry is trusted. A sibling alias that merely points at the same directory
// is not on that path and stays rejected.
function trustedAncestorSymlinks(allowedWorkspaceRoot) {
  const trusted = new Set();
  const starts = [tmpdir()];
  try {
    starts.push(realpathSync(tmpdir()));
  } catch {
    // A missing temp directory still contributes its lexical ancestors.
  }
  if (typeof allowedWorkspaceRoot === 'string' && allowedWorkspaceRoot.length > 0) {
    const resolved = path.resolve(allowedWorkspaceRoot);
    starts.push(resolved);
    try {
      starts.push(realpathSync(resolved));
    } catch {
      // The workspace root may not exist yet; its lexical path still counts.
    }
  }
  for (const start of starts) addSymlinkAncestors(start, trusted);
  return trusted;
}

function addSymlinkAncestors(start, trusted) {
  let current = path.resolve(start);
  while (true) {
    let info;
    try {
      info = lstatSync(current);
    } catch {
      return;
    }
    if (info.isSymbolicLink()) trusted.add(current);
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

// Check every component: lstat(projectDir) alone misses an ancestor junction.
// Missing tail components are skipped so the check can run before mkdir.
export async function assertUnlinkedAncestors(directory, { allowedWorkspaceRoot } = {}) {
  const trusted = trustedAncestorSymlinks(allowedWorkspaceRoot);
  let current = path.resolve(directory);
  let checkingProject = true;
  while (true) {
    let info;
    try {
      info = await lstat(current);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      info = null;
    }
    if (info?.isSymbolicLink()) {
      if (checkingProject || !trusted.has(current)) throw unsafe(current);
    } else if (info && !info.isDirectory()) {
      throw unsafe(current);
    }
    checkingProject = false;
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

// Symlinks inside the project tree are rejected. The walk starts at the
// canonical project root, so trusted ancestor aliases are not visited again.
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
  // Walk the path as given. realpath would hide the ancestor symlink.
  await assertUnlinkedAncestors(root, { allowedWorkspaceRoot });
  // The project directory entry itself must be a real directory. lstat does
  // not follow the final component, so a symlinked project root is rejected.
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

