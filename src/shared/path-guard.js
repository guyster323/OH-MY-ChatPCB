import path from 'node:path';

export function isInside(workspaceRoot, candidate) {
  const relative = path.relative(workspaceRoot, candidate);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

export function assertInside(workspaceRoot, candidate, errorMessage) {
  if (!isInside(workspaceRoot, candidate)) {
    const error = new Error(errorMessage ?? `Path must remain inside the workspace root: ${candidate}`);
    error.code = 'UNSAFE_PROJECT_DIR';
    throw error;
  }
  return candidate;
}
