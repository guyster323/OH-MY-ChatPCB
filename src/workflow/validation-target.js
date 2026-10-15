import path from 'node:path';
import { assertInside } from '../shared/path-guard.js';

export function resolveValidationTarget(projectDir, targetPath) {
  if (typeof targetPath !== 'string' || targetPath.trim().length === 0) {
    const error = new Error('Validation target path is required.');
    error.code = 'UNSAFE_VALIDATION_TARGET';
    throw error;
  }

  const resolved = path.resolve(projectDir, targetPath);
  if (resolved !== projectDir) {
    assertInside(projectDir, resolved, {
      message: 'Validation target must remain inside the project directory.',
      code: 'UNSAFE_VALIDATION_TARGET'
    });
  }

  return resolved;
}
