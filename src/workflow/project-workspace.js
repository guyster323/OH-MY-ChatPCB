import { lstatSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const WINDOWS_RESERVED_BASENAMES = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/iu;

export async function createNamedProject({ workspaceRoot, projectName } = {}) {
  const displayName = validateProjectName(projectName);
  const slug = slugify(displayName);
  const resolvedWorkspaceRoot = path.resolve(workspaceRoot ?? '');
  const projectDir = path.resolve(resolvedWorkspaceRoot, slug);

  if (!isInside(resolvedWorkspaceRoot, projectDir)) {
    throw typedError('INVALID_PROJECT_NAME', 'Project directory must be inside the workspace root.');
  }

  await mkdir(resolvedWorkspaceRoot, { recursive: true });

  try {
    await mkdir(projectDir, { recursive: false });
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw typedError('PROJECT_EXISTS', `A project named "${displayName}" already exists.`);
    }
    throw error;
  }

  return { displayName, slug, projectDir };
}

function validateProjectName(projectName) {
  if (typeof projectName !== 'string') {
    throw typedError('INVALID_PROJECT_NAME', 'Project name must be a string.');
  }

  const displayName = projectName.trim();
  if (
    !displayName ||
    displayName === '.' ||
    displayName === '..' ||
    /[\\/]/u.test(displayName) ||
    !/^[\p{L}\p{N}\s_-]+$/u.test(displayName) ||
    WINDOWS_RESERVED_BASENAMES.test(displayName)
  ) {
    throw typedError('INVALID_PROJECT_NAME', 'Project name contains unsupported or unsafe characters.');
  }

  return displayName;
}

function slugify(displayName) {
  const slug = displayName.replace(/\s+/gu, '-');
  if (!slug || slug === '.' || slug === '..' || WINDOWS_RESERVED_BASENAMES.test(slug)) {
    throw typedError('INVALID_PROJECT_NAME', 'Project name cannot produce an empty or reserved directory name.');
  }
  return slug;
}

export function isInside(workspaceRoot, candidate) {
  const relative = path.relative(workspaceRoot, candidate);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

export function assertSafeProjectDir(projectDir, { allowedWorkspaceRoot, fsImpl } = {}) {
  if (typeof projectDir !== 'string' || projectDir.trim().length === 0) {
    throw typedError('UNSAFE_PROJECT_DIR', 'Project directory is required.');
  }

  const resolvedProjectDir = path.resolve(projectDir);
  const canonicalProjectDir = canonicalPath(resolvedProjectDir, fsImpl);
  if (isProtectedPath(resolvedProjectDir) || isProtectedPath(canonicalProjectDir)) {
    throw typedError('UNSAFE_PROJECT_DIR', `Refusing to use protected path as a project directory: ${resolvedProjectDir}`);
  }

  if (allowedWorkspaceRoot) {
    // Compare canonical paths so a symlink ancestor of the workspace (macOS
    // /var -> /private/var, or an alias of the workspace root) is the same
    // directory on both sides. A link that escapes the workspace still fails.
    const canonicalWorkspaceRoot = canonicalPath(path.resolve(allowedWorkspaceRoot), fsImpl);
    if (canonicalProjectDir !== canonicalWorkspaceRoot && !isInside(canonicalWorkspaceRoot, canonicalProjectDir)) {
      throw typedError('UNSAFE_PROJECT_DIR', 'Project directory must stay inside the allowed workspace root.');
    }
  }

  return resolvedProjectDir;
}

// realpath the longest existing prefix, then rejoin a tail that does not exist
// yet. A missing component that is already a symlink is dangling: rejoining it
// lexically would let the target appear later and escape the workspace.
// Ancestors that realpath can resolve may still be symlinks.
// Windows realpath throws ENOENT, not ENOTDIR, when a parent component is a
// file. A resolved ancestor with a missing tail is allowed only if that
// ancestor is a directory. fsImpl.realpathSync, when set, replaces
// fs.realpathSync so tests can simulate that ENOENT.
function canonicalPath(candidate, fsImpl) {
  const resolveRealpath = fsImpl?.realpathSync ?? realpathSync;
  const missing = [];
  let current = candidate;
  while (true) {
    let real;
    try {
      real = resolveRealpath(current);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw unsafeCanonicalError(error);
      rejectIfDanglingSymlink(current);
      const parent = path.dirname(current);
      if (parent === current) return candidate;
      missing.push(path.basename(current));
      current = parent;
      continue;
    }
    if (missing.length > 0) rejectIfNonDirectoryAncestor(real);
    return missing.reduceRight((dir, name) => path.join(dir, name), real);
  }
}

// Classify the resolved ancestor. lstat of the lexical path would treat a
// symlink to a directory as a non-directory and reject a missing project.
function rejectIfNonDirectoryAncestor(real) {
  let info;
  try {
    info = lstatSync(real);
  } catch (error) {
    throw unsafeCanonicalError(error);
  }
  if (info.isDirectory()) return;
  const cause = new Error('ENOTDIR: not a directory, lstat');
  cause.code = 'ENOTDIR';
  throw unsafeCanonicalError(cause);
}

function rejectIfDanglingSymlink(candidate) {
  let info;
  try {
    info = lstatSync(candidate, { throwIfNoEntry: false });
  } catch (error) {
    throw unsafeCanonicalError(error);
  }
  if (info?.isSymbolicLink()) {
    throw typedError('UNSAFE_PROJECT_DIR', 'Project directory must not contain a dangling symbolic link.');
  }
}

function unsafeCanonicalError(error) {
  return typedError('UNSAFE_PROJECT_DIR', 'Project directory cannot be resolved safely.', error);
}

export async function readChatPcbManifest(projectDir) {
  const manifests = (await readdir(projectDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.chatpcb.json'));

  if (manifests.length > 1) {
    throw typedError('MULTIPLE_CHATPCB_MANIFESTS', 'A project may contain at most one .chatpcb.json manifest.');
  }

  if (manifests.length === 0) return null;

  try {
    return JSON.parse(await readFile(path.join(projectDir, manifests[0].name), 'utf8'));
  } catch (error) {
    throw typedError('CHATPCB_MANIFEST_INVALID', `ChatPCB manifest is invalid: ${error.message}`);
  }
}

function isProtectedPath(candidate) {
  const home = path.resolve(homedir());
  const protectedPaths = new Set(
    [
      path.parse(candidate).root,
      home,
      path.dirname(home),
      process.env.WINDIR,
      process.env.SystemRoot,
      process.env.ProgramFiles,
      process.env['ProgramFiles(x86)'],
      'C:\\Windows',
      'C:\\Program Files',
      'C:\\Program Files (x86)'
    ]
      .filter((value) => typeof value === 'string' && value.length > 0)
      .map((value) => path.resolve(value))
  );

  return protectedPaths.has(candidate);
}

function typedError(code, message, cause) {
  const error = cause === undefined ? new Error(message) : new Error(message, { cause });
  error.code = code;
  return error;
}
