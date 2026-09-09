import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { runKicadCli } from '../kicad/kicad-cli.js';
import { assertInspectionTree } from './inspection-copy.js';

export async function validateBoard({ projectDir, kicadCliPath, excludeProjectDir, runKicadCliImpl = runKicadCli } = {}) {
  if (!projectDir) {
    throw new Error('projectDir is required.');
  }

  const resolvedProjectDir = await assertInspectionTree(projectDir);
  const board = await findFirst(resolvedProjectDir, '.kicad_pcb');
  if (!board) {
    return skipped('NO_BOARD', `No .kicad_pcb file found in ${resolvedProjectDir}.`);
  }

  const report = path.join(resolvedProjectDir, 'chatpcb-drc.json');

  try {
    const result = await runKicadCliImpl(
      ['pcb', 'drc', '--refill-zones', '--format', 'json', '--output', report, board],
      {
        explicitPath: kicadCliPath,
        cwd: resolvedProjectDir,
        excludeProjectDir: excludeProjectDir ?? resolvedProjectDir
      }
    );
    const drc = await readDrcSummary(report);

    if (drc.invalid) {
      return {
        ok: false,
        skipped: false,
        tool: result.command,
        source: result.source,
        report,
        drc: emptyDrc(),
        reason: {
          code: 'PCB_DRC_REPORT_INVALID',
          message: drc.message
        },
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr
      };
    }

    const ok = result.exitCode === 0 && drc.violationCount === 0 && drc.unconnectedCount === 0;
    return {
      ok,
      skipped: false,
      tool: result.command,
      source: result.source,
      report,
      drc,
      ...(result.exitCode === 0
        ? {}
        : {
            reason: {
              code: 'PCB_DRC_FAILED',
              message: `KiCad PCB DRC exited with code ${result.exitCode}.`
            }
          }),
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr
    };
  } catch (error) {
    if (error?.code === 'ENOENT' || /\bENOENT\b/i.test(error.message ?? '')) {
      return skipped('KICAD_CLI_UNAVAILABLE', error.message);
    }

    return {
      ok: false,
      skipped: false,
      report,
      drc: emptyDrc(),
      reason: {
        code: 'PCB_DRC_FAILED',
        message: error.message
      }
    };
  }
}

async function findFirst(projectDir, extension) {
  const entries = await readdir(projectDir, { withFileTypes: true });
  const match = entries.find((entry) => entry.isFile() && entry.name.endsWith(extension));
  return match ? path.join(projectDir, match.name) : null;
}

async function readDrcSummary(reportPath) {
  try {
    const report = JSON.parse(await readFile(reportPath, 'utf8'));
    if (!report || typeof report !== 'object' || Array.isArray(report)) {
      return { invalid: true, message: `PCB DRC report is not a JSON object: ${reportPath}` };
    }

    if (!Array.isArray(report.violations) || !Array.isArray(report.unconnected_items)) {
      return {
        invalid: true,
        message: `PCB DRC report must contain violations and unconnected_items arrays: ${reportPath}`
      };
    }

    const byType = {};
    for (const item of [...report.violations, ...report.unconnected_items]) {
      const type = typeof item?.type === 'string' && item.type ? item.type : 'unknown';
      byType[type] = (byType[type] ?? 0) + 1;
    }

    const unconnectedByNet = {};
    for (const item of report.unconnected_items) {
      const netName = unconnectedNetName(item);
      unconnectedByNet[netName] = (unconnectedByNet[netName] ?? 0) + 1;
    }

    return {
      violationCount: report.violations.length,
      unconnectedCount: report.unconnected_items.length,
      byType,
      unconnectedByNet
    };
  } catch (error) {
    return {
      invalid: true,
      message: `PCB DRC report could not be read: ${error.message}`
    };
  }
}

function emptyDrc() {
  return {
    violationCount: 0,
    unconnectedCount: 0,
    byType: {},
    unconnectedByNet: {}
  };
}

function unconnectedNetName(item) {
  for (const endpoint of item?.items ?? []) {
    const match = endpoint?.description?.match(/\[([^\]]+)\]/);
    if (match) {
      return match[1];
    }
  }

  return 'unknown';
}

function skipped(code, message) {
  return {
    ok: true,
    skipped: true,
    reason: { code, message }
  };
}
