import { mkdir } from 'node:fs/promises';
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

function isInside(workspaceRoot, candidate) {
  const relative = path.relative(workspaceRoot, candidate);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

function typedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
