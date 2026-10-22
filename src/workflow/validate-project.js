import { createHash } from 'node:crypto';
import { readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';

import { isKicadLauncherFailure, runKicadCli } from '../kicad/kicad-cli.js';
import { assertInspectionTree } from './inspection-copy.js';
import { isInside } from './project-workspace.js';

export async function validateProject({
  projectDir,
  kicadCliPath,
  excludeProjectDir,
  schematicPath,
  runKicadCliImpl = runKicadCli
} = {}) {
  if (!projectDir) {
    throw new Error('projectDir is required.');
  }

  const resolvedProjectDir = await assertInspectionTree(projectDir);
  const schematic = schematicPath
    ? resolveValidationTarget(resolvedProjectDir, schematicPath)
    : await findFirst(resolvedProjectDir, '.kicad_sch');
  if (!schematic) {
    return skipped('NO_SCHEMATIC', `No .kicad_sch file found in ${resolvedProjectDir}.`);
  }

  const output = path.join(resolvedProjectDir, 'chatpcb-erc.json');

  try {
    const cliOptions = {
      explicitPath: kicadCliPath,
      cwd: resolvedProjectDir,
      excludeProjectDir: excludeProjectDir ?? resolvedProjectDir
    };
    const schematicBefore = await fileDigest(schematic);
    const formatUpgrade = await runKicadCliImpl(['sch', 'upgrade', '--force', schematic], cliOptions);
    const upgradeOk = formatUpgrade.exitCode === 0;
    const upgradeLaunchFailed = !upgradeOk
      && (formatUpgrade.launchFailed === true || isKicadLauncherFailure(formatUpgrade));
    // A launcher failure is tolerated only when the schematic bytes are provably
    // unchanged, so the ERC below checks exactly the bytes the patch will carry.
    const schematicUntouched = upgradeLaunchFailed
      && schematicBefore !== null
      && schematicBefore === await fileDigest(schematic);
    const upgradeSummary = {
      ok: upgradeOk,
      launchFailed: upgradeLaunchFailed,
      exitCode: formatUpgrade.exitCode,
      stdout: formatUpgrade.stdout,
      stderr: formatUpgrade.stderr
    };

    // A report left by an earlier run must never stand in for this run.
    await rm(output, { force: true });
    const result = await runKicadCliImpl(['sch', 'erc', '--format', 'json', '--output', output, schematic], cliOptions);
    const base = {
      skipped: false,
      tool: result.command,
      source: result.source,
      formatUpgrade: upgradeSummary,
      report: output
    };
    const runOutput = { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };

    if (result.exitCode !== 0 && (result.launchFailed === true || isKicadLauncherFailure(result))) {
      return {
        ok: false,
        ...base,
        erc: { errorCount: 0, warningCount: 0, byType: {} },
        reason: failureReason('KICAD_CLI_LAUNCH_FAILED', 'The KiCad CLI launcher failed before ERC ran.', result.stderr),
        ...runOutput
      };
    }

    const erc = await readErcSummary(output);

    if (erc.invalid) {
      return {
        ok: false,
        ...base,
        erc: {
          errorCount: 0,
          warningCount: 0,
          byType: {}
        },
        reason: {
          code: 'ERC_REPORT_INVALID',
          message: erc.message
        },
        ...runOutput
      };
    }

    const ercOk = result.exitCode === 0 && erc.errorCount === 0;
    const upgradeTolerated = upgradeLaunchFailed && schematicUntouched;
    const reason = upgradeOk
      ? null
      : failureReason(
        'ERC_FORMAT_UPGRADE_FAILED',
        upgradeTolerated
          ? 'The format upgrade launcher failed before KiCad started; the schematic is unchanged, so ERC checked the same bytes.'
          : 'kicad-cli sch upgrade failed, so the ERC result is not trusted.',
        formatUpgrade.stderr
      );

    return {
      ok: ercOk && (upgradeOk || upgradeTolerated),
      ...base,
      erc,
      ...(reason ? { reason } : {}),
      ...runOutput
    };
  } catch (error) {
    if (error.code === 'KICAD_CLI_TIMEOUT') {
      return { ok: false, skipped: false, reason: { code: error.code, message: error.message } };
    }
    const message = error.code === 'ENOENT' 
      ? 'kicad-cli not found. Install KiCad or set KICAD_CLI_PATH environment variable.'
      : error.message;
    return skipped('KICAD_CLI_UNAVAILABLE', message);
  }
}

function resolveValidationTarget(projectDir, targetPath) {
  if (typeof targetPath !== 'string' || targetPath.trim().length === 0) {
    const error = new Error('Validation target path is required.');
    error.code = 'UNSAFE_VALIDATION_TARGET';
    throw error;
  }

  const resolved = path.resolve(projectDir, targetPath);
  if (resolved !== projectDir && !isInside(projectDir, resolved)) {
    const error = new Error('Validation target must remain inside the project directory.');
    error.code = 'UNSAFE_VALIDATION_TARGET';
    throw error;
  }

  return resolved;
}

async function findFirst(projectDir, extension) {
  const entries = await readdir(projectDir, { withFileTypes: true });
  const match = entries.find((entry) => entry.isFile() && entry.name.endsWith(extension));
  return match ? path.join(projectDir, match.name) : null;
}

async function readErcSummary(reportPath) {
  try {
    const report = JSON.parse(await readFile(reportPath, 'utf8'));
    if (!report || typeof report !== 'object' || Array.isArray(report)) {
      return { invalid: true, message: `ERC report is not a JSON object: ${reportPath}` };
    }

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
  } catch (error) {
    return {
      invalid: true,
      message: `ERC report could not be read: ${error.message}`
    };
  }
}

const STDERR_EXCERPT_CHARS = 200;

// A short, single-line stderr excerpt for the ERC_BLOCKED response. Absolute
// paths are replaced so the excerpt does not leak local directories.
export function stderrExcerpt(stderr) {
  if (typeof stderr !== 'string') return '';
  const line = stderr
    .replace(/[A-Za-z]:\\[^\s"']+/g, '<path>')
    .replace(/(?<![\w.])\/[^\s"']+/g, '<path>')
    .replace(/\s+/g, ' ')
    .trim();
  return line.length > STDERR_EXCERPT_CHARS ? `${line.slice(0, STDERR_EXCERPT_CHARS - 3)}...` : line;
}

function failureReason(code, message, stderr) {
  const excerpt = stderrExcerpt(stderr);
  return { code, message, ...(excerpt ? { stderr: excerpt } : {}) };
}

async function fileDigest(filePath) {
  try {
    return createHash('sha256').update(await readFile(filePath)).digest('hex');
  } catch {
    return null;
  }
}

function skipped(code, message) {
  return {
    ok: true,
    skipped: true,
    reason: { code, message }
  };
}
