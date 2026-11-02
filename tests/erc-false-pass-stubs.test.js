// Bug Triage false-pass stubs P1-P17 for PR #29 (triage/erc-flake/pr29).
// No real KiCad or flatpak: runKicadCliImpl is stubbed. Every assertion fails
// when a patch that should be blocked would be approved.
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { isKicadLauncherFailure, retryOnceOnLauncherFailure } from '../src/kicad/kicad-cli.js';
import { ercApprovalDecision, normalizeRecordedErc } from '../src/runtime/erc-gate.js';
import { validateProject } from '../src/workflow/validate-project.js';

const MERGE_DIRS = 'error: Extension org.freedesktop.Platform.GL.default has invalid merge-dirs\n';
const SCHEMATIC = '(kicad_sch (version 20231120))\n';
const ERRORS = [{ type: 'pin_not_connected', severity: 'error' }];
// chmod cannot make a file unreadable for root, and does not apply on Windows.
const NO_CHMOD = process.platform === 'win32' || process.getuid?.() === 0;

const launcherFailure = () => ({ exitCode: 1, stdout: '', stderr: MERGE_DIRS, command: 'flatpak', source: 'flatpak' });
const clean = (stdout = 'Found 0 violations\n') => ({ exitCode: 0, stdout, stderr: '', command: 'flatpak', source: 'flatpak' });
const reportPath = (args) => args[args.indexOf('--output') + 1];
const writeReport = (args, violations) => writeFile(reportPath(args), JSON.stringify({ sheets: [{ violations }] }));
const approved = (result, override) => ercApprovalDecision(normalizeRecordedErc(result), override).allow === true;

async function withProject(run) {
  const dir = await mkdtemp(path.join(tmpdir(), 'chatpcb-erc-stub-'));
  await writeFile(path.join(dir, 'demo.kicad_sch'), SCHEMATIC);
  try {
    return await run(dir);
  } finally {
    await chmod(dir, 0o755).catch(() => {});
    await rm(dir, { recursive: true, force: true });
  }
}

test('P1 upgrade launcher failure that still wrote the schematic is not approved', () => withProject(async (dir) => {
  const result = await validateProject({ projectDir: dir, runKicadCliImpl: async (args) => {
    if (args[1] === 'upgrade') {
      await writeFile(args.at(-1), '(kicad_sch (version 2025))\n');
      return launcherFailure();
    }
    await writeReport(args, []);
    return clean();
  } });
  assert.equal(approved(result), false);
}));

test('P2 an unreadable schematic (no digest) does not tolerate an upgrade launcher failure', { skip: NO_CHMOD }, () => withProject(async (dir) => {
  const schematic = path.join(dir, 'demo.kicad_sch');
  await chmod(schematic, 0o000);
  try {
    const result = await validateProject({ projectDir: dir, schematicPath: 'demo.kicad_sch', runKicadCliImpl: async (args) => {
      if (args[1] === 'upgrade') return launcherFailure();
      await writeReport(args, []);
      return clean();
    } });
    assert.equal(approved(result), false);
  } finally {
    await chmod(schematic, 0o644);
  }
}));

