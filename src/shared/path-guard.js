import path from 'node:path';

export function isInside(workspaceRoot, candidate) {
  const relative = path.relative(workspaceRoot, candidate);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

export function assertInside(workspaceRoot, candidate, errorMessageOrOptions) {
  let errorMessage;
  let errorCode = 'UNSAFE_PROJECT_DIR';
  
  if (typeof errorMessageOrOptions === 'string') {
    errorMessage = errorMessageOrOptions;
  } else if (errorMessageOrOptions && typeof errorMessageOrOptions === 'object') {
    errorMessage = errorMessageOrOptions.message;
    errorCode = errorMessageOrOptions.code ?? errorCode;
  }
  
  if (!isInside(workspaceRoot, candidate)) {
    const error = new Error(errorMessage ?? `Path must remain inside the workspace root: ${candidate}`);
    error.code = errorCode;
    throw error;
  }
  return candidate;
}
