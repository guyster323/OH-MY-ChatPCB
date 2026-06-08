import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { runKicadCli } from '../kicad/kicad-cli.js';

export async function validateProject({ projectDir, kicadCliPath, runKicadCliImpl = runKicadCli } = {}) {
  if (!projectDir) {
    throw new Error('projectDir is required.');
  }

  const resolvedProjectDir = path.resolve(projectDir);
  const schematic = await findFirst(resolvedProjectDir, '.kicad_sch');
  if (!schematic) {
    return skipped('NO_SCHEMATIC', `No .kicad_sch file found in ${resolvedProjectDir}.`);
  }

  const output = path.join(resolvedProjectDir, 'chatpcb-erc.json');

  try {
    const formatUpgrade = await runKicadCliImpl(['sch', 'upgrade', '--force', schematic], {
      explicitPath: kicadCliPath,
      cwd: resolvedProjectDir
    });

    const result = await runKicadCliImpl(['sch', 'erc', '--format', 'json', '--output', output, schematic], {
      explicitPath: kicadCliPath,
      cwd: resolvedProjectDir
    });

    const erc = await readErcSummary(output);
    const upgradeOk = formatUpgrade.exitCode === 0;

    return {
      ok: upgradeOk && result.exitCode === 0 && erc.errorCount === 0,
      skipped: false,
      tool: result.command,
      source: result.source,
      formatUpgrade: {
        ok: upgradeOk,
        exitCode: formatUpgrade.exitCode,
        stdout: formatUpgrade.stdout,
        stderr: formatUpgrade.stderr
      },
      report: output,
      erc,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr
    };
  } catch (error) {
    return skipped('KICAD_CLI_UNAVAILABLE', error.message);
  }
}

async function findFirst(projectDir, extension) {
  const entries = await readdir(projectDir, { withFileTypes: true });
  const match = entries.find((entry) => entry.isFile() && entry.name.endsWith(extension));
  return match ? path.join(projectDir, match.name) : null;
}

async function readErcSummary(reportPath) {
  try {
    const report = JSON.parse(await readFile(reportPath, 'utf8'));
    const violations = (report.sheets ?? []).flatMap((sheet) => sheet.violations ?? []);
    const byType = {};
    let errorCount = 0;
    let warningCount = 0;

    for (const violation of violations) {
      byType[violation.type] = (byType[violation.type] ?? 0) + 1;
      if (violation.severity === 'error') {
        errorCount += 1;
      } else if (violation.severity === 'warning') {
        warningCount += 1;
      }
    }

    return {
      errorCount,
      warningCount,
      byType
    };
  } catch {
    return {
      errorCount: 0,
      warningCount: 0,
      byType: {}
    };
  }
}

function skipped(code, message) {
  return {
    ok: true,
    skipped: true,
    reason: { code, message }
  };
}