test('P3 a retry that succeeds returns the second run', async () => {
  let calls = 0;
  const result = await retryOnceOnLauncherFailure(async () => {
    calls += 1;
    return calls === 1 ? launcherFailure() : clean();
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.launchRetried, true);
  assert.equal(calls, 2);
});

test('P4 a stale passing report is not reused when ERC writes nothing', () => withProject(async (dir) => {
  await writeFile(path.join(dir, 'chatpcb-erc.json'), JSON.stringify({ sheets: [{ violations: [] }] }));
  const result = await validateProject({ projectDir: dir, runKicadCliImpl: async (args) => (args[1] === 'upgrade' ? clean('') : clean()) });
  assert.equal(approved(result), false);
}));

test('P5 a report path that cannot be cleared fails closed, even with the skipped override', () => withProject(async (dir) => {
  await mkdir(path.join(dir, 'chatpcb-erc.json'));
  const result = await validateProject({ projectDir: dir, runKicadCliImpl: async (args) => (args[1] === 'upgrade' ? clean('') : clean()) });
  assert.equal(result.ok, false);
  assert.equal(result.skipped, false);
  assert.equal(result.reason.code, 'ERC_REPORT_STALE');
  assert.equal(approved(result), false);
  assert.equal(approved(result, 'skipped'), false);
}));

test('P6 a stale report in a read-only directory fails closed, even with the skipped override', { skip: NO_CHMOD }, () => withProject(async (dir) => {
  await writeFile(path.join(dir, 'chatpcb-erc.json'), JSON.stringify({ sheets: [{ violations: [] }] }));
  await chmod(dir, 0o555);
  try {
    const result = await validateProject({ projectDir: dir, schematicPath: 'demo.kicad_sch', runKicadCliImpl: async (args) => (args[1] === 'upgrade' ? clean('') : clean()) });
    assert.equal(result.ok, false);
    assert.equal(result.skipped, false);
    assert.equal(result.reason.code, 'ERC_REPORT_STALE');
    assert.equal(approved(result), false);
    assert.equal(approved(result, 'skipped'), false);
  } finally {
    await chmod(dir, 0o755);
  }
}));

test('P7 an empty report file is not approved', () => withProject(async (dir) => {
  const result = await validateProject({ projectDir: dir, runKicadCliImpl: async (args) => {
    if (args[1] === 'upgrade') return clean('');
    await writeFile(reportPath(args), '');
    return clean();
  } });
  assert.equal(approved(result), false);
}));

test('P8 a report {} with no sheets is not approved', { todo: 'AO-2 follow-up: strict report schema' }, () => withProject(async (dir) => {
  const result = await validateProject({ projectDir: dir, runKicadCliImpl: async (args) => {
    if (args[1] === 'upgrade') return clean('');
    await writeFile(reportPath(args), '{}');
    return clean();
  } });
  assert.equal(approved(result), false);
}));

test('P8b a report sheets:[{}] with no violations key is not approved', { todo: 'AO-2 follow-up: strict report schema' }, () => withProject(async (dir) => {
  const result = await validateProject({ projectDir: dir, runKicadCliImpl: async (args) => {
    if (args[1] === 'upgrade') return clean('');
    await writeFile(reportPath(args), '{"sheets":[{}]}');
    return clean();
  } });
  assert.equal(approved(result), false);
}));

test('P9 a non-launcher ERC exit code with no violations is not approved', () => withProject(async (dir) => {
  const result = await validateProject({ projectDir: dir, runKicadCliImpl: async (args) => {
    if (args[1] === 'upgrade') return clean('');
    await writeReport(args, []);
    return { ...clean(), exitCode: 3, stderr: 'Error: crash' };
  } });
  assert.equal(approved(result), false);
}));

test('P10 an ERC error in the report is not approved', () => withProject(async (dir) => {
  const result = await validateProject({ projectDir: dir, runKicadCliImpl: async (args) => {
    if (args[1] === 'upgrade') return clean('');
    await writeReport(args, ERRORS);
    return clean('Found 1 violations\n');
  } });
  assert.equal(approved(result), false);
}));

test('P11 an ERC launcher failure is not approved, not even with the skipped override', () => withProject(async (dir) => {
  const result = await validateProject({ projectDir: dir, runKicadCliImpl: async (args) => {
    if (args[1] === 'upgrade') return clean('');
    await writeReport(args, []);
    return { ...launcherFailure(), launchFailed: true, launchRetried: true };
  } });
  assert.equal(approved(result), false);
  assert.equal(approved(result, 'skipped'), false);
}));

test('P12 an upgrade launcher failure with an ERC error is not approved', () => withProject(async (dir) => {
  const result = await validateProject({ projectDir: dir, runKicadCliImpl: async (args) => {
    if (args[1] === 'upgrade') return launcherFailure();
    await writeReport(args, ERRORS);
    return clean();
  } });
  assert.equal(approved(result), false);
}));

test('P13 a real upgrade failure (KiCad printed output) is not approved', () => withProject(async (dir) => {
  const result = await validateProject({ projectDir: dir, runKicadCliImpl: async (args) => {
    if (args[1] === 'upgrade') return { ...launcherFailure(), stdout: 'Loading\n', stderr: 'error: parse failed\n' };
    await writeReport(args, []);
    return clean();
  } });
  assert.equal(approved(result), false);
}));

test('P14 a clean upgrade and a clean ERC are approved (control)', () => withProject(async (dir) => {
  const result = await validateProject({ projectDir: dir, runKicadCliImpl: async (args) => {
    if (args[1] === 'upgrade') return clean('');
    await writeReport(args, []);
    return clean();
  } });
  assert.equal(approved(result), true);
}));

test('P15 a recorded failure is blocked even with the skipped override', () => {
  const recorded = { ok: false, skipped: false, erc: { errorCount: 0 }, reason: { code: 'KICAD_CLI_LAUNCH_FAILED' } };
  assert.equal(approved(recorded, 'skipped'), false);
});

test('P16 a launcher error after a flatpak "F:" warning line is still a launcher failure', async () => {
  const withPortalLine = { ...launcherFailure(), stderr: `F: Can't get document portal: x\n${MERGE_DIRS}` };
  assert.equal(isKicadLauncherFailure(withPortalLine), true);
  let calls = 0;
  const result = await retryOnceOnLauncherFailure(async () => {
    calls += 1;
    return calls === 1 ? withPortalLine : clean();
  });
  assert.equal(calls, 2);
  assert.equal(result.exitCode, 0);
  assert.equal(isKicadLauncherFailure({ ...launcherFailure(), stderr: "F: Can't get document portal: x\n" }), false);
});

test('P17 two validations sharing a project dir do not read each other report', { todo: 'AO-4 follow-up: unique report name per run' }, () => withProject(async (dir) => {
  await writeFile(path.join(dir, 'bad.kicad_sch'), SCHEMATIC);
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const withError = validateProject({ projectDir: dir, schematicPath: 'bad.kicad_sch', runKicadCliImpl: async (args) => {
    if (args[1] === 'upgrade') return clean('');
    await writeReport(args, ERRORS);
    await delay(150);
    return clean();
  } });
  const withoutError = validateProject({ projectDir: dir, schematicPath: 'demo.kicad_sch', runKicadCliImpl: async (args) => {
    if (args[1] === 'upgrade') {
      await delay(30);
      return clean('');
    }
    await delay(20);
    await writeReport(args, []);
    return clean();
  } });
  const [errorResult] = await Promise.all([withError, withoutError]);
  assert.equal(approved(errorResult), false);
}));
