import { readdir } from 'node:fs/promises';
import path from 'node:path';

import { runCommand } from '../kicad/kicad-cli.js';

export async function simulateProject({ projectDir, ngspicePath = 'ngspice', runCommandImpl = runCommand } = {}) {
  if (!projectDir) {
    throw new Error('projectDir is required.');
  }

  const resolvedProjectDir = path.resolve(projectDir);
  const circuit = await findFirst(resolvedProjectDir, '.cir');
  if (!circuit) {
    return skipped('NO_SPICE_FIXTURE', `No .cir file found in ${resolvedProjectDir}.`);
  }

  try {
    const result = await runCommandImpl(ngspicePath, ['-b', circuit], { cwd: resolvedProjectDir });

    return {
      ok: result.exitCode === 0,
      skipped: false,
      tool: ngspicePath,
      circuit,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr
    };
  } catch (error) {
    return skipped('NGSPICE_UNAVAILABLE', error.message);
  }
}

async function findFirst(projectDir, extension) {
  const entries = await readdir(projectDir, { withFileTypes: true });
  const match = entries.find((entry) => entry.isFile() && entry.name.endsWith(extension));
  return match ? path.join(projectDir, match.name) : null;
}

function skipped(code, message) {
  return {
    ok: true,
    skipped: true,
    reason: { code, message }
  };
}
