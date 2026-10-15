import path from 'node:path';

export function isInside(workspaceRoot, candidate) {
  const relative = path.relative(workspaceRoot, candidate);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

export function assertInside(workspaceRoot, candidate, options) {
  if (
    options === null ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    typeof options.code !== 'string' ||
    options.code.length === 0
  ) {
    throw new TypeError('assertInside expects an options object with a non-empty code string.');
  }

  if (!isInside(workspaceRoot, candidate)) {
    const error = new Error(options.message ?? `Path must remain inside the workspace root: ${candidate}`);
    error.code = options.code;
    throw error;
  }
  return candidate;
}
